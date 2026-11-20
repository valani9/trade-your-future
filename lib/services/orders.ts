import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { auditEvents, listings, orders, plans, users } from "@/lib/db/schema";
import { HttpError } from "@/lib/config";
import { centsToBaseUnits, feeCents, sellerNetCents } from "@/lib/money";
import { solana, ESCROW_PUBKEY } from "@/lib/solana";
import { getWalletSecret } from "@/lib/auth/users";
import { id } from "@/lib/utils";

export type OrderStatus = "created" | "funded" | "handed_over" | "released" | "refunded" | "disputed" | "failed";

export const ORDER_LEGAL: Record<string, OrderStatus[]> = {
  fund: ["created"],
  handover: ["funded"],
  confirm: ["handed_over"],
  cancel: ["funded", "handed_over"],
  dispute: ["funded", "handed_over"],
};

const chains = new Map<string, Promise<void>>();

async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  chains.set(
    key,
    previous.then(() => gate),
  );
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (chains.size > 500) {
      for (const [k, v] of chains) if (v === gate) chains.delete(k);
    }
  }
}

async function logEvent(
  db: Db,
  input: { orderId: string; actorId: string; type: string; payload?: Record<string, unknown> },
) {
  await db.insert(auditEvents).values({
    id: id(),
    orderId: input.orderId,
    actorId: input.actorId,
    type: input.type,
    payload: input.payload ?? {},
  });
}

