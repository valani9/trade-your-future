import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { auditEvents, listings, orders, plans, swaps, users } from "@/lib/db/schema";
import { HttpError } from "@/lib/config";
import { centsToBaseUnits, feeCents } from "@/lib/money";
import { solana, ESCROW_PUBKEY } from "@/lib/solana";
import { getWalletSecret } from "@/lib/auth/users";
import { id } from "@/lib/utils";

async function log(db: Db, swapId: string, actorId: string, type: string, payload: Record<string, unknown> = {}) {
  await db.insert(auditEvents).values({ id: id(), actorId, type, payload: { swapId, ...payload } });
}

export async function proposeSwap(db: Db, proposerId: string, offerPlanId: string, wantListingId: string) {
  const planRows = await db.select().from(plans).where(eq(plans.id, offerPlanId)).limit(1);
  const offer = planRows[0];
  if (!offer) throw new HttpError(404, "Plan not found", "not_found");
  if (offer.userId !== proposerId) throw new HttpError(403, "That's not your plan", "forbidden");
  if (offer.status !== "active") throw new HttpError(409, "That plan is already busy", "unavailable");
  if (offer.transferability === "non_transferable") throw new HttpError(422, "Can't trade this one", "not_transferable");
  if (offer.startsAt.getTime() <= Date.now()) throw new HttpError(422, "That plan already started", "expired");

  const listingRows = await db
    .select({ listing: listings, plan: plans })
    .from(listings)
    .innerJoin(plans, eq(listings.planId, plans.id))
    .where(eq(listings.id, wantListingId))
    .limit(1);
  const want = listingRows[0];
  if (!want) throw new HttpError(404, "Listing not found", "not_found");
  if (want.listing.status !== "open") throw new HttpError(409, "No longer available", "unavailable");
  if (want.listing.sellerId === proposerId) throw new HttpError(400, "That's your own plan", "self_swap");
  if (want.plan.status !== "listed") throw new HttpError(409, "No longer available", "unavailable");
  if (want.listing.expiresAt.getTime() <= Date.now() || want.plan.startsAt.getTime() <= Date.now()) {
    throw new HttpError(422, "That one has already started", "expired");
  }

  const existing = await db
    .select({ id: swaps.id })
    .from(swaps)
    .where(
      and(
        eq(swaps.proposerId, proposerId),
        eq(swaps.offerPlanId, offerPlanId),
        eq(swaps.wantListingId, wantListingId),
        inArray(swaps.status, ["proposed", "accepted"]),
      ),
    )
    .limit(1);
  if (existing[0]) return { id: existing[0].id, diffCents: offer.faceValueCents - want.listing.priceCents };

  const swapId = id();
  const diffCents = offer.faceValueCents - want.listing.priceCents;
  await db.insert(swaps).values({
    id: swapId,
    offerPlanId,
    wantListingId,
    proposerId,
    counterpartyId: want.listing.sellerId,
    diffCents,
    status: "proposed",
  });
  await log(db, swapId, proposerId, "swap.proposed", { diffCents });
  return { id: swapId, diffCents };
}

