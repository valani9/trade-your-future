import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
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
    throw new HttpError(409, "Someone else claimed this first", "conflict");
  }
  await db.update(listings).set({ status: "pending" }).where(eq(listings.id, listingId));
  await logEvent(db, { orderId, actorId: buyerId, type: "order.created", payload: { amountCents } });
  return { orderId, amountCents, feeCents: feeCents(amountCents) };
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

async function recordMemo(db: Db, orderId: string, state: string) {
  try {
    const signature = await solana().memo(orderId, state);
    await db.update(orders).set({ memoTx: signature }).where(eq(orders.id, orderId));
    return signature;
  } catch {
    return null;
  }
}

export async function fundOrder(db: Db, userId: string, orderId: string) {
  const { order } = await loadOrder(db, orderId);
  if (order.buyerId !== userId) throw new HttpError(403, "That's not your order", "forbidden");
  if (order.status !== "created") throw new HttpError(409, `Already ${order.status.replace("_", " ")}`, "illegal_transition");

  const wallet = await getWalletSecret(userId);
  const balance = await solana().balance(wallet.pubkey);
  if (balance < centsToBaseUnits(order.amountCents)) {
    const failed = await transition(db, orderId, ["created"], { status: "failed" });
    if (failed) {
      await db.update(listings).set({ status: "open" }).where(eq(listings.id, order.listingId));
      await logEvent(db, { orderId, actorId: userId, type: "order.failed", payload: { reason: "insufficient_funds" } });
    }
    throw new HttpError(402, "Not enough balance for this one", "insufficient_funds");
  }

  const claimed = await transition(db, orderId, ["created"], { status: "funded" });
  if (!claimed) throw new HttpError(409, "Already paid", "illegal_transition");

  try {
    const signature = await solana().transfer({
      fromSecretEnc: wallet.secretEnc,
      fromPubkey: wallet.pubkey,
      toPubkey: ESCROW_PUBKEY(),
      baseUnits: centsToBaseUnits(order.amountCents),
    });
    await db.update(orders).set({ fundTx: signature }).where(eq(orders.id, orderId));
    await db.update(plans).set({ status: "sold" }).where(eq(plans.id, (await loadOrder(db, orderId)).plan.id));
    await recordMemo(db, orderId, "funded");
    await logEvent(db, { orderId, actorId: userId, type: "order.funded", payload: { amountCents: order.amountCents } });
  } catch (error) {
    await transition(db, orderId, ["funded"], { status: "created" });
    await logEvent(db, { orderId, actorId: userId, type: "order.fund_failed", payload: { error: String(error) } });
    throw new HttpError(502, "Payment didn't go through. Try again.", "payment_failed");
  }
  return serializeOrder(await loadOrder(db, orderId));
}

export async function handoverOrder(
  db: Db,
  userId: string,
  orderId: string,
  note: string,
  opts: { system?: boolean } = {},
) {
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
  await recordMemo(db, orderId, "handed_over");
  await logEvent(db, { orderId, actorId: userId, type: "order.handed_over", payload: { note } });
  return serializeOrder(await loadOrder(db, orderId));
}

export async function confirmOrder(db: Db, userId: string, orderId: string) {
  const { order } = await loadOrder(db, orderId);
  if (order.buyerId !== userId) throw new HttpError(403, "That's not your order", "forbidden");
  if (order.status !== "handed_over") throw new HttpError(409, "Nothing to confirm yet", "illegal_transition");

  const claimed = await transition(db, orderId, ["handed_over"], { status: "released" });
  if (!claimed) throw new HttpError(409, "Already complete", "illegal_transition");

  const seller = await getWalletSecret(order.sellerId);
  try {
    const signature = await solana().transferFromEscrow({
      toPubkey: seller.pubkey,
      baseUnits: centsToBaseUnits(sellerNetCents(order.amountCents)),
    });
    await db.update(orders).set({ releaseTx: signature }).where(eq(orders.id, orderId));
    await recordMemo(db, orderId, "released");
    await logEvent(db, {
      orderId,
      actorId: userId,
      type: "order.released",
      payload: { netCents: sellerNetCents(order.amountCents) },
    });
  } catch (error) {
    await transition(db, orderId, ["released"], { status: "handed_over" });
    throw new HttpError(502, "Couldn't complete the payout. Try again.", "payout_failed");
  }
  return serializeOrder(await loadOrder(db, orderId));
}

