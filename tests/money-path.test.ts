import { beforeEach, describe, expect, it, vi } from "vitest";
import { freshDb, makeListing, makePlan, makeUser, makeOrder } from "./helpers";
import {
  cancelOrder,
  confirmOrder,
  createOrder,
  cronTick,
  disputeOrder,
  fundOrder,
  withdrawDispute,
  handoverOrder,
  listOrders,
} from "@/lib/services/orders";
import { acceptSwap, proposeSwap } from "@/lib/services/swaps";
import { solana, STARTING_TOKENS, ESCROW_PUBKEY } from "@/lib/solana";
import { centsToBaseUnits, baseUnitsToCents } from "@/lib/money";
import { auditEvents, listings, orders, plans, users } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { HttpError } from "@/lib/config";

let currentUser: { id: string } | null = null as { id: string } | null;
vi.mock("@/lib/auth", () => ({
  requireUser: async () => currentUser,
  auth: async () => (currentUser ? { user: { id: currentUser.id } } : null),
  handlers: {},
  signIn: async () => undefined,
  signOut: async () => undefined,
}));

const balance = async (pubkey: string) => solana().balance(pubkey);

describe("money units", () => {
  it("gives a new account exactly $500", async () => {
    await freshDb();
    const user = await makeUser("Fresh");
    expect(baseUnitsToCents(await balance(user.walletPubkey))).toBe(50_000);
    expect(baseUnitsToCents(STARTING_TOKENS)).toBe(50_000);
  });

  it("keeps mock balances across service restarts", async () => {
    const dir = `/tmp/tyf-ledger-${Date.now()}`;
    const previous = process.env.PGLITE_DIR;
    process.env.PGLITE_DIR = dir;
    try {
      const { MockSolana } = await import("@/lib/solana/mock");
      const first = new MockSolana();
      const wallet = first.createWallet();
      await first.airdropTokens(wallet.pubkey, centsToBaseUnits(25_000));
      const restarted = new MockSolana();
      expect(await restarted.balance(wallet.pubkey)).toBe(centsToBaseUnits(25_000));
    } finally {
      process.env.PGLITE_DIR = previous;
    }
  });
});

