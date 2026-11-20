import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { freshDb, makeListing, makePlan, makeUser } from "./helpers";
import {
  cancelOrder,
  confirmOrder,
  createOrder,
  cronTick,
  disputeOrder,
  fundOrder,
  handoverOrder,
  undoClaim,
  withdrawDispute,
} from "@/lib/services/orders";
import { acceptSwap, proposeSwap } from "@/lib/services/swaps";
import { cancelListing, createListing } from "@/lib/services/plans";
import { declineSwap } from "@/lib/services/swaps";
import { withIdempotency, type AuthedCtx } from "@/lib/api/helpers";
import { auditEvents, idempotencyKeys, listings, orders, plans, swaps, users } from "@/lib/db/schema";
import { solana, ESCROW_PUBKEY } from "@/lib/solana";
import { baseUnitsToCents, centsToBaseUnits } from "@/lib/money";
import type { Db } from "@/lib/db";

let currentUser: { id: string } | null = null as { id: string } | null;
vi.mock("@/lib/auth", () => ({
  requireUser: async () => currentUser,
  auth: async () => (currentUser ? { user: { id: currentUser.id } } : null),
  handlers: {},
  signIn: async () => undefined,
  signOut: async () => undefined,
}));

const escrowCents = async () => baseUnitsToCents(await solana().balance(ESCROW_PUBKEY()));
const buyerBalance = async (pubkey: string) => baseUnitsToCents(await solana().balance(pubkey));

async function soldOrder(db: Db) {
  const seller = await makeUser("Seller");
  const buyer = await makeUser("Buyer");
  const { listing } = await makeListing(seller.id, {}, 10_000);
  const { orderId } = await createOrder(db, buyer.id, listing.id);
  await fundOrder(db, buyer.id, orderId);
  return { seller, buyer, listing, orderId };
}

