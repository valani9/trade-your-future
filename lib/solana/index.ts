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
import { TOKEN_DECIMALS, centsToBaseUnits } from "@/lib/money";
import fs from "node:fs";
import path from "node:path";

export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

export type Wallet = { pubkey: string; secretEnc: string };

export interface SolanaService {
  kind: "mock" | "devnet";
  createWallet(): Wallet;
  airdropTokens(pubkey: string, baseUnits: bigint): Promise<string>;
  balance(pubkey: string): Promise<bigint>;
  transfer(args: {
    fromSecretEnc: string;
    fromPubkey: string;
    toPubkey: string;
    baseUnits: bigint;
    reference?: string;
  }): Promise<string>;
  transferFromEscrow(args: { toPubkey: string; baseUnits: bigint; reference?: string }): Promise<string>;
  memo(orderId: string, state: string): Promise<string>;
}

function mockSignature(seed: string): string {
  const h = crypto.createHash("sha256").update(`${seed}:${crypto.randomUUID()}`).digest();
  return bs58.encode(h);
}

export class MockSolana implements SolanaService {
  kind = "mock" as const;
  private balances = new Map<string, bigint>();
  private refs = new Map<string, string>();
  private loaded = false;

  private ledgerPath(): string | null {
    const dir = process.env.PGLITE_DIR ?? (process.env.NODE_ENV === "test" ? "memory://" : "./.pgdata");
    if (dir === "memory://" || dir.startsWith("memory:")) return null;
    return path.join(dir, "mock-ledger.json");
  }

