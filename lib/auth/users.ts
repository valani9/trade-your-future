import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { solana, STARTING_TOKENS } from "@/lib/solana";
import { id } from "@/lib/utils";

export const DEMO_EMAIL = "alex@demo.tyf.app";

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  walletPubkey: string;
  isDemo: boolean;
};

export async function getOrCreateUser(input: {
  email: string;
  name?: string | null;
  image?: string | null;
  isDemo?: boolean;
}): Promise<SessionUser> {
  const db = await getDb();
  const existing = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
  if (existing[0]) {
    const u = existing[0];
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      image: u.image,
      walletPubkey: u.walletPubkey,
      isDemo: u.isDemo,
    };
  }
  const wallet = solana().createWallet();
  const created = {
    id: id(),
    email: input.email,
    name: input.name ?? null,
    image: input.image ?? null,
    isDemo: input.isDemo ?? false,
    walletPubkey: wallet.pubkey,
    walletSecretEnc: wallet.secretEnc,
  };
  await db.insert(users).values(created);
  try {
    await solana().airdropTokens(created.walletPubkey, STARTING_TOKENS);
  } catch {
    // Funding is retried lazily on first payment; account creation must not fail here.
  }
  return {
    id: created.id,
    email: created.email,
    name: created.name,
    image: created.image,
    walletPubkey: created.walletPubkey,
    isDemo: created.isDemo,
  };
}

export async function getUserById(userId: string): Promise<SessionUser | null> {
  const db = await getDb();
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const u = rows[0];
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    image: u.image,
    walletPubkey: u.walletPubkey,
    isDemo: u.isDemo,
  };
}

export async function getWalletSecret(userId: string): Promise<{ pubkey: string; secretEnc: string }> {
  const db = await getDb();
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!rows[0]) throw new Error("no user");
  return { pubkey: rows[0].walletPubkey, secretEnc: rows[0].walletSecretEnc };
}