export async function acceptSwap(db: Db, userId: string, swapId: string) {
  const rows = await db.select().from(swaps).where(eq(swaps.id, swapId)).limit(1);
  const swap = rows[0];
  if (!swap) throw new HttpError(404, "Swap not found", "not_found");
  if (swap.counterpartyId !== userId) throw new HttpError(403, "That's not yours to accept", "forbidden");
  if (swap.status !== "proposed") throw new HttpError(409, "Already handled", "illegal_transition");

  const listingRows = await db
    .select({ listing: listings, plan: plans })
    .from(listings)
    .innerJoin(plans, eq(listings.planId, plans.id))
    .where(eq(listings.id, swap.wantListingId))
    .limit(1);
  const want = listingRows[0];
  const offerRows = await db.select().from(plans).where(eq(plans.id, swap.offerPlanId)).limit(1);
  const offer = offerRows[0];
  if (
    !want ||
    want.listing.status !== "open" ||
    !offer ||
    offer.status !== "active" ||
    offer.startsAt.getTime() <= Date.now() ||
    want.listing.expiresAt.getTime() <= Date.now() ||
    want.plan.startsAt.getTime() <= Date.now()
  ) {
    await abandonSwap(db, swap);
    throw new HttpError(409, "That trade fell through", "stale_swap");
  }

  const listingClaim = await db
    .update(listings)
    .set({ status: "pending" })
    .where(and(eq(listings.id, want.listing.id), eq(listings.status, "open")))
    .returning({ id: listings.id });
  if (!listingClaim[0]) throw new HttpError(409, "That trade fell through", "stale_swap");
  const planClaim = await db
    .update(plans)
    .set({ status: "listed" })
    .where(and(eq(plans.id, offerRows[0].id), eq(plans.status, "active")))
    .returning({ id: plans.id });
  if (!planClaim[0]) {
    await db.update(listings).set({ status: "open" }).where(eq(listings.id, want.listing.id));
    throw new HttpError(409, "That trade fell through", "stale_swap");
  }

  const claimed = await db
    .update(swaps)
    .set({ status: "accepted", settleTx: null })
    .where(and(eq(swaps.id, swapId), eq(swaps.status, "proposed")))
    .returning({ id: swaps.id });
  if (!claimed[0]) {
    await db.update(listings).set({ status: "open" }).where(eq(listings.id, want.listing.id));
    await db.update(plans).set({ status: "active" }).where(eq(plans.id, offerRows[0].id));
    throw new HttpError(409, "Already handled", "illegal_transition");
  }

  const sign$ = Math.abs(swap.diffCents);
  let settleTx: string | null = null;
  if (sign$ > 0) {
    const payerId = swap.diffCents > 0 ? swap.counterpartyId : swap.proposerId;
    const payer = await getWalletSecret(payerId);
    const balance = await solana().balance(payer.pubkey);
    if (balance < centsToBaseUnits(sign$)) {
      await db.update(swaps).set({ status: "proposed" }).where(eq(swaps.id, swapId));
      await db.update(listings).set({ status: "open" }).where(eq(listings.id, want.listing.id));
      await db.update(plans).set({ status: "active" }).where(eq(plans.id, offerRows[0].id));
      throw new HttpError(402, "The other side is short on balance", "insufficient_funds");
    }
    // The marker is both the claim and the clock. A swap carrying one has money
    // in flight, so recovery finishes it instead of unwinding it, and it only
    // touches markers old enough that no acceptance can still be running.
    const marker = `${SETTLING}${Date.now()}`;
    const settling = await db
      .update(swaps)
      .set({ settleTx: marker })
      .where(and(eq(swaps.id, swapId), eq(swaps.status, "accepted"), isNull(swaps.settleTx)))
      .returning({ id: swaps.id });
    if (!settling[0]) throw new HttpError(409, "Already handled", "illegal_transition");
    try {
      settleTx = await moveDifference(db, swap);
    } catch (error) {
      if ((error as { legOneSent?: boolean }).legOneSent) {
        // Leg one landed, so the marker stays and the cron finishes the payout.
        await log(db, swapId, userId, "swap.settlement_unconfirmed", { error: String(error) });
        throw new HttpError(502, "That payment is finishing up. Check the order in a moment.", "settlement_pending");
      }
      const mine = await db
        .update(swaps)
        .set({ status: "proposed", settleTx: null })
        .where(and(eq(swaps.id, swapId), eq(swaps.status, "accepted"), eq(swaps.settleTx, marker)))
        .returning({ id: swaps.id });
      if (mine[0]) {
        await db.update(listings).set({ status: "open" }).where(and(eq(listings.id, want.listing.id), eq(listings.status, "pending")));
        await db.update(plans).set({ status: "active" }).where(and(eq(plans.id, offerRows[0].id), eq(plans.status, "listed")));
      }
      await log(db, swapId, userId, "swap.settlement_failed", { error: String(error) });
      throw new HttpError(502, "The payment didn't go through", "settlement_failed");
    }
  }

  await finalizeSwap(db, swap, settleTx);
  await log(db, swapId, userId, "swap.settled", { diffCents: swap.diffCents });
  return { id: swapId, status: "settled", diffCents: swap.diffCents, settleTx };
}

const SETTLING = "settling:";

async function moveDifference(db: Db, swap: typeof swaps.$inferSelect) {
  const sign$ = Math.abs(swap.diffCents);
  if (sign$ === 0) return null;
  const payerId = swap.diffCents > 0 ? swap.counterpartyId : swap.proposerId;
  const receiverId = swap.diffCents > 0 ? swap.proposerId : swap.counterpartyId;
  const payer = await getWalletSecret(payerId);
  const receiver = await getWalletSecret(receiverId);
  try {
    await solana().transfer({
      fromSecretEnc: payer.secretEnc,
      fromPubkey: payer.pubkey,
      toPubkey: ESCROW_PUBKEY(),
      baseUnits: centsToBaseUnits(sign$),
      reference: `swap:${swap.id}`,
    });
  } catch (error) {
    // A signature only means the transfer may be out there. Whether it landed is
    // settled by the reference check on the retry, never assumed here.
    throw Object.assign(new Error(String(error)), { legOneSent: Boolean((error as { signature?: string }).signature) });
  }
  try {
    return await solana().transferFromEscrow({
      toPubkey: receiver.pubkey,
      baseUnits: centsToBaseUnits(sign$ - feeCents(sign$)),
      reference: `swap-payout:${swap.id}`,
    });
  } catch (error) {
    throw Object.assign(new Error(String(error)), { legOneSent: true });
  }
}