  private async load() {
    if (this.loaded) return;
    this.loaded = true;
    const file = this.ledgerPath();
    if (!file) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as
        | { balances?: Record<string, string>; refs?: Record<string, string> }
        | Record<string, string>;
      const balances = "balances" in parsed ? (parsed.balances ?? {}) : (parsed as Record<string, string>);
      for (const [key, value] of Object.entries(balances)) this.balances.set(key, BigInt(value));
      if ("refs" in parsed && parsed.refs) for (const [key, value] of Object.entries(parsed.refs)) this.refs.set(key, value);
    } catch {
      // no ledger yet
    }
  }

  private async save() {
    const file = this.ledgerPath();
    if (!file) return;
    const payload = {
      balances: Object.fromEntries([...this.balances].map(([k, v]) => [k, v.toString()])),
      refs: Object.fromEntries(this.refs),
    };
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(payload));
    } catch {
      // best effort
    }
  }

  createWallet(): Wallet {
    const pubkey = bs58.encode(crypto.createHash("sha256").update(crypto.randomUUID()).digest());
    const secret = bs58.encode(crypto.randomBytes(64));
    this.balances.set(pubkey, 0n);
    return { pubkey, secretEnc: encryptSecret(Buffer.from(secret, "utf8")) };
  }
  async airdropTokens(pubkey: string, baseUnits: bigint): Promise<string> {
    await this.load();
    this.balances.set(pubkey, (this.balances.get(pubkey) ?? 0n) + baseUnits);
    await this.save();
    return mockSignature(`mint:${pubkey}`);
  }
  async balance(pubkey: string): Promise<bigint> {
    await this.load();
    return this.balances.get(pubkey) ?? 0n;
  }
  async transfer({
    fromPubkey,
    toPubkey,
    baseUnits,
    reference,
  }: {
    fromSecretEnc: string;
    fromPubkey: string;
    toPubkey: string;
    baseUnits: bigint;
    reference?: string;
  }): Promise<string> {
    await this.load();
    if (reference) {
      const seen = this.refs.get(reference);
      if (seen) return seen;
    }
    const from = this.balances.get(fromPubkey) ?? 0n;
    if (from < baseUnits) throw new Error("insufficient funds");
    this.balances.set(fromPubkey, from - baseUnits);
    this.balances.set(toPubkey, (this.balances.get(toPubkey) ?? 0n) + baseUnits);
    const signature = mockSignature(`transfer:${fromPubkey}:${toPubkey}:${baseUnits}`);
    if (reference) this.refs.set(reference, signature);
    await this.save();
    return signature;
  }

  async transferFromEscrow({
    toPubkey,
    baseUnits,
    reference,
  }: {
    toPubkey: string;
    baseUnits: bigint;
    reference?: string;
  }): Promise<string> {
    await this.load();
    if (reference) {
      const seen = this.refs.get(reference);
      if (seen) return seen;
    }
    const escrow = ESCROW_PUBKEY();
    const held = this.balances.get(escrow) ?? 0n;
    if (held < baseUnits) throw new Error("escrow short");
    this.balances.set(escrow, held - baseUnits);
    this.balances.set(toPubkey, (this.balances.get(toPubkey) ?? 0n) + baseUnits);
    const signature = mockSignature(`escrow:${toPubkey}:${baseUnits}`);
    if (reference) this.refs.set(reference, signature);
    await this.save();
    return signature;
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

  private settled = new Map<string, string>();

  /**
   * A referenced transfer is only sent when no earlier transfer carries the same
   * reference. A payout that landed but timed out is returned instead of re-sent, so a
   * retry can never pay a second time. A lookup that cannot be completed refuses to
   * send rather than guess.
   */
  private async alreadySent(reference: string, account: PublicKey): Promise<string | null> {
    const cached = this.settled.get(reference);
    if (cached) return cached;
    const memo = `tyf:ref:${reference}`;
    let before: string | undefined;
    for (let page = 0; page < 4; page++) {
      const batch = await this.connection.getSignaturesForAddress(account, { limit: 50, before });
      if (batch.length === 0) break;
      before = batch[batch.length - 1].signature;
      const found = await this.referenceIn(batch, memo);
      if (found) {
        this.settled.set(reference, found);
        return found;
      }
      if (batch.length < 50) break;
    }
    return null;
  }

  private async referenceIn(batch: Array<{ signature: string; err: unknown }>, memo: string): Promise<string | null> {
    for (const entry of batch) {
      if (entry.err) continue;
      const parsed = await this.connection.getParsedTransaction(entry.signature, { maxSupportedTransactionVersion: 0 });
      const logs = parsed?.meta?.logMessages ?? [];
      if (logs.some((line) => line.includes(memo))) return entry.signature;
    }
    return null;
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
    reference,
  }: {
    fromSecretEnc: string;
    fromPubkey: string;
    toPubkey: string;
    baseUnits: bigint;
    reference?: string;
  }): Promise<string> {
    const { decryptSecret } = await import("@/lib/crypto");
    const signer = Keypair.fromSecretKey(decryptSecret(fromSecretEnc));
    if (signer.publicKey.toBase58() !== fromPubkey) throw new Error("wallet mismatch");
    const source = await this.ata(fromPubkey);
    if (reference) {
      const earlier = await this.alreadySent(reference, source);
      if (earlier) return earlier;
    }
    const dest = await this.ata(toPubkey);
    const tx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(this.escrow.publicKey, dest, new PublicKey(toPubkey), this.mint),
      createTransferInstruction(source, dest, signer.publicKey, baseUnits, [], TOKEN_PROGRAM_ID),
    );
    if (reference) tx.add(new TransactionInstruction({ keys: [], programId: MEMO_PROGRAM_ID, data: Buffer.from(`tyf:ref:${reference}`) }));
    let blockhash = (await this.connection.getLatestBlockhash()).blockhash;
    tx.feePayer = this.escrow.publicKey;
    tx.recentBlockhash = blockhash;
    tx.partialSign(this.escrow, signer);
    const signature = await this.connection.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
    if (reference) this.settled.set(reference, signature);
    try {
      await this.confirm(signature, blockhash);
    } catch (error) {
      const failed = (error as { failedOnChain?: boolean }).failedOnChain;
      if (failed && reference) this.settled.delete(reference);
      throw failed
        ? error
        : Object.assign(error instanceof Error ? error : new Error(String(error)), { signature });
    }
    return signature;
  }

  async transferFromEscrow({
    toPubkey,
    baseUnits,
    reference,
  }: {
    toPubkey: string;
    baseUnits: bigint;
    reference?: string;
  }): Promise<string> {
    const source = await this.ata(this.escrow.publicKey.toBase58());
    if (reference) {
      const earlier = await this.alreadySent(reference, source);
      if (earlier) return earlier;
    }
    const dest = await this.ata(toPubkey);
    const tx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(this.escrow.publicKey, dest, new PublicKey(toPubkey), this.mint),
      createTransferInstruction(source, dest, this.escrow.publicKey, baseUnits, [], TOKEN_PROGRAM_ID),
    );
    if (reference) tx.add(new TransactionInstruction({ keys: [], programId: MEMO_PROGRAM_ID, data: Buffer.from(`tyf:ref:${reference}`) }));
    const blockhash = (await this.connection.getLatestBlockhash()).blockhash;
    tx.feePayer = this.escrow.publicKey;
    tx.recentBlockhash = blockhash;
    tx.sign(this.escrow);
    const sent = await this.connection.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
    try {
      await this.confirm(sent, blockhash);
    } catch (error) {
      const failed = (error as { failedOnChain?: boolean }).failedOnChain;
      throw failed
        ? error
        : Object.assign(error instanceof Error ? error : new Error(String(error)), { signature: sent });
    }
    if (reference) this.settled.set(reference, sent);
    return sent;
  }

  private async confirm(signature: string, blockhash: string) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const status = await this.connection.getSignatureStatuses([signature]);
      const value = status.value[0];
      if (value?.err) throw Object.assign(new Error(`transaction failed: ${JSON.stringify(value.err)}`), { failedOnChain: true });
      if (value?.confirmationStatus === "confirmed" || value?.confirmationStatus === "finalized") return;
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    void blockhash;
    throw new Error("transaction was not confirmed in time");
  }

  async memo(orderId: string, state: string): Promise<string> {
    const instruction = new TransactionInstruction({
      programId: MEMO_PROGRAM_ID,
      keys: [],
      data: Buffer.from(`tyf:${orderId}:${state}`, "utf8"),
    });
    const tx = new Transaction().add(instruction);
    let blockhash = (await this.connection.getLatestBlockhash()).blockhash;
    tx.feePayer = this.escrow.publicKey;
    tx.recentBlockhash = blockhash;
    tx.sign(this.escrow);
    const signature = await this.connection.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
    try {
      await this.confirm(signature, blockhash);
    } catch (error) {
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), { signature });
    }
    return signature;
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

export const STARTING_TOKENS = centsToBaseUnits(50_000);
export const SOL_AIRDROP = 0.5 * LAMPORTS_PER_SOL;
export { SystemProgram };
