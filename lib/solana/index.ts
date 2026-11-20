import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  createTransferInstruction,
  getAssociatedTokenAddress,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import bs58 from "bs58";
import crypto from "node:crypto";
import { config } from "@/lib/config";
import { encryptSecret } from "@/lib/crypto";
import { TOKEN_DECIMALS } from "@/lib/money";

export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

export type Wallet = { pubkey: string; secretEnc: string };

export interface SolanaService {
  kind: "mock" | "devnet";
  createWallet(): Wallet;
  airdropTokens(pubkey: string, baseUnits: bigint): Promise<string>;
  balance(pubkey: string): Promise<bigint>;
  transfer(args: { fromSecretEnc: string; fromPubkey: string; toPubkey: string; baseUnits: bigint }): Promise<string>;
  transferFromEscrow(args: { toPubkey: string; baseUnits: bigint }): Promise<string>;
  memo(orderId: string, state: string): Promise<string>;
}

function mockSignature(seed: string): string {
  const h = crypto.createHash("sha256").update(`${seed}:${crypto.randomUUID()}`).digest();
  return bs58.encode(h);
}

class MockSolana implements SolanaService {
  kind = "mock" as const;
  private balances = new Map<string, bigint>();
  createWallet(): Wallet {
    const pubkey = bs58.encode(crypto.createHash("sha256").update(crypto.randomUUID()).digest());
    const secret = bs58.encode(crypto.randomBytes(64));
    this.balances.set(pubkey, 0n);
    return { pubkey, secretEnc: encryptSecret(Buffer.from(secret, "utf8")) };
  }
  async airdropTokens(pubkey: string, baseUnits: bigint): Promise<string> {
    this.balances.set(pubkey, (this.balances.get(pubkey) ?? 0n) + baseUnits);
    return mockSignature(`mint:${pubkey}`);
  }
  async balance(pubkey: string): Promise<bigint> {
    return this.balances.get(pubkey) ?? 0n;
  }
  async transfer({
    fromPubkey,
    toPubkey,
    baseUnits,
  }: {
    fromSecretEnc: string;
    fromPubkey: string;
    toPubkey: string;
    baseUnits: bigint;
  }): Promise<string> {
    const from = this.balances.get(fromPubkey) ?? 0n;
    if (from < baseUnits) throw new Error("insufficient funds");
    this.balances.set(fromPubkey, from - baseUnits);
    this.balances.set(toPubkey, (this.balances.get(toPubkey) ?? 0n) + baseUnits);
    return mockSignature(`transfer:${fromPubkey}:${toPubkey}:${baseUnits}`);
  }
  async transferFromEscrow({ toPubkey, baseUnits }: { toPubkey: string; baseUnits: bigint }): Promise<string> {
    const escrow = ESCROW_PUBKEY();
    const held = this.balances.get(escrow) ?? 0n;
    if (held < baseUnits) throw new Error("escrow short");
    this.balances.set(escrow, held - baseUnits);
    this.balances.set(toPubkey, (this.balances.get(toPubkey) ?? 0n) + baseUnits);
    return mockSignature(`escrow:${toPubkey}:${baseUnits}`);
  }
  async memo(orderId: string, state: string): Promise<string> {
    return mockSignature(`memo:${orderId}:${state}`);
  }
}

function keypairFromSecret(secret: string): Keypair {
  if (/^[0-9a-fA-F]{64}$/.test(secret)) return Keypair.fromSeed(Buffer.from(secret, "hex"));
  try {
    return Keypair.fromSecretKey(bs58.decode(secret));
  } catch {
    return Keypair.fromSeed(Buffer.from(secret, "hex"));
  }
}

export class DevnetSolana implements SolanaService {
  kind = "devnet" as const;
  private connection: Connection;
  private mint: PublicKey;
  private escrow: Keypair;