export async function cancelOrder(db: Db, userId: string, orderId: string) {
  const { order } = await loadOrder(db, orderId);
  if (order.sellerId !== userId) throw new HttpError(403, "Sellers only", "forbidden");
  if (!ORDER_LEGAL.cancel!.includes(order.status)) throw new HttpError(409, "Can't cancel this one", "illegal_transition");

  const claimed = await transition(db, orderId, ["funded", "handed_over"], { status: "refunded" });
  if (!claimed) throw new HttpError(409, "Can't cancel this one", "illegal_transition");

  const buyer = await getWalletSecret(order.buyerId);
  try {
    const signature = await solana().transferFromEscrow({
      toPubkey: buyer.pubkey,
      baseUnits: centsToBaseUnits(order.amountCents),
    });
    await db.update(orders).set({ refundTx: signature }).where(eq(orders.id, orderId));
    await recordMemo(db, orderId, "refunded");
  } catch {
    await transition(db, orderId, ["refunded"], { status: order.status });
    throw new HttpError(502, "Couldn't refund. Try again.", "refund_failed");
  }
  await db.update(listings).set({ status: "cancelled" }).where(eq(listings.id, order.listingId));
  await logEvent(db, { orderId, actorId: userId, type: "order.refunded" });
  return serializeOrder(await loadOrder(db, orderId));
}

export async function disputeOrder(db: Db, userId: string, orderId: string) {
  const { order } = await loadOrder(db, orderId);
  if (order.buyerId !== userId) throw new HttpError(403, "Buyers only", "forbidden");
  const updated = await transition(db, orderId, ["funded", "handed_over"], { status: "disputed" });
  if (!updated) throw new HttpError(409, "Can't dispute this one", "illegal_transition");
  await recordMemo(db, orderId, "disputed");
  await logEvent(db, { orderId, actorId: userId, type: "order.disputed" });
  return serializeOrder(await loadOrder(db, orderId));
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
  const due = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.status, "handed_over"), sql`${orders.releaseDueAt} <= ${now}`));
  let released = 0;
  for (const row of due) {
    const { order } = await loadOrder(db, row.id);
    const claimed = await transition(db, row.id, ["handed_over"], { status: "released" });
    if (!claimed) continue;
    const seller = await getWalletSecret(order.sellerId);
    try {
      const signature = await solana().transferFromEscrow({
        toPubkey: seller.pubkey,
        baseUnits: centsToBaseUnits(sellerNetCents(order.amountCents)),
      });
      await db.update(orders).set({ releaseTx: signature }).where(eq(orders.id, row.id));
      await recordMemo(db, row.id, "released");
      await logEvent(db, { orderId: row.id, actorId: "system", type: "order.auto_released" });
      released++;
    } catch {
      await transition(db, row.id, ["released"], { status: "handed_over" });
    }
  }

  const refundable = await db
    .select({ id: orders.id })
    .from(orders)
    .innerJoin(listings, eq(orders.listingId, listings.id))
    .innerJoin(plans, eq(listings.planId, plans.id))
    .where(and(eq(orders.status, "funded"), sql`${plans.startsAt} <= ${now}`));
  let refunded = 0;
  for (const row of refundable) {
    const { order } = await loadOrder(db, row.id);
    const claimed = await transition(db, row.id, ["funded"], { status: "refunded" });
    if (!claimed) continue;
    const buyer = await getWalletSecret(order.buyerId);
    try {
      const signature = await solana().transferFromEscrow({
        toPubkey: buyer.pubkey,
        baseUnits: centsToBaseUnits(order.amountCents),
      });
      await db.update(orders).set({ refundTx: signature }).where(eq(orders.id, row.id));
      await recordMemo(db, row.id, "refunded");
      await db
        .update(listings)
        .set({ status: "expired" })
        .where(and(eq(listings.id, order.listingId), inArray(listings.status, ["open", "pending"])));
      await logEvent(db, { orderId: row.id, actorId: "system", type: "order.auto_refunded" });
      refunded++;
    } catch {
      await transition(db, row.id, ["refunded"], { status: "funded" });
    }
  }
  return { released, refunded };
}

export { or };