describe("disputes", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("won't sell a plan that a swap already moved away", async () => {
    const db = await freshDb();
    const alice = await makeUser("Alice");
    const bob = await makeUser("Bob");
    const craig = await makeUser("Craig");

    const alicePlan = await makePlan(alice.id, { faceValueCents: 20_000 });
    const { listing: bobsListing } = await makeListing(bob.id, {}, 18_000);
    const { id: swapId } = await proposeSwap(db, alice.id, alicePlan.id, bobsListing.id);
    await acceptSwap(db, bob.id, swapId);

    await expect(createListing(db, alice.id, { planId: alicePlan.id, priceCents: 15_000 })).rejects.toThrow(
      /not your plan/,
    );

    // Even a listing left over from before the swap cannot be bought.
    const staleId = crypto.randomUUID();
    await db.insert(listings).values({
      id: staleId,
      planId: alicePlan.id,
      sellerId: alice.id,
      priceCents: 15_000,
      suggestedPriceCents: 15_000,
      status: "open",
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await expect(createOrder(db, craig.id, staleId)).rejects.toThrow(/No longer available/);
  });

  it("returns the payer's money when a retry of the same swap fails again", async () => {
    const db = await freshDb();
    const seller = await makeUser("Seller", { funded: false });
    const buyer = await makeUser("Buyer");
    const mine = await makePlan(buyer.id, { faceValueCents: 30_000 });
    const { listing } = await makeListing(seller.id, {}, 10_000);
    const { id: swapId } = await proposeSwap(db, buyer.id, mine.id, listing.id);

    const escrowBefore = await escrowCents();
    await expect(acceptSwap(db, seller.id, swapId)).rejects.toThrow(/short on balance/);
    expect(await escrowCents()).toBe(escrowBefore);

    const sellerWallet = (await db.select().from(users).where(eq(users.id, seller.id)).limit(1))[0];
    await solana().airdropTokens(sellerWallet.walletPubkey, centsToBaseUnits(30_000));
    await expect(acceptSwap(db, seller.id, swapId)).resolves.toMatchObject({ status: "settled" });
    const [row] = await db.select().from(swaps).where(eq(swaps.id, swapId));
    expect(row.status).toBe("settled");
  });

  it("decline gives back a leg one that had already gone out", async () => {
    const db = await freshDb();
    const seller = await makeUser("Seller");
    const buyer = await makeUser("Buyer");
    const mine = await makePlan(buyer.id, { faceValueCents: 30_000 });
    const { listing } = await makeListing(seller.id, {}, 10_000);
    const { id: swapId } = await proposeSwap(db, buyer.id, mine.id, listing.id);

    await solana().transfer({
      fromSecretEnc: (await db.select().from(users).where(eq(users.id, buyer.id)).limit(1))[0].walletSecretEnc,
      fromPubkey: buyer.walletPubkey,
      toPubkey: ESCROW_PUBKEY(),
      baseUnits: centsToBaseUnits(20_000),
    });
    const attempt = `leg1:${buyer.id}:${centsToBaseUnits(20_000).toString()}:decline-case`;
    await db.update(swaps).set({ settleTx: attempt }).where(eq(swaps.id, swapId));

    const before = await buyerBalance(buyer.walletPubkey);
    await declineSwap(db, seller.id, swapId);
    expect(await buyerBalance(buyer.walletPubkey)).toBe(before + 20_000);
  });
});

describe("release recovery", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("marks an order released before moving money, so a crash cannot pay twice", async () => {
    const db = await freshDb();
    const { seller, buyer, orderId } = await soldOrder(db);
    await handoverOrder(db, seller.id, orderId, "");
    await confirmOrder(db, buyer.id, orderId);

    const sending = await db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(and(eq(auditEvents.orderId, orderId), eq(auditEvents.type, "order.release_sending")));
    expect(sending).toHaveLength(1);
    const [row] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(row.status).toBe("released");
    expect(row.releaseTx).toBeTruthy();
  });

  it("finishes a release that died between the state change and the transfer", async () => {
    const db = await freshDb();
    const { seller, buyer, orderId } = await soldOrder(db);
    await handoverOrder(db, seller.id, orderId, "");
    await db
      .update(orders)
      .set({ status: "released", releaseTx: null, updatedAt: new Date(Date.now() - 120_000) })
      .where(eq(orders.id, orderId));

    const before = await buyerBalance(seller.walletPubkey);
    const escrowBefore = await escrowCents();
    const result = await cronTick(db);
    expect(result.recovered).toBe(1);
    expect(await buyerBalance(seller.walletPubkey)).toBe(before + 9_000);
    expect(await escrowCents()).toBe(escrowBefore - 9_000);

    const [row] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(row.releaseTx).toBeTruthy();
    const [plan] = await db.select().from(plans).where(eq(plans.id, (await db.select().from(listings).where(eq(listings.id, row.listingId)))[0].planId));
    expect(plan.userId).toBe(buyer.id);
    expect(plan.status).toBe("sold");

    await cronTick(db);
    expect(await buyerBalance(seller.walletPubkey)).toBe(before + 9_000);
  });

  it("does not pay twice when the transfer already went out and the record is missing", async () => {
    const db = await freshDb();
    const { seller, buyer, orderId } = await soldOrder(db);
    await handoverOrder(db, seller.id, orderId, "");
    await db
      .update(orders)
      .set({ status: "released", releaseTx: null, updatedAt: new Date(Date.now() - 120_000) })
      .where(eq(orders.id, orderId));
    await db.insert(auditEvents).values({
      id: crypto.randomUUID(),
      orderId,
      actorId: "system",
      type: "order.release_sending",
      payload: {},
    });

    const wallet = await db.select().from(users).where(eq(users.id, seller.id)).limit(1);
    await solana().transferFromEscrow({
      toPubkey: wallet[0].walletPubkey,
      baseUnits: centsToBaseUnits(9_000),
      reference: `release:${orderId}`,
    });
    const afterLanding = await buyerBalance(seller.walletPubkey);

    await cronTick(db);
    expect(await buyerBalance(seller.walletPubkey)).toBe(afterLanding);

    const [row] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(row.releaseTx).toBeTruthy();
    expect(row.status).toBe("released");
  });
});