async function finalizeSwap(db: Db, swap: typeof swaps.$inferSelect, settleTx: string | null) {
  await db.transaction(async (tx) => {
    const inner = tx as unknown as Db;
    const claimed = await inner
      .update(swaps)
      .set({ status: "settled", settleTx })
      .where(and(eq(swaps.id, swap.id), eq(swaps.status, "accepted")))
      .returning({ id: swaps.id });
    if (!claimed[0]) return;

    const want = (
      await inner
        .select({ listing: listings, plan: plans })
        .from(listings)
        .innerJoin(plans, eq(listings.planId, plans.id))
        .where(eq(listings.id, swap.wantListingId))
        .limit(1)
    )[0];
    const offer = (await inner.select().from(plans).where(eq(plans.id, swap.offerPlanId)).limit(1))[0];
    if (!want || !offer) return;

    await inner
      .update(plans)
      .set({ userId: swap.counterpartyId, status: "swapped", externalId: `${offer.externalId ?? offer.id}:swapped:${swap.id}` })
      .where(eq(plans.id, swap.offerPlanId));
    await inner
      .update(plans)
      .set({ userId: swap.proposerId, status: "swapped", externalId: `${want.plan.externalId ?? want.plan.id}:swapped:${swap.id}` })
      .where(eq(plans.id, want.plan.id));
    await inner
      .update(listings)
      .set({ status: "sold" })
      .where(and(eq(listings.planId, want.plan.id), inArray(listings.status, ["open", "pending"])));
    await inner
      .update(listings)
      .set({ status: "cancelled" })
      .where(and(eq(listings.planId, swap.offerPlanId), inArray(listings.status, ["open", "pending"])));
  });
}

async function restoreAfterSwap(db: Db, swap: typeof swaps.$inferSelect) {
  const listing = (await db.select().from(listings).where(eq(listings.id, swap.wantListingId)).limit(1))[0];
  if (listing) {
    await db.update(listings).set({ status: "open" }).where(and(eq(listings.id, listing.id), eq(listings.status, "pending")));
  }
  const offer = (await db.select().from(plans).where(eq(plans.id, swap.offerPlanId)).limit(1))[0];
  if (offer) {
    const live = await db
      .select({ id: listings.id })
      .from(listings)
      .where(and(eq(listings.planId, offer.id), inArray(listings.status, ["open", "pending"])))
      .limit(1);
    await db
      .update(plans)
      .set({ status: live[0] ? "listed" : "active" })
      .where(and(eq(plans.id, offer.id), eq(plans.status, "listed")));
  }
}

async function abandonSwap(db: Db, swap: typeof swaps.$inferSelect) {
  await db.update(swaps).set({ status: "cancelled", settleTx: null }).where(and(eq(swaps.id, swap.id), eq(swaps.status, "proposed")));
  await restoreAfterSwap(db, swap);
}

export async function declineSwap(db: Db, userId: string, swapId: string) {
  const rows = await db.select().from(swaps).where(eq(swaps.id, swapId)).limit(1);
  const swap = rows[0];
  if (!swap) throw new HttpError(404, "Swap not found", "not_found");
  if (swap.counterpartyId !== userId) throw new HttpError(403, "That's not yours to decline", "forbidden");
  const updated = await db
    .update(swaps)
    .set({ status: "declined" })
    .where(and(eq(swaps.id, swapId), eq(swaps.status, "proposed")))
    .returning({ id: swaps.id });
  if (!updated[0]) throw new HttpError(409, "Already handled", "illegal_transition");
  await restoreAfterSwap(db, swap);
  return { id: swapId, status: "declined" };
}

