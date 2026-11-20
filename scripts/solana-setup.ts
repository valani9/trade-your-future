import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import bs58 from "bs58";

const RPC = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const DECIMALS = 6;

async function fund(connection: Connection, pubkey: PublicKey) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const signature = await connection.requestAirdrop(pubkey, Math.round(0.5 * LAMPORTS_PER_SOL));
      await connection.confirmTransaction(signature, "confirmed");
      return signature;
    } catch (error) {
      const wait = Math.min(30_000, 2 ** attempt * 1000);
      console.warn(`airdrop attempt ${attempt} failed: ${String(error).slice(0, 120)} — retrying in ${wait / 1000}s`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  throw new Error("could not fund the escrow wallet from the devnet faucet; try again later");
}

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const escrow = process.env.ESCROW_SECRET
    ? Keypair.fromSecretKey(bs58.decode(process.env.ESCROW_SECRET))
    : Keypair.generate();

  const balance = await connection.getBalance(escrow.publicKey);
  if (balance < 0.05 * LAMPORTS_PER_SOL) await fund(connection, escrow.publicKey);

  let mintAddress = process.env.MINT_ADDRESS;
  if (!mintAddress) {
    const mint = await createMint(connection, escrow, escrow.publicKey, null, DECIMALS);
    await getOrCreateAssociatedTokenAccount(connection, escrow, mint, escrow.publicKey);
    mintAddress = mint.toBase58();
  }

  console.log("");
  console.log("Copy these into .env (never commit them):");
  console.log(`ESCROW_SECRET=${bs58.encode(escrow.secretKey)}`);
  console.log(`MINT_ADDRESS=${mintAddress}`);
  console.log(`SOLANA_RPC_URL=${RPC}`);
  console.log("");
  console.log(`escrow address: ${escrow.publicKey.toBase58()}`);
}

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