describe("idempotency", () => {
  beforeEach(async () => {
    await freshDb();
  });

  function ctxFor(db: Db, userId: string, key: string, bodyText = "{}"): AuthedCtx {
    return {
      userId,
      db,
      request: new Request("http://localhost/api/wallet/fund", {
        method: "POST",
        headers: { "idempotency-key": key, "content-type": "application/json" },
        body: bodyText,
      }),
    };
  }

  it("runs the handler once when the same request arrives twice at the same time", async () => {
    const db = await freshDb();
    const user = await makeUser("Buyer");
    let runs = 0;
    const handler = async () => {
      runs++;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { status: 200, body: { ok: true, runs } };
    };

    const [first, second] = await Promise.allSettled([
      withIdempotency(ctxFor(db, user.id, "same-key-1234"), "wallet.fund", handler),
      withIdempotency(ctxFor(db, user.id, "same-key-1234"), "wallet.fund", handler),
    ]);

    expect(runs).toBe(1);
    const settled = [first, second].filter((r) => r.status === "fulfilled");
    const rejected = [first, second].filter((r) => r.status === "rejected");
    expect(settled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });

  it("replays the stored response on a later retry", async () => {
    const db = await freshDb();
    const user = await makeUser("Buyer");
    let runs = 0;
    const handler = async () => {
      runs++;
      return { status: 201, body: { ok: true, runs } };
    };

    const first = await withIdempotency(ctxFor(db, user.id, "retry-key-1234"), "wallet.fund", handler);
    expect(first.status).toBe(201);
    const second = await withIdempotency(ctxFor(db, user.id, "retry-key-1234"), "wallet.fund", handler);
    expect(second.status).toBe(201);
    expect(await second.json()).toEqual({ ok: true, runs: 1 });
    expect(runs).toBe(1);
  });

  it("refuses a key reused with a different body", async () => {
    const db = await freshDb();
    const user = await makeUser("Buyer");
    const handler = async () => ({ status: 200, body: { ok: true } });
    await withIdempotency(ctxFor(db, user.id, "body-key-1234", '{"amount":5}'), "wallet.fund", handler);

    await expect(
      withIdempotency(ctxFor(db, user.id, "body-key-1234", '{"amount":500}'), "wallet.fund", handler),
    ).rejects.toThrow(/already used for a different request/);
  });

  it("clears the claim when the handler throws, so a retry can succeed", async () => {
    const db = await freshDb();
    const user = await makeUser("Buyer");
    await expect(
      withIdempotency(ctxFor(db, user.id, "throw-key-1234"), "wallet.fund", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow(/boom/);

    const rows = await db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.userId, user.id), eq(idempotencyKeys.key, "throw-key-1234")));
    expect(rows).toHaveLength(0);
  });

  it("steals a claim left behind by a crashed request", async () => {
    const db = await freshDb();
    const user = await makeUser("Buyer");
    await db.insert(idempotencyKeys).values({
      id: crypto.randomUUID(),
      userId: user.id,
      scope: "wallet.fund",
      key: "stale-key-1234",
      statusCode: 0,
      body: { __fingerprint: "unused", __pending: true },
      createdAt: new Date(Date.now() - 10 * 60_000),
    });

    const response = await withIdempotency(ctxFor(db, user.id, "stale-key-1234"), "wallet.fund", async () => ({
      status: 200,
      body: { recovered: true },
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ recovered: true });
    void sql;
    void centsToBaseUnits;
  });
});

describe("marketplace rules under pressure", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("refuses a second listing while the first sale is being paid for", async () => {
    const db = await freshDb();
    const seller = await makeUser("Seller");
    const buyer = await makeUser("Buyer");
    const other = await makeUser("Other");
    const { listing, plan } = await makeListing(seller.id, {}, 20_000);

    const { orderId } = await createOrder(db, buyer.id, listing.id);
    await expect(createListing(db, seller.id, { planId: plan.id, priceCents: 25_000 })).rejects.toThrow(/Already on sale/);
    void orderId;
    void other;
  });

  it("sells a plan to exactly one buyer even if it is listed again after the claim", async () => {
    const db = await freshDb();
    const seller = await makeUser("Seller");
    const a = await makeUser("A");
    const b = await makeUser("B");
    const { listing, plan } = await makeListing(seller.id, {}, 20_000);

    const { orderId } = await createOrder(db, a.id, listing.id);
    await expect(createListing(db, seller.id, { planId: plan.id, priceCents: 20_000 })).rejects.toThrow();
    const open = await db
      .select()
      .from(listings)
      .where(and(eq(listings.planId, plan.id), eq(listings.status, "open")));
    expect(open).toHaveLength(0);
    await expect(createOrder(db, b.id, listing.id)).rejects.toThrow();
    void orderId;
  });

  it("won't let a seller withdraw a listing someone is paying for", async () => {
    const db = await freshDb();
    const seller = await makeUser("Seller");
    const buyer = await makeUser("Buyer");
    const { listing } = await makeListing(seller.id, {}, 20_000);
    await createOrder(db, buyer.id, listing.id);

    await expect(cancelListing(db, seller.id, listing.id)).rejects.toThrow(/paying for this right now/);
    const [row] = await db.select().from(listings).where(eq(listings.id, listing.id));
    expect(row.status).toBe("pending");
  });

  it("gives an undone claim its listing back and refunds a paid one", async () => {
    const db = await freshDb();
    const seller = await makeUser("Seller");
    const buyer = await makeUser("Buyer");
    const { listing } = await makeListing(seller.id, {}, 20_000);
    const { orderId } = await createOrder(db, buyer.id, listing.id);

    await undoClaim(db, buyer.id, orderId);
    const [afterUndo] = await db.select().from(listings).where(eq(listings.id, listing.id));
    expect(afterUndo.status).toBe("open");

    const { orderId: second } = await createOrder(db, buyer.id, listing.id);
    await fundOrder(db, buyer.id, second);
    const before = await buyerBalance(buyer.walletPubkey);
    await undoClaim(db, buyer.id, second);
    expect(await buyerBalance(buyer.walletPubkey)).toBe(before + 20_000);
    const [afterRefund] = await db.select().from(listings).where(eq(listings.id, listing.id));
    expect(afterRefund.status).toBe("open");
    const [planRow] = await db.select().from(plans).where(eq(plans.id, listing.planId));
    expect(planRow.status).toBe("listed");
  });

  it("refuses to undo somebody else's order", async () => {
    const db = await freshDb();
    const seller = await makeUser("Seller");
    const buyer = await makeUser("Buyer");
    const { listing } = await makeListing(seller.id, {}, 20_000);
    const { orderId } = await createOrder(db, buyer.id, listing.id);
    await expect(undoClaim(db, seller.id, orderId)).rejects.toThrow(/not your order/);
  });

  it("won't swap a plan that already started", async () => {
    const db = await freshDb();
    const seller = await makeUser("Seller");
    const buyer = await makeUser("Buyer");
    const started = new Date(Date.now() - 2 * 3_600_000);
    const mine = await makePlan(buyer.id, { startsAt: started, endsAt: new Date(started.getTime() + 3_600_000) });
    const { listing } = await makeListing(seller.id, {}, 20_000);

    await expect(proposeSwap(db, buyer.id, mine.id, listing.id)).rejects.toThrow(/already started/);
  });

  it("puts the listing and plan back when a swap payment fails, and returns what it took", async () => {
    const db = await freshDb();
    const seller = await makeUser("Seller", { funded: false });
    const buyer = await makeUser("Buyer");
    const mine = await makePlan(buyer.id, { faceValueCents: 30_000 });
    const { listing, plan } = await makeListing(seller.id, {}, 10_000);
    const { id: swapId } = await proposeSwap(db, buyer.id, mine.id, listing.id);

    const escrowBefore = await escrowCents();
    await expect(acceptSwap(db, seller.id, swapId)).rejects.toThrow(/short on balance|didn't go through/);

    const [swapRow] = await db.select().from(swaps).where(eq(swaps.id, swapId));
    expect(swapRow.status).toBe("proposed");
    const [listingRow] = await db.select().from(listings).where(eq(listings.id, listing.id));
    expect(listingRow.status).toBe("open");
    const [planRow] = await db.select().from(plans).where(eq(plans.id, plan.id));
    expect(planRow.status).toBe("listed");
    expect(await escrowCents()).toBe(escrowBefore);
  });
});