  constructor() {
    const mint = config.mint();
    const escrow = config.escrowSecret();
    if (!mint || !escrow) throw new Error("MINT_ADDRESS and ESCROW_SECRET are required on devnet");
    this.connection = new Connection(config.rpcUrl(), "confirmed");
    this.mint = new PublicKey(mint);
    this.escrow = keypairFromSecret(escrow);
  }

  createWallet(): Wallet {
    const kp = Keypair.generate();
    return { pubkey: kp.publicKey.toBase58(), secretEnc: encryptSecret(kp.secretKey) };
  }

  private async ata(owner: string): Promise<PublicKey> {
    return getAssociatedTokenAddress(this.mint, new PublicKey(owner));
  }

  async airdropTokens(pubkey: string, baseUnits: bigint): Promise<string> {
    const dest = await this.ata(pubkey);
    const tx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(this.escrow.publicKey, dest, new PublicKey(pubkey), this.mint),
      createMintToInstruction(this.mint, dest, this.escrow.publicKey, baseUnits),
    );
    return sendAndConfirmTransaction(this.connection, tx, [this.escrow], { commitment: "confirmed" });
  }

  async balance(pubkey: string): Promise<bigint> {
    const dest = await this.ata(pubkey);
    try {
      const account = await getAccount(this.connection, dest);
      return account.amount;
    } catch {
      return 0n;
    }
  }

  async transfer({
    fromSecretEnc,
    fromPubkey,
    toPubkey,
    baseUnits,
  }: {
    fromSecretEnc: string;
    fromPubkey: string;
    toPubkey: string;
    baseUnits: bigint;
  }): Promise<string> {
    const { decryptSecret } = await import("@/lib/crypto");
    const signer = Keypair.fromSecretKey(decryptSecret(fromSecretEnc));
    if (signer.publicKey.toBase58() !== fromPubkey) throw new Error("wallet mismatch");
    const source = await this.ata(fromPubkey);
    const dest = await this.ata(toPubkey);
    const tx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(this.escrow.publicKey, dest, new PublicKey(toPubkey), this.mint),
      createTransferInstruction(source, dest, signer.publicKey, baseUnits, [], TOKEN_PROGRAM_ID),
    );
    tx.feePayer = this.escrow.publicKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
    tx.partialSign(this.escrow, signer);
    return this.connection.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
  }

  async transferFromEscrow({ toPubkey, baseUnits }: { toPubkey: string; baseUnits: bigint }): Promise<string> {
    const source = await this.ata(this.escrow.publicKey.toBase58());
    const dest = await this.ata(toPubkey);
    const tx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(this.escrow.publicKey, dest, new PublicKey(toPubkey), this.mint),
      createTransferInstruction(source, dest, this.escrow.publicKey, baseUnits, [], TOKEN_PROGRAM_ID),
    );
    return sendAndConfirmTransaction(this.connection, tx, [this.escrow], { commitment: "confirmed" });
  }

  async memo(orderId: string, state: string): Promise<string> {
    const instruction = new TransactionInstruction({
      programId: MEMO_PROGRAM_ID,
      keys: [],
      data: Buffer.from(`tyf:${orderId}:${state}`, "utf8"),
    });
    const tx = new Transaction().add(instruction);
    tx.feePayer = this.escrow.publicKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
    tx.sign(this.escrow);
    return this.connection.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
  }
}

let cached: SolanaService | undefined;

export function solana(): SolanaService {
  if (cached) return cached;
  cached = config.solanaMock() ? new MockSolana() : new DevnetSolana();
  return cached;
}

export const ESCROW_PUBKEY = () => {
  const secret = config.escrowSecret();
  if (!secret) return "unconfigured";
  try {
    return keypairFromSecret(secret).publicKey.toBase58();
  } catch {
    return "unconfigured";
  }
};

export const STARTING_TOKENS = 500n * 10_000_000n;
export const SOL_AIRDROP = 0.5 * LAMPORTS_PER_SOL;
export { SystemProgram };