async function loadOrder(db: Db, orderId: string) {
  const rows = await db
    .select({
      order: orders,
      plan: plans,
      listing: listings,
      buyerName: sql<string>`(select name from users where id = ${orders.buyerId})`,
      sellerName: sql<string>`(select name from users where id = ${orders.sellerId})`,
    })
    .from(orders)
    .innerJoin(listings, eq(orders.listingId, listings.id))
    .innerJoin(plans, eq(listings.planId, plans.id))
    .where(eq(orders.id, orderId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new HttpError(404, "Order not found", "not_found");
  return row;
}

async function recordMemo(db: Db, orderId: string, actorId: string, state: string) {
  try {
    const signature = await solana().memo(orderId, state);
    await db.update(orders).set({ memoTx: signature }).where(eq(orders.id, orderId));
    await logEvent(db, {
      orderId,
      actorId,
      type: `memo.${state}`,
      payload: { memo: `tyf:${orderId}:${state}`, signature },
    });
    return signature;
  } catch {
    return null;
  }
}

async function transition(
  db: Db,
  orderId: string,
  from: OrderStatus[],
  set: Partial<typeof orders.$inferInsert>,
) {
  const rows = await db
    .update(orders)
    .set({ ...set, updatedAt: new Date() })
    .where(and(eq(orders.id, orderId), inArray(orders.status, from)))
    .returning();
  return rows[0];
}

export async function createOrder(db: Db, buyerId: string, listingId: string) {
  const rows = await db
    .select({ listing: listings, plan: plans })
    .from(listings)
    .innerJoin(plans, eq(listings.planId, plans.id))
    .where(eq(listings.id, listingId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new HttpError(404, "Listing not found", "not_found");
  if (row.listing.sellerId === buyerId) throw new HttpError(403, "That's your own listing", "forbidden");
  if (row.listing.status !== "open") throw new HttpError(409, "No longer available", "unavailable");
  if (row.listing.expiresAt.getTime() <= Date.now()) throw new HttpError(409, "This one sold out of time", "expired");

  const claimedListing = await db
    .update(listings)
    .set({ status: "pending" })
    .where(and(eq(listings.id, listingId), eq(listings.status, "open")))
    .returning({ id: listings.id });
  if (!claimedListing[0]) throw new HttpError(409, "Someone else claimed this first", "conflict");

  const amountCents = row.listing.priceCents;
  const orderId = id();
  try {
    await db.insert(orders).values({
      id: orderId,
      listingId,
      buyerId,
      sellerId: row.listing.sellerId,
      amountCents,
      feeCents: feeCents(amountCents),
      status: "created",
    });
  } catch {
    await db.update(listings).set({ status: "open" }).where(and(eq(listings.id, listingId), eq(listings.status, "pending")));
    throw new HttpError(409, "Someone else claimed this first", "conflict");
  }
  await logEvent(db, { orderId, actorId: buyerId, type: "order.created", payload: { amountCents } });
  await recordMemo(db, orderId, buyerId, "created");
  return { orderId, amountCents, feeCents: feeCents(amountCents) };
}

export async function fundOrder(db: Db, userId: string, orderId: string) {
  return withLock(orderId, async () => {
    const { order } = await loadOrder(db, orderId);
    if (order.buyerId !== userId) throw new HttpError(403, "That's not your order", "forbidden");
    if (order.status !== "created") {
      throw new HttpError(409, `Already ${order.status.replace("_", " ")}`, "illegal_transition");
    }

    const wallet = await getWalletSecret(userId);
    const balance = await solana().balance(wallet.pubkey);
    if (balance < centsToBaseUnits(order.amountCents)) {
      const failed = await transition(db, orderId, ["created"], { status: "failed" });
      if (failed) {
        await db.update(listings).set({ status: "open" }).where(eq(listings.id, order.listingId));
        await logEvent(db, { orderId, actorId: userId, type: "order.failed", payload: { reason: "insufficient_funds" } });
        await recordMemo(db, orderId, userId, "failed");
      }
      throw new HttpError(402, "Not enough balance for this one", "insufficient_funds");
    }

    let signature: string;
    try {
      signature = await solana().transfer({
        fromSecretEnc: wallet.secretEnc,
        fromPubkey: wallet.pubkey,
        toPubkey: ESCROW_PUBKEY(),
        baseUnits: centsToBaseUnits(order.amountCents),
      });
    } catch (error) {
      await logEvent(db, { orderId, actorId: userId, type: "order.fund_failed", payload: { error: String(error) } });
      throw new HttpError(502, "Payment didn't go through. Try again.", "payment_failed");
    }

    const claimed = await transition(db, orderId, ["created"], { status: "funded", fundTx: signature });
    if (!claimed) {
      await logEvent(db, {
        orderId,
        actorId: userId,
        type: "order.fund_orphaned",
        payload: { signature, reason: "status moved before the cas" },
      });
      throw new HttpError(409, "Already paid", "illegal_transition");
    }
    await logEvent(db, { orderId, actorId: userId, type: "order.funded", payload: { amountCents: order.amountCents } });
    await recordMemo(db, orderId, userId, "funded");
    return serializeOrder(await loadOrder(db, orderId));
  });
}

export async function handoverOrder(
  db: Db,
  userId: string,
  orderId: string,
  note: string,
  opts: { system?: boolean } = {},
) {
  return withLock(orderId, async () => {
    const { order, plan } = await loadOrder(db, orderId);
    if (!opts.system && order.sellerId !== userId) throw new HttpError(403, "Sellers only", "forbidden");
    if (order.status !== "funded") throw new HttpError(409, "Not ready for handover", "illegal_transition");
    const releaseDueAt = new Date(plan.startsAt.getTime() + 24 * 3_600_000);
    const updated = await transition(db, orderId, ["funded"], {
      status: "handed_over",
      handoverNote: note,
      releaseDueAt,
    });
    if (!updated) throw new HttpError(409, "Not ready for handover", "illegal_transition");
    await logEvent(db, { orderId, actorId: userId, type: "order.handed_over", payload: { note } });
    await recordMemo(db, orderId, userId, "handed_over");
    return serializeOrder(await loadOrder(db, orderId));
  });
}

async function payOut(db: Db, orderId: string, actorId: string, toPubkey: string, baseUnits: bigint) {
  return solana().transferFromEscrow({ toPubkey, baseUnits });
}

async function settleRelease(db: Db, orderId: string, actorId: string) {
  const { order } = await loadOrder(db, orderId);
  if (order.status !== "handed_over") {
    throw new HttpError(409, "Nothing left to release", "illegal_transition");
  }
  const seller = await getWalletSecret(order.sellerId);
  const signature = await payOut(db, orderId, actorId, seller.pubkey, centsToBaseUnits(sellerNetCents(order.amountCents)));
  const claimed = await transition(db, orderId, ["handed_over"], { status: "released", releaseTx: signature });
  if (!claimed) {
    await logEvent(db, {
      orderId,
      actorId,
      type: "order.release_orphaned",
      payload: { signature, reason: "status moved before the cas" },
    });
    throw new HttpError(409, "Already complete", "illegal_transition");
  }
  await db.update(listings).set({ status: "sold" }).where(eq(listings.id, order.listingId));
  await db
    .update(plans)
    .set({ status: "sold", userId: order.buyerId })
    .where(and(eq(plans.id, (await loadOrder(db, orderId)).plan.id), eq(plans.status, "listed")));
  await logEvent(db, {
    orderId,
    actorId,
    type: "order.released",
    payload: { netCents: sellerNetCents(order.amountCents) },
  });
  await recordMemo(db, orderId, actorId, "released");
}

export async function confirmOrder(db: Db, userId: string, orderId: string) {
  return withLock(orderId, async () => {
    const { order } = await loadOrder(db, orderId);
    if (order.buyerId !== userId) throw new HttpError(403, "That's not your order", "forbidden");
    if (order.status !== "handed_over") throw new HttpError(409, "Nothing to confirm yet", "illegal_transition");
    try {
      await settleRelease(db, orderId, userId);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      await logEvent(db, { orderId, actorId: userId, type: "order.payout_failed", payload: { error: String(error) } });
      throw new HttpError(502, "Couldn't complete the payout. Try again.", "payout_failed");
    }
    return serializeOrder(await loadOrder(db, orderId));
  });
}

export async function refundOrder(db: Db, orderId: string, actorId: string) {
  const { order } = await loadOrder(db, orderId);
  if (!["funded", "handed_over"].includes(order.status)) {
    throw new HttpError(409, "Nothing left to refund", "illegal_transition");
  }
  const buyer = await getWalletSecret(order.buyerId);
  const signature = await payOut(db, orderId, actorId, buyer.pubkey, centsToBaseUnits(order.amountCents));
  const claimed = await transition(db, orderId, ["funded", "handed_over"], {
    status: "refunded",
    refundTx: signature,
  });
  if (!claimed) {
    await logEvent(db, {
      orderId,
      actorId,
      type: "order.refund_orphaned",
      payload: { signature, reason: "status moved before the cas" },
    });
    throw new HttpError(409, "Can't refund this one", "illegal_transition");
  }
  await db.update(listings).set({ status: "cancelled" }).where(eq(listings.id, order.listingId));
  const { plan } = await loadOrder(db, orderId);
  await db
    .update(plans)
    .set({ status: "active" })
    .where(and(eq(plans.id, plan.id), inArray(plans.status, ["listed", "sold"])));
  await logEvent(db, { orderId, actorId, type: "order.refunded", payload: { amountCents: order.amountCents } });
  await recordMemo(db, orderId, actorId, "refunded");
}

export async function cancelOrder(db: Db, userId: string, orderId: string) {
  return withLock(orderId, async () => {
    const { order } = await loadOrder(db, orderId);
    if (order.sellerId !== userId) throw new HttpError(403, "Sellers only", "forbidden");
    if (!ORDER_LEGAL.cancel!.includes(order.status)) {
      throw new HttpError(409, "Can't cancel this one", "illegal_transition");
    }
    try {
      await refundOrder(db, orderId, userId);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, "Couldn't refund. Try again.", "refund_failed");
    }
    return serializeOrder(await loadOrder(db, orderId));
  });
}

export async function disputeOrder(db: Db, userId: string, orderId: string) {
  return withLock(orderId, async () => {
    const { order } = await loadOrder(db, orderId);
    if (order.buyerId !== userId) throw new HttpError(403, "Buyers only", "forbidden");
    const updated = await transition(db, orderId, ["funded", "handed_over"], { status: "disputed" });
    if (!updated) throw new HttpError(409, "Can't dispute this one", "illegal_transition");
    await logEvent(db, { orderId, actorId: userId, type: "order.disputed" });
    await recordMemo(db, orderId, userId, "disputed");
    return serializeOrder(await loadOrder(db, orderId));
  });
}

const BOT_DELAY_MS = 5000;

export async function maybeAdvanceBot(db: Db, orderId: string) {
  const { order } = await loadOrder(db, orderId);
  if (order.status !== "funded") return;
  const seller = await db.select({ isDemo: users.isDemo }).from(users).where(eq(users.id, order.sellerId)).limit(1);
  if (!seller[0]?.isDemo) return;
  if (Date.now() - order.updatedAt.getTime() < BOT_DELAY_MS) return;
  try {
    await handoverOrder(db, order.sellerId, orderId, "Sent over. Check your inbox for the tickets.", { system: true });
  } catch {
    // Another request already advanced it.
  }
}

export async function getOrder(db: Db, userId: string, orderId: string) {
  const row = await loadOrder(db, orderId);
  if (row.order.buyerId !== userId && row.order.sellerId !== userId) {
    throw new HttpError(403, "That's not your order", "forbidden");
  }
  await maybeAdvanceBot(db, orderId);
  const fresh = await loadOrder(db, orderId);
  return serializeOrder(fresh);
}

export async function listOrders(db: Db, userId: string, role: "buyer" | "seller") {
  const where = role === "buyer" ? eq(orders.buyerId, userId) : eq(orders.sellerId, userId);
  const rows = await db.select({ id: orders.id }).from(orders).where(where).orderBy(desc(orders.createdAt)).limit(50);
  const out = [];
  for (const row of rows) out.push(serializeOrder(await loadOrder(db, row.id)));
  return out;
}

export async function orderMemos(db: Db, orderId: string, userId: string) {
  const { order } = await loadOrder(db, orderId);
  if (order.buyerId !== userId && order.sellerId !== userId) throw new HttpError(403, "That's not your order", "forbidden");
  const rows = await db
    .select({ payload: auditEvents.payload, type: auditEvents.type })
    .from(auditEvents)
    .where(and(eq(auditEvents.orderId, orderId), sql`${auditEvents.type} like 'memo.%'`))
    .orderBy(auditEvents.createdAt);
  return rows
    .map((row) => row.payload as { memo?: string; signature?: string })
    .filter((payload) => Boolean(payload.signature))
    .map((payload) => ({ memo: payload.memo ?? "", signature: payload.signature as string }));
}

export function serializeOrder(row: Awaited<ReturnType<typeof loadOrder>>) {
  const { order, plan, listing, buyerName, sellerName } = row;
  return {
    id: order.id,
    status: order.status,
    amountCents: order.amountCents,
    feeCents: order.feeCents,
    netCents: sellerNetCents(order.amountCents),
    buyerId: order.buyerId,
    sellerId: order.sellerId,
    buyerName,
    sellerName,
    handoverNote: order.handoverNote,
    releaseDueAt: order.releaseDueAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    fundTx: order.fundTx,
    releaseTx: order.releaseTx,
    refundTx: order.refundTx,
    memoTx: order.memoTx,
    listingId: listing.id,
    plan: {
      id: plan.id,
      title: plan.title,
      venue: plan.venue,
      city: plan.city,
      category: plan.category,
      timeZone: plan.timeZone,
      startsAt: plan.startsAt.toISOString(),
      endsAt: plan.endsAt.toISOString(),
      imageUrl: plan.imageUrl,
      transferability: plan.transferability,
    },
  };
}

export async function cronTick(db: Db, now = new Date()) {
  const dueRelease = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.status, "handed_over"), sql`${orders.releaseDueAt} <= ${now}`));
  let released = 0;
  for (const row of dueRelease) {
    try {
      await withLock(row.id, () => settleRelease(db, row.id, "system"));
      released++;
    } catch {
      // left for the next tick
    }
  }

  const dueRefund = await db
    .select({ id: orders.id })
    .from(orders)
    .innerJoin(listings, eq(orders.listingId, listings.id))
    .innerJoin(plans, eq(listings.planId, plans.id))
    .where(and(eq(orders.status, "funded"), sql`${plans.startsAt} <= ${now}`));
  let refunded = 0;
  for (const row of dueRefund) {
    try {
      await withLock(row.id, () => refundOrder(db, row.id, "system"));
      refunded++;
    } catch {
      // left for the next tick
    }
  }

  const abandoned = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.status, "created"), sql`${orders.createdAt} <= ${new Date(now.getTime() - 30 * 60_000)}`));
  let abandonedCount = 0;
  for (const row of abandoned) {
    try {
      await withLock(row.id, async () => {
        const moved = await transition(db, row.id, ["created"], { status: "failed" });
        if (!moved) return;
        await db.update(listings).set({ status: "open" }).where(eq(listings.id, moved.listingId));
        await logEvent(db, { orderId: row.id, actorId: "system", type: "order.abandoned" });
        await recordMemo(db, row.id, "system", "failed");
        abandonedCount++;
      });
    } catch {
      // left for the next tick
    }
  }
  return { released, refunded, abandoned: abandonedCount };
}
