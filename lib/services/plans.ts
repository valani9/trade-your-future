import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { listings, plans } from "@/lib/db/schema";
import { HttpError } from "@/lib/config";
import { feeCents, sellerNetCents, MAX_PRICE_CENTS } from "@/lib/money";

const categoryMultiplier: Record<string, number> = {
  concert: 1.15,
  sports: 1.1,
  restaurant: 1.0,
  hotel: 0.95,
  class: 0.9,
  experience: 1.0,
  flight: 0.85,
};

export function suggestPriceCents(plan: {
  faceValueCents: number;
  category: string;
  startsAt: Date;
}, now = new Date()): number {
  const days = (plan.startsAt.getTime() - now.getTime()) / 86_400_000;
  const timeFactor = days < 3 ? 0.85 : days < 7 ? 0.95 : days < 14 ? 1 : days < 30 ? 1.05 : 1.1;
  const multiplier = categoryMultiplier[plan.category] ?? 1;
  const raw = Math.round((plan.faceValueCents * multiplier * timeFactor) / 100) * 100;
  return Math.max(100, Math.min(raw, MAX_PRICE_CENTS));
}

export type MyPlan = {
  id: string;
  category: string;
  title: string;
  venue: string;
  city: string;
  timeZone: string;
  startsAt: string;
  endsAt: string;
  faceValueCents: number;
  transferability: string;
  status: string;
  imageUrl: string | null;
  listing: {
    id: string;
    priceCents: number;
    status: string;
    netCents: number;
    expiresAt: string;
  } | null;
};

export async function getMyPlans(db: Db, userId: string): Promise<MyPlan[]> {
  const rows = await db
    .select({
      plan: plans,
      listingId: listings.id,
      listingPrice: listings.priceCents,
      listingStatus: listings.status,
      listingExpires: listings.expiresAt,
    })
    .from(plans)
    .leftJoin(listings, and(eq(listings.planId, plans.id), eq(listings.status, "open")))
    .where(eq(plans.userId, userId))
    .orderBy(asc(plans.startsAt));

  return rows.map((row) => ({
    id: row.plan.id,
    category: row.plan.category,
    title: row.plan.title,
    venue: row.plan.venue,
    city: row.plan.city,
    timeZone: row.plan.timeZone,
    startsAt: row.plan.startsAt.toISOString(),
    endsAt: row.plan.endsAt.toISOString(),
    faceValueCents: row.plan.faceValueCents,
    transferability: row.plan.transferability,
    status: row.plan.status,
    imageUrl: row.plan.imageUrl,
    listing:
      row.listingId && row.listingPrice && row.listingStatus && row.listingExpires
        ? {
            id: row.listingId,
            priceCents: row.listingPrice,
            status: row.listingStatus,
            netCents: sellerNetCents(row.listingPrice),
            expiresAt: row.listingExpires.toISOString(),
          }
        : null,
  }));
}

export type ClashGroup = {
  dayLabel: string;
  planIds: string[];
  startsAt: string;
};

export function groupClashes(items: Array<{ id: string; startsAt: string; endsAt: string; status: string }>): ClashGroup[] {
  const active = items
    .filter((p) => p.status === "active" || p.status === "listed")
    .map((p) => ({ ...p, start: new Date(p.startsAt).getTime(), end: new Date(p.endsAt).getTime() }))
    .sort((a, b) => a.start - b.start);

  const groups: ClashGroup[] = [];
  let current: typeof active = [];
  for (const plan of active) {
    if (current.length === 0) {
      current = [plan];
      continue;
    }
    const overlaps = current.some((other) => plan.start < other.end && other.start < plan.end);
    if (overlaps) {
      current.push(plan);
    } else {
      if (current.length > 1) groups.push(toGroup(current));
      current = [plan];
    }
  }
  if (current.length > 1) groups.push(toGroup(current));
  return groups;
}

function toGroup(items: Array<{ id: string; startsAt: string; start: number }>): ClashGroup {
  const first = items[0];
  return {
    dayLabel: new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/Chicago",
    }).format(new Date(first.start)),
    planIds: items.map((i) => i.id),
    startsAt: first.startsAt,
  };
}

export async function createListing(
  db: Db,
  userId: string,
  input: { planId: string; priceCents: number },
) {
  if (!Number.isInteger(input.priceCents) || input.priceCents <= 0 || input.priceCents > MAX_PRICE_CENTS) {
    throw new HttpError(400, "Choose a price between $1 and $10,000", "invalid_price");
  }
  const rows = await db.select().from(plans).where(eq(plans.id, input.planId)).limit(1);
  const plan = rows[0];
  if (!plan) throw new HttpError(404, "Plan not found", "not_found");
  if (plan.userId !== userId) throw new HttpError(403, "That's not your plan", "forbidden");
  if (plan.startsAt.getTime() <= Date.now()) throw new HttpError(422, "This plan already started", "expired");
  if (plan.transferability === "non_transferable") {
    throw new HttpError(422, "Can't be resold", "not_transferable");
  }
  if (plan.status === "sold" || plan.status === "swapped") throw new HttpError(422, "Already gone", "unavailable");
  if (plan.status === "listed") throw new HttpError(409, "Already on sale", "already_listed");
  if (plan.status !== "active") throw new HttpError(422, "This one has passed", "expired");

  const existing = await db
    .select({ id: listings.id })
    .from(listings)
    .where(and(eq(listings.planId, plan.id), inArray(listings.status, ["open", "pending"])))
    .limit(1);
  if (existing[0]) throw new HttpError(409, "Already on sale", "already_listed");

  const id = crypto.randomUUID();
  try {
    await db.insert(listings).values({
      id,
      planId: plan.id,
      sellerId: userId,
      priceCents: input.priceCents,
      suggestedPriceCents: suggestPriceCents(plan),
      status: "open",
      expiresAt: plan.startsAt,
    });
  } catch {
    throw new HttpError(409, "Already on sale", "already_listed");
  }
  await db.update(plans).set({ status: "listed" }).where(eq(plans.id, plan.id));
  return { id, planId: plan.id, priceCents: input.priceCents };
}

export async function cancelListing(db: Db, userId: string, listingId: string) {
  const rows = await db.select().from(listings).where(eq(listings.id, listingId)).limit(1);
  const listing = rows[0];
  if (!listing) throw new HttpError(404, "Listing not found", "not_found");
  if (listing.sellerId !== userId) throw new HttpError(403, "That's not your listing", "forbidden");
  if (listing.status === "sold") throw new HttpError(409, "Already sold", "conflict");
  if (listing.status === "pending") {
    throw new HttpError(409, "Someone is paying for this right now", "in_progress");
  }
  const updated = await db
    .update(listings)
    .set({ status: "cancelled" })
    .where(and(eq(listings.id, listingId), eq(listings.status, "open")))
    .returning({ id: listings.id });
  if (!updated[0]) throw new HttpError(409, "Nothing to cancel", "conflict");
  await db.update(plans).set({ status: "active" }).where(and(eq(plans.id, listing.planId), eq(plans.status, "listed")));
  return { id: listingId, status: "cancelled" };
}

export async function expireStaleListings(db: Db) {
  const now = new Date();
  const expired = await db
    .update(listings)
    .set({ status: "expired" })
    .where(and(eq(listings.status, "open"), sql`${listings.expiresAt} <= ${now}`))
    .returning({ id: listings.id, planId: listings.planId });
  for (const row of expired) {
    await db.update(plans).set({ status: "expired" }).where(and(eq(plans.id, row.planId), eq(plans.status, "listed")));
  }
  return expired.length;
}