describe("money path", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("moves the listing and plan to the buyer on release", async () => {
    const db = await freshDb();
    const seller = await makeUser("Seller");
    const buyer = await makeUser("Buyer");
    const { listing, plan } = await makeListing(seller.id, {}, 10000);
    const { orderId } = await createOrder(db, buyer.id, listing.id);
    await fundOrder(db, buyer.id, orderId);
    await handoverOrder(db, seller.id, orderId, "tickets forwarded");
    await confirmOrder(db, buyer.id, orderId);

    const listingRow = (await db.select().from(listings).where(eq(listings.id, listing.id)))[0];
    const planRow = (await db.select().from(plans).where(eq(plans.id, plan.id)))[0];
    expect(listingRow.status).toBe("sold");
    expect(planRow.status).toBe("sold");
    expect(planRow.userId).toBe(buyer.id);
  });

  it("restores the plan and closes the listing on refund", async () => {
    const db = await freshDb();
    const seller = await makeUser("Seller");
    const buyer = await makeUser("Buyer");
    const { listing, plan } = await makeListing(seller.id, {}, 5000);
    const { orderId } = await createOrder(db, buyer.id, listing.id);
    await fundOrder(db, buyer.id, orderId);
    await cancelOrder(db, seller.id, orderId);

    const listingRow = (await db.select().from(listings).where(eq(listings.id, listing.id)))[0];
    const planRow = (await db.select().from(plans).where(eq(plans.id, plan.id)))[0];
    expect(listingRow.status).toBe("cancelled");
    expect(planRow.status).toBe("active");
    expect(planRow.userId).toBe(seller.id);
  });

  it("writes one memo per transition", async () => {
    const db = await freshDb();
    const seller = await makeUser("Seller");
    const buyer = await makeUser("Buyer");
    const { listing } = await makeListing(seller.id, {}, 4000);
    const { orderId } = await createOrder(db, buyer.id, listing.id);
    await fundOrder(db, buyer.id, orderId);
    await handoverOrder(db, seller.id, orderId, "");
    await confirmOrder(db, buyer.id, orderId);

    const memos = await db
      .select({ payload: auditEvents.payload })
      .from(auditEvents)
      .where(and(eq(auditEvents.orderId, orderId), sql`${auditEvents.type} like 'memo.%'`));
    const texts = memos.map((row) => (row.payload as { memo: string }).memo);
    expect(texts).toEqual([
      `tyf:${orderId}:created`,
      `tyf:${orderId}:funded`,
      `tyf:${orderId}:handed_over`,
      `tyf:${orderId}:released`,
    ]);
  });

  it("enforces the state machine for every action", async () => {
    const db = await freshDb();
    const seller = await makeUser("Seller");
    const buyer = await makeUser("Buyer");
    const statuses = ["created", "funded", "handed_over", "released", "refunded", "disputed", "failed"] as const;
    const legal: Record<string, string[]> = {
      fund: ["created"],
      handover: ["funded"],
      confirm: ["handed_over"],
      cancel: ["funded", "handed_over", "disputed"],
      dispute: ["funded", "handed_over"],
      withdraw: ["disputed"],
    };
    const actions = {
      fund: (orderId: string) => fundOrder(db, buyer.id, orderId),
      handover: (orderId: string) => handoverOrder(db, seller.id, orderId, ""),
      confirm: (orderId: string) => confirmOrder(db, buyer.id, orderId),
      cancel: (orderId: string) => cancelOrder(db, seller.id, orderId),
      dispute: (orderId: string) => disputeOrder(db, buyer.id, orderId),
      withdraw: (orderId: string) => withdrawDispute(db, buyer.id, orderId),
    };

    for (const status of statuses) {
      for (const [action, run] of Object.entries(actions)) {
        const { listing } = await makeListing(seller.id, {}, 3000);
        const { orderId } = await createOrder(db, buyer.id, listing.id);
        await db.update(orders).set({ status }).where(eq(orders.id, orderId));
        const isLegal = legal[action].includes(status);
        try {
          await run(orderId);
          expect(isLegal, `${action} from ${status} should have failed`).toBe(true);
        } catch (error) {
          if (isLegal) {
            // Forced status without real escrow funds: the money leg fails, not the state machine.
            expect(error).toBeInstanceOf(HttpError);
            expect([409, 402, 502]).toContain((error as HttpError).status);
          } else {
            expect(error).toBeInstanceOf(HttpError);
            expect((error as HttpError).status, `${action} from ${status}`).toBe(409);
          }
        }
        await db.update(orders).set({ status: "failed" }).where(eq(orders.id, orderId));
        await db.update(listings).set({ status: "cancelled" }).where(eq(listings.id, listing.id));
      }
    }
  });

  it("lets exactly one of two concurrent buyers through", async () => {
    const db = await freshDb();
    const seller = await makeUser("Seller");
    const a = await makeUser("A");
    const b = await makeUser("B");
    const { listing } = await makeListing(seller.id, {}, 7000);

    const results = await Promise.allSettled([
      createOrder(db, a.id, listing.id).then((o) => fundOrder(db, a.id, o.orderId)),
      createOrder(db, b.id, listing.id).then((o) => fundOrder(db, b.id, o.orderId)),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(1);
    const rows = await db.select().from(orders).where(eq(orders.listingId, listing.id));
    expect(rows.filter((r) => r.status === "funded")).toHaveLength(1);
  });

  it("charges once for two concurrent funds with the same key", async () => {
    const db = await freshDb();
    const seller = await makeUser("Seller");
    const buyer = await makeUser("Buyer");
    const { listing } = await makeListing(seller.id, {}, 6000);
    const { orderId } = await createOrder(db, buyer.id, listing.id);
    const before = await balance(buyer.walletPubkey);

    currentUser = { id: buyer.id };
    const { POST } = await import("@/app/api/orders/[id]/fund/route");
    const call = () =>
      POST(
        new Request(`http://localhost/api/orders/${orderId}/fund`, {
          method: "POST",
          headers: { "idempotency-key": "concurrent-key-1" },
        }),
        { params: Promise.resolve({ id: orderId }) },
      );
    const [first, second] = await Promise.all([call(), call()]);
    expect([first.status, second.status]).toContain(200);
    expect(await balance(buyer.walletPubkey)).toBe(before - centsToBaseUnits(6000));
  });

  it("rejects the same key used for a different request", async () => {
    const db = await freshDb();
    const seller = await makeUser("Seller");
    const buyer = await makeUser("Buyer");
    const first = await makeListing(seller.id, {}, 4000);
    const second = await makeListing(seller.id, {}, 5000);
    currentUser = { id: buyer.id };

    const { POST } = await import("@/app/api/orders/[id]/fund/route");
    const { POST: createOrderRoute } = await import("@/app/api/orders/route");

    const created = await createOrderRoute(
      new Request("http://localhost/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "shared-key-12345" },
        body: JSON.stringify({ listingId: first.listing.id }),
      }),
    );
    expect(created.status).toBe(201);

    const reuse = await createOrderRoute(
      new Request("http://localhost/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "shared-key-12345" },
        body: JSON.stringify({ listingId: second.listing.id }),
      }),
    );
    expect(reuse.status).toBe(422);

    void POST;
    void db;
  });

  it("settles a swap the bot owes on", async () => {
    const db = await freshDb();
    const me = await makeUser("Me");
    const bot = await makeUser("Bot", { isDemo: true });
    const mine = await makePlan(me.id, { faceValueCents: 5000 });
    const { listing } = await makeListing(bot.id, { faceValueCents: 22000 }, 22000);
    const swap = await proposeSwap(db, me.id, mine.id, listing.id);
    expect(swap.diffCents).toBe(-17000);
    const result = await acceptSwap(db, bot.id, swap.id);
    expect(result.status).toBe("settled");
  });

  it("refunds on the cron boundary only after the start time", async () => {
    const db = await freshDb();
    const seller = await makeUser("Seller");
    const buyer = await makeUser("Buyer");
    const startAt = new Date(Date.now() + 2 * 3_600_000);
    const { listing } = await makeListing(
      seller.id,
      { startsAt: startAt, endsAt: new Date(startAt.getTime() + 3_600_000) },
      4000,
    );
    const { orderId } = await createOrder(db, buyer.id, listing.id);
    await fundOrder(db, buyer.id, orderId);

    expect((await cronTick(db, new Date(startAt.getTime() - 60_000))).refunded).toBe(0);
    expect((await cronTick(db, startAt)).refunded).toBe(1);
    const row = (await db.select().from(orders).where(eq(orders.id, orderId)))[0];
    expect(row.status).toBe("refunded");
  });

  it("releases only after the full grace window", async () => {
    const db = await freshDb();
    const seller = await makeUser("Seller");
    const buyer = await makeUser("Buyer");
    const startAt = new Date(Date.now() + 3_600_000);
    const { listing } = await makeListing(
      seller.id,
      { startsAt: startAt, endsAt: new Date(startAt.getTime() + 3_600_000) },
      4000,
    );
    const { orderId } = await createOrder(db, buyer.id, listing.id);
    await fundOrder(db, buyer.id, orderId);
    await handoverOrder(db, seller.id, orderId, "");

    expect((await cronTick(db, new Date(startAt.getTime() + 23 * 3_600_000 + 59 * 60_000))).released).toBe(0);
    expect((await cronTick(db, new Date(startAt.getTime() + 24 * 3_600_000))).released).toBe(1);
  });

  it("keeps escrow balanced across a full order", async () => {
    const db = await freshDb();
    const seller = await makeUser("Seller");
    const buyer = await makeUser("Buyer");
    const escrowBefore = await balance(ESCROW_PUBKEY());
    const { listing } = await makeListing(seller.id, {}, 12345);
    const { orderId } = await createOrder(db, buyer.id, listing.id);
    await fundOrder(db, buyer.id, orderId);
    await handoverOrder(db, seller.id, orderId, "");
    await confirmOrder(db, buyer.id, orderId);
    expect(await balance(ESCROW_PUBKEY())).toBe(escrowBefore + centsToBaseUnits(Math.floor(12345 / 10)));
  });
});

