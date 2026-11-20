import { sql } from "drizzle-orm";
import { getDb, type Db } from "@/lib/db";
import { plans, listings, users } from "@/lib/db/schema";
import { solana, STARTING_TOKENS } from "@/lib/solana";
import crypto from "node:crypto";

process.env.SOLANA_MOCK = "true";
process.env.DEMO_MODE = "true";

export async function freshDb(): Promise<Db> {
  const db = await getDb();
  await db.execute(
    sql`truncate table events, idempotency_keys, swaps, orders, swipes, listings, plans, users restart identity cascade`,
  );
  return db;
}

export async function makeUser(name = "Tester", opts: { isDemo?: boolean; funded?: boolean } = {}) {
  const db = await getDb();
  const wallet = solana().createWallet();
  const id = crypto.randomUUID();
  await db.insert(users).values({
    id,
    email: `${id.slice(0, 8)}@test.local`,
    name,
    isDemo: opts.isDemo ?? false,
    walletPubkey: wallet.pubkey,
    walletSecretEnc: wallet.secretEnc,
  });
  if (opts.funded !== false) await solana().airdropTokens(wallet.pubkey, STARTING_TOKENS);
  const row = (await db.select().from(users).where(sql`${users.id} = ${id}`).limit(1))[0];
  return row!;
}

export async function makePlan(
  userId: string,
  overrides: Partial<typeof plans.$inferInsert> = {},
) {
  const db = await getDb();
  const id = crypto.randomUUID();
  const startsAt = overrides.startsAt ?? new Date(Date.now() + 3 * 86_400_000);
  await db.insert(plans).values({
    id,
    userId,
    category: "concert",
    title: "Maggie Rogers",
    venue: "Stubb's BBQ",
    city: "Austin",
    timeZone: "America/Chicago",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 3 * 3_600_000),
    source: "manual",
    externalId: id,
    faceValueCents: 9500,
    transferability: "transferable",
    status: "active",
    imageUrl: "/demo/concert-hall.jpg",
    ...overrides,
  });
  return (await db.select().from(plans).where(sql`${plans.id} = ${id}`).limit(1))[0]!;
}

export async function makeListing(sellerId: string, overrides: Partial<typeof plans.$inferInsert> = {}, priceCents?: number) {
  const db = await getDb();
  const plan = await makePlan(sellerId, { status: "listed", ...overrides });
  const id = crypto.randomUUID();
  await db.insert(listings).values({
    id,
    planId: plan.id,
    sellerId,
    priceCents: priceCents ?? 9000,
    suggestedPriceCents: 9000,
    status: "open",
    expiresAt: plan.startsAt,
  });
  return { listing: (await db.select().from(listings).where(sql`${listings.id} = ${id}`).limit(1))[0]!, plan };
}