export async function recoverStuckSwaps(db: Db, now = new Date()) {
  const rows = await db
    .select()
    .from(swaps)
    .where(eq(swaps.status, "accepted"))
    .orderBy(swaps.createdAt)
    .limit(50);
  const cutoff = now.getTime() - 10 * 60_000;
  let recovered = 0;
  for (const swap of rows) {
    const marker = swap.settleTx;
    if (marker === null) {
      // Never reached the chain, so giving the plans back is safe.
      const released = await db
        .update(swaps)
        .set({ status: "cancelled", settleTx: null })
        .where(and(eq(swaps.id, swap.id), eq(swaps.status, "accepted"), isNull(swaps.settleTx)))
        .returning({ id: swaps.id });
      if (released[0]) {
        await restoreAfterSwap(db, swap);
        recovered++;
      }
      continue;
    }
    if (!marker.startsWith(SETTLING)) continue;
    const startedAt = Number(marker.slice(SETTLING.length));
    if (!Number.isFinite(startedAt) || startedAt > cutoff) continue;
    const claimed = await db
      .update(swaps)
      .set({ settleTx: `${SETTLING}${startedAt}:r` })
      .where(and(eq(swaps.id, swap.id), eq(swaps.settleTx, marker)))
      .returning({ id: swaps.id });
    if (!claimed[0]) continue;
    // References make the retry idempotent, so this finishes the payout rather
    // than returning a leg that may already have paid.
    try {
      const settleTx = await moveDifference(db, swap);
      await finalizeSwap(db, swap, settleTx);
      await log(db, swap.id, "system", "swap.recovered", { settleTx });
      recovered++;
    } catch (error) {
      if ((error as { legOneSent?: boolean }).legOneSent === false) {
        const unwound = await db
          .update(swaps)
          .set({ status: "cancelled", settleTx: null })
          .where(and(eq(swaps.id, swap.id), eq(swaps.status, "accepted"), eq(swaps.settleTx, `${SETTLING}${startedAt}:r`)))
          .returning({ id: swaps.id });
        if (unwound[0]) {
          await restoreAfterSwap(db, swap);
          recovered++;
        }
        continue;
      }
      await db.update(swaps).set({ settleTx: marker }).where(and(eq(swaps.id, swap.id), eq(swaps.settleTx, `${SETTLING}${startedAt}:r`)));
      await log(db, swap.id, "system", "swap.recovery_failed", { error: String(error) });
    }
  }
  return recovered;
}

const BOT_DELAY_MS = 5000;

export async function maybeAutoAccept(db: Db, swapId: string) {
  const rows = await db.select().from(swaps).where(eq(swaps.id, swapId)).limit(1);
  const swap = rows[0];
  if (!swap || swap.status !== "proposed") return;
  if (Date.now() - swap.createdAt.getTime() < BOT_DELAY_MS) return;
  const who = await db.select({ isDemo: users.isDemo }).from(users).where(eq(users.id, swap.counterpartyId)).limit(1);
  if (!who[0]?.isDemo) return;
  try {
    await acceptSwap(db, swap.counterpartyId, swapId);
  } catch {
    // already handled
  }
}

export async function listSwaps(db: Db, userId: string) {
  const rows = await db
    .select()
    .from(swaps)
    .where(or(eq(swaps.proposerId, userId), eq(swaps.counterpartyId, userId)))
    .orderBy(desc(swaps.createdAt))
    .limit(20);
  const out = [];
  for (const swap of rows) {
    await maybeAutoAccept(db, swap.id);
    const fresh = (await db.select().from(swaps).where(eq(swaps.id, swap.id)).limit(1))[0];
    const offerPlan = (await db.select().from(plans).where(eq(plans.id, fresh.offerPlanId)).limit(1))[0];
    const want = (
      await db
        .select({ listing: listings, plan: plans })
        .from(listings)
        .innerJoin(plans, eq(listings.planId, plans.id))
        .where(eq(listings.id, fresh.wantListingId))
        .limit(1)
    )[0];
    out.push({
      id: fresh.id,
      status: fresh.status,
      diffCents: fresh.diffCents,
      settleTx: fresh.settleTx,
      direction: fresh.proposerId === userId ? ("outgoing" as const) : ("incoming" as const),
      offer: offerPlan
        ? {
            id: offerPlan.id,
            title: offerPlan.title,
            city: offerPlan.city,
            startsAt: offerPlan.startsAt.toISOString(),
            imageUrl: offerPlan.imageUrl,
          }
        : null,
      want: want
        ? {
            listingId: want.listing.id,
            title: want.plan.title,
            city: want.plan.city,
            startsAt: want.plan.startsAt.toISOString(),
            imageUrl: want.plan.imageUrl,
            priceCents: want.listing.priceCents,
          }
        : null,
      createdAt: fresh.createdAt.toISOString(),
    });
  }
  return out;
}

export async function countOrdersForPlan(db: Db, planId: string) {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(orders)
    .innerJoin(listings, eq(orders.listingId, listings.id))
    .where(eq(listings.planId, planId));
  return rows[0]?.n ?? 0;
}
