import { and, eq, gt, ne, notInArray, sql, lt, asc } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { listings, plans, swipes, users } from "@/lib/db/schema";
import { HttpError } from "@/lib/config";

export const PAGE_SIZE = 12;

export type FeedCard = {
  listingId: string;
  priceCents: number;
  faceValueCents: number;
  transferability: string;
  category: string;
  title: string;
  venue: string;
  city: string;
  timeZone: string;
  startsAt: string;
  endsAt: string;
  imageUrl: string | null;
  sellerName: string | null;
  isDemo: boolean;
  createdAt: string;
};

function encodeCursor(startsAt: Date, createdAt: Date, listingId: string): string {
  return Buffer.from(`${startsAt.toISOString()}|${createdAt.toISOString()}|${listingId}`).toString("base64url");
}

function decodeCursor(cursor: string): { startsAt: Date; createdAt: Date; listingId: string } {
  try {
    const [starts, created, listingId] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    if (!starts || !created || !listingId) throw new Error("bad");
    return { startsAt: new Date(starts), createdAt: new Date(created), listingId };
  } catch {
    throw new HttpError(400, "Invalid cursor", "invalid_cursor");
  }
}

export async function getFeed(
  db: Db,
  userId: string | null,
  cursor?: string | null,
): Promise<{ items: FeedCard[]; nextCursor: string | null }> {
  const now = new Date();
  const conditions = [
    eq(listings.status, "open"),
    gt(listings.expiresAt, now),
    gt(plans.startsAt, now),
    ne(plans.status, "sold"),
  ];
  if (userId) conditions.push(ne(listings.sellerId, userId));

  let swipedIds: string[] = [];
  if (userId) {
    const done = await db.select({ listingId: swipes.listingId }).from(swipes).where(eq(swipes.userId, userId));
    swipedIds = done.map((row) => row.listingId);
  }
  if (swipedIds.length) conditions.push(notInArray(listings.id, swipedIds));
  if (cursor) {
    const c = decodeCursor(cursor);
    conditions.push(
      sql`(${plans.startsAt}, ${listings.createdAt}, ${listings.id}) > (${c.startsAt.toISOString()}::timestamptz, ${c.createdAt.toISOString()}::timestamptz, ${c.listingId})`,
    );
  }

  const rows = await db
    .select({
      listingId: listings.id,
      priceCents: listings.priceCents,
      createdAt: listings.createdAt,
      planId: plans.id,
      faceValueCents: plans.faceValueCents,
      transferability: plans.transferability,
      category: plans.category,
      title: plans.title,
      venue: plans.venue,
      city: plans.city,
      timeZone: plans.timeZone,
      startsAt: plans.startsAt,
      endsAt: plans.endsAt,
      imageUrl: plans.imageUrl,
      sellerName: users.name,
      isDemo: users.isDemo,
    })
    .from(listings)
    .innerJoin(plans, eq(listings.planId, plans.id))
    .innerJoin(users, eq(listings.sellerId, users.id))
    .where(and(...conditions))
    .orderBy(asc(plans.startsAt), asc(listings.createdAt), asc(listings.id))
    .limit(PAGE_SIZE + 1);

  const page = rows.slice(0, PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    items: page.map((row) => ({
      listingId: row.listingId,
      priceCents: row.priceCents,
      faceValueCents: row.faceValueCents,
      transferability: row.transferability,
      category: row.category,
      title: row.title,
      venue: row.venue,
      city: row.city,
      timeZone: row.timeZone,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      imageUrl: row.imageUrl,
      sellerName: row.sellerName,
      isDemo: row.isDemo,
      createdAt: row.createdAt.toISOString(),
    })),
    nextCursor: rows.length > PAGE_SIZE && last ? encodeCursor(last.startsAt, last.createdAt, last.listingId) : null,
  };
}

export async function countFeed(db: Db, userId: string | null): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(listings)
    .innerJoin(plans, eq(listings.planId, plans.id))
    .where(
      and(
        eq(listings.status, "open"),
        gt(listings.expiresAt, new Date()),
        gt(plans.startsAt, new Date()),
        userId ? ne(listings.sellerId, userId) : sql`true`,
      ),
    );
  return rows[0]?.n ?? 0;
}

export { lt };