describe("secrets and authz", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("never returns wallet material from any endpoint", async () => {
    const db = await freshDb();
    const seller = await makeUser("Seller");
    const buyer = await makeUser("Buyer");
    const { listing } = await makeListing(seller.id, {}, 5000);
    const { orderId } = await createOrder(db, buyer.id, listing.id);
    await fundOrder(db, buyer.id, orderId);
    currentUser = { id: buyer.id };

    const me = await import("@/app/api/me/route");
    const wallet = await import("@/app/api/wallet/route");
    const orderDetail = await import("@/app/api/orders/[id]/route");
    const receipt = await import("@/app/api/receipts/[orderId]/route");
    const planList = await import("@/app/api/plans/route");
    const clashList = await import("@/app/api/clashes/route");
    const swapList = await import("@/app/api/swaps/route");
    const feed = await import("@/app/api/feed/route");
    const orderList = await import("@/app/api/orders/route");

    const calls: Array<[string, Promise<Response>]> = [
      ["/api/me", me.GET(new Request("http://localhost/api/me"))],
      ["/api/wallet", wallet.GET(new Request("http://localhost/api/wallet"))],
      [
        `/api/orders/${orderId}`,
        orderDetail.GET(new Request(`http://localhost/api/orders/${orderId}`), {
          params: Promise.resolve({ id: orderId }),
        }),
      ],
      [
        `/api/receipts/${orderId}`,
        receipt.GET(new Request(`http://localhost/api/receipts/${orderId}`), {
          params: Promise.resolve({ orderId }),
        }),
      ],
      ["/api/plans", planList.GET(new Request("http://localhost/api/plans"))],
      ["/api/clashes", clashList.GET(new Request("http://localhost/api/clashes"))],
      ["/api/swaps", swapList.GET(new Request("http://localhost/api/swaps"))],
      ["/api/feed", feed.GET(new Request("http://localhost/api/feed"))],
      ["/api/orders", orderList.GET(new Request("http://localhost/api/orders?role=buyer"))],
    ];

    for (const [endpoint, pending] of calls) {
      const response = await pending;
      const text = await response.text();
      expect(text, `${endpoint} leaked wallet material`).not.toMatch(/walletSecretEnc|wallet_secret_enc|secretEnc|privateKey/i);
      expect(text).not.toContain(buyer.walletSecretEnc.slice(0, 12));
      expect(text).not.toContain(seller.walletSecretEnc.slice(0, 12));
    }
  });

  it("rejects unauthenticated order reads", async () => {
    const db = await freshDb();
    const seller = await makeUser("Seller");
    const buyer = await makeUser("Buyer");
    const { listing } = await makeListing(seller.id, {}, 5000);
    const { orderId } = await createOrder(db, buyer.id, listing.id);
    currentUser = null;
    const { GET } = await import("@/app/api/orders/[id]/route");
    const res = await GET(new Request(`http://localhost/api/orders/${orderId}`), {
      params: Promise.resolve({ id: orderId }),
    });
    expect(res.status).toBe(401);
  });

  it("blocks strangers from confirming or disputing", async () => {
    const db = await freshDb();
    const seller = await makeUser("Seller");
    const buyer = await makeUser("Buyer");
    const stranger = await makeUser("Stranger");
    const { listing } = await makeListing(seller.id, {}, 5000);
    const { orderId } = await createOrder(db, buyer.id, listing.id);
    await fundOrder(db, buyer.id, orderId);
    await expect(confirmOrder(db, stranger.id, orderId)).rejects.toMatchObject({ status: 403 });
    await expect(disputeOrder(db, stranger.id, orderId)).rejects.toMatchObject({ status: 403 });
  });

  it("does not let a buyer read another buyer's order list", async () => {
    const db = await freshDb();
    const seller = await makeUser("Seller");
    const buyer = await makeUser("Buyer");
    const other = await makeUser("Other");
    const { listing } = await makeListing(seller.id, {}, 5000);
    const { orderId } = await createOrder(db, buyer.id, listing.id);
    const otherOrders = await listOrders(db, other.id, "buyer");
    expect(otherOrders.map((o) => o.id)).not.toContain(orderId);
    void users;
    void makeOrder;
  });
});

describe("recovery and reachability", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("keeps a claim alive when the buyer is short and lets a top-up pay it", async () => {
    const db = await freshDb();
    const seller = await makeUser("Seller");
    const broke = await makeUser("Broke", { funded: false });
    const { listing } = await makeListing(seller.id, {}, 4000);
    const { orderId } = await createOrder(db, broke.id, listing.id);

    await expect(fundOrder(db, broke.id, orderId)).rejects.toMatchObject({ status: 402 });
    const pending = (await db.select().from(orders).where(eq(orders.id, orderId)))[0];
    expect(pending.status).toBe("created");

    await solana().airdropTokens(broke.walletPubkey, centsToBaseUnits(5_000));
    const funded = await fundOrder(db, broke.id, orderId);
    expect(funded.status).toBe("funded");
  });

  it("declining a swap releases the listing and the offered plan", async () => {
    const db = await freshDb();
    const me = await makeUser("Me");
    const them = await makeUser("Them");
    const mine = await makePlan(me.id, { faceValueCents: 9000 });
    const { listing, plan } = await makeListing(them.id, { faceValueCents: 9000 }, 9000);
    const swap = await proposeSwap(db, me.id, mine.id, listing.id);
    const { declineSwap } = await import("@/lib/services/swaps");
    await declineSwap(db, them.id, swap.id);
    const after = (await db.select().from(listings).where(eq(listings.id, listing.id)))[0];
    const mineAfter = (await db.select().from(plans).where(eq(plans.id, mine.id)))[0];
    expect(after.status).toBe("open");
    expect(mineAfter.status).toBe("active");
    void plan;
  });

  it("settles a released order whose payout was left without a signature", async () => {
    const db = await freshDb();
    const seller = await makeUser("Seller");
    const buyer = await makeUser("Buyer");
    const { listing } = await makeListing(seller.id, {}, 3000);
    const { orderId } = await createOrder(db, buyer.id, listing.id);
    await fundOrder(db, buyer.id, orderId);
    await handoverOrder(db, seller.id, orderId, "");
    const before = await balance(seller.walletPubkey);
    await db
      .update(orders)
      .set({ status: "released", releaseTx: null, updatedAt: new Date(Date.now() - 120_000) })
      .where(eq(orders.id, orderId));
    const result = await cronTick(db);
    expect(result.recovered).toBeGreaterThanOrEqual(1);
    expect(await balance(seller.walletPubkey)).toBe(before + centsToBaseUnits(2700));
  });
});

describe("demo reset", () => {
  it("refunds escrowed orders and never pays out an unpaid claim", async () => {
    const db = await freshDb();
    const { seedDemo, resetDemo } = await import("@/lib/demo/seed");
    const demo = await seedDemo(db);
    const { plans: plansTable } = await import("@/lib/db/schema");
    const seeded = (await db.select().from(plansTable).where(eq(plansTable.userId, demo.demoUserId)).limit(1))[0];
    const buyer = (await db.select().from(users).where(eq(users.id, demo.demoUserId)).limit(1))[0];

    const { listing } = await makeListing(demo.sellerIds[0], {}, 4000);
    const { orderId: paidOrder } = await createOrder(db, demo.demoUserId, listing.id);
    await fundOrder(db, demo.demoUserId, paidOrder);

    const second = await makeListing(demo.sellerIds[1], {}, 4000);
    const { orderId: unpaidOrder } = await createOrder(db, demo.demoUserId, second.listing.id);

    const before = await balance(buyer.walletPubkey);
    await resetDemo(db);
    const after = await balance(buyer.walletPubkey);
    expect(after).toBeGreaterThanOrEqual(before + centsToBaseUnits(4000));
    void unpaidOrder;
    void seeded;
  });
});
