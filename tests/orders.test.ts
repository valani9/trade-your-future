import { beforeEach, describe, expect, it, vi } from "vitest";
import { freshDb, makeListing, makeUser } from "./helpers";
import { createOrder, fundOrder, handoverOrder, confirmOrder, cancelOrder, cronTick, getOrder, listOrders } from "@/lib/services/orders";
import { solana, ESCROW_PUBKEY, STARTING_TOKENS } from "@/lib/solana";
import { centsToBaseUnits } from "@/lib/money";
import { orders } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
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

describe("order state machine", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("runs the happy path and splits 90/10", async () => {
    const db = await freshDb();
    const seller = await makeUser("Seller");
    const buyer = await makeUser("Buyer");
    const { listing } = await makeListing(seller.id, {}, 10000);
    const sellerBefore = await balance(seller.walletPubkey);
    const buyerBefore = await balance(buyer.walletPubkey);
    const escrowBefore = await balance(ESCROW_PUBKEY());

    const { orderId } = await createOrder(db, buyer.id, listing.id);
    await fundOrder(db, buyer.id, orderId);
    expect(await balance(buyer.walletPubkey)).toBe(buyerBefore - centsToBaseUnits(10000));
    expect(await balance(ESCROW_PUBKEY())).toBe(escrowBefore + centsToBaseUnits(10000));

    await handoverOrder(db, seller.id, orderId, "Sent to your email");
    const done = await confirmOrder(db, buyer.id, orderId);
    expect(done.status).toBe("released");
    expect(await balance(seller.walletPubkey)).toBe(sellerBefore + centsToBaseUnits(9000));
    expect(await balance(ESCROW_PUBKEY())).toBe(escrowBefore + centsToBaseUnits(1000));
  });

  it("rounds the fee down to the cent", async () => {
    const db = await freshDb();
    const seller = await makeUser("Seller");
    const buyer = await makeUser("Buyer");
    const { listing } = await makeListing(seller.id, {}, 1005);
    const { orderId } = await createOrder(db, buyer.id, listing.id);
    await fundOrder(db, buyer.id, orderId);
    await handoverOrder(db, seller.id, orderId, "");
    const done = await confirmOrder(db, buyer.id, orderId);
    expect(done.feeCents).toBe(100);
    expect(done.netCents).toBe(905);
  });

  it("keeps the claim when the buyer is short, so a top-up can pay it", async () => {
    const db = await freshDb();
    const seller = await makeUser("Seller");
    const broke = await makeUser("Broke", { funded: false });
    const { listing } = await makeListing(seller.id, {}, 10000);
    const { orderId } = await createOrder(db, broke.id, listing.id);
    await expect(fundOrder(db, broke.id, orderId)).rejects.toMatchObject({ status: 402 });
    const row = (await db.select().from(orders).where(eq(orders.id, orderId)))[0];
    expect(row.status).toBe("created");
    const held = await db.execute<{ status: string }>(`select status from listings where id = '${listing.id}'`);
    expect((held as unknown as { rows: [{ status: string }] }).rows[0].status).toBe("pending");
  });

  it("rejects illegal transitions with 409", async () => {
    const db = await freshDb();
    const seller = await makeUser("Seller");
    const buyer = await makeUser("Buyer");
    const { listing } = await makeListing(seller.id, {}, 8000);
    const { orderId } = await createOrder(db, buyer.id, listing.id);

    await expect(confirmOrder(db, buyer.id, orderId)).rejects.toMatchObject({ status: 409 });
    await expect(handoverOrder(db, seller.id, orderId, "")).rejects.toMatchObject({ status: 409 });

    await fundOrder(db, buyer.id, orderId);
    await expect(fundOrder(db, buyer.id, orderId)).rejects.toMatchObject({ status: 409 });
    await expect(handoverOrder(db, buyer.id, orderId, "")).rejects.toMatchObject({ status: 403 });
    await expect(confirmOrder(db, buyer.id, orderId)).rejects.toMatchObject({ status: 409 });

    await handoverOrder(db, seller.id, orderId, "");
    await expect(handoverOrder(db, seller.id, orderId, "")).rejects.toMatchObject({ status: 409 });
  });

  it("blocks other users from touching an order", async () => {
    const db = await freshDb();
    const seller = await makeUser("Seller");
    const buyer = await makeUser("Buyer");
    const stranger = await makeUser("Stranger");
    const { listing } = await makeListing(seller.id, {}, 5000);
    const { orderId } = await createOrder(db, buyer.id, listing.id);

    await expect(fundOrder(db, stranger.id, orderId)).rejects.toMatchObject({ status: 403 });
    await expect(getOrder(db, stranger.id, orderId)).rejects.toMatchObject({ status: 403 });
    await fundOrder(db, buyer.id, orderId);
    await expect(cancelOrder(db, stranger.id, orderId)).rejects.toMatchObject({ status: 403 });
    await expect(handoverOrder(db, stranger.id, orderId, "")).rejects.toMatchObject({ status: 403 });
  });

  it("only lets one buyer claim a listing", async () => {
    const db = await freshDb();
    const seller = await makeUser("Seller");
    const a = await makeUser("A");
    const b = await makeUser("B");
    const { listing } = await makeListing(seller.id, {}, 5000);
    await createOrder(db, a.id, listing.id);
    await expect(createOrder(db, b.id, listing.id)).rejects.toMatchObject({ status: 409 });
  });

  it("keeps the order open when the transfer fails, then retries", async () => {
    const db = await freshDb();
    const seller = await makeUser("Seller");
    const buyer = await makeUser("Buyer");
    const { listing } = await makeListing(seller.id, {}, 5000);
    const { orderId } = await createOrder(db, buyer.id, listing.id);

    const service = solana();
    const spy = vi.spyOn(service, "transfer").mockRejectedValueOnce(new Error("rpc down"));
    await expect(fundOrder(db, buyer.id, orderId)).rejects.toMatchObject({ status: 502 });
    spy.mockRestore();

    const row = (await db.select().from(orders).where(eq(orders.id, orderId)))[0];
    expect(row.status).toBe("created");
    const funded = await fundOrder(db, buyer.id, orderId);
    expect(funded.status).toBe("funded");
  });

  it("replays an idempotent fund without a second transfer", async () => {
    const db = await freshDb();
    const seller = await makeUser("Seller");
    const buyer = await makeUser("Buyer");
    const { listing } = await makeListing(seller.id, {}, 5000);
    const { orderId } = await createOrder(db, buyer.id, listing.id);
    const before = await balance(buyer.walletPubkey);

    currentUser = { id: buyer.id };
    const { POST } = await import("@/app/api/orders/[id]/fund/route");
    const make = () =>
      POST(
        new Request(`http://localhost/api/orders/${orderId}/fund`, {
          method: "POST",
          headers: { "idempotency-key": "same-key-123456" },
        }),
        { params: Promise.resolve({ id: orderId }) },
      );
    const first = await make();
    const second = await make();
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await balance(buyer.walletPubkey)).toBe(before - centsToBaseUnits(5000));
  });

  it("requires an Idempotency-Key on order actions", async () => {
    const db = await freshDb();
    const seller = await makeUser("Seller");
    const buyer = await makeUser("Buyer");
    const { listing } = await makeListing(seller.id, {}, 5000);
    const { orderId } = await createOrder(db, buyer.id, listing.id);
    currentUser = { id: buyer.id };
    const { POST } = await import("@/app/api/orders/[id]/fund/route");
    const res = await POST(new Request(`http://localhost/api/orders/${orderId}/fund`, { method: "POST" }), {
      params: Promise.resolve({ id: orderId }),
    });
    expect(res.status).toBe(400);
  });

  it("refunds the buyer when the seller cancels", async () => {
    const db = await freshDb();
    const seller = await makeUser("Seller");
    const buyer = await makeUser("Buyer");
    const { listing } = await makeListing(seller.id, {}, 5000);
    const before = await balance(buyer.walletPubkey);
    const { orderId } = await createOrder(db, buyer.id, listing.id);
    await fundOrder(db, buyer.id, orderId);
    const refunded = await cancelOrder(db, seller.id, orderId);
    expect(refunded.status).toBe("refunded");
    expect(await balance(buyer.walletPubkey)).toBe(before);
  });

  it("auto-refunds funded orders past the event start", async () => {
    const db = await freshDb();
    const seller = await makeUser("Seller");
    const buyer = await makeUser("Buyer");
    const { listing } = await makeListing(
      seller.id,
      { startsAt: new Date(Date.now() + 3_600_000), endsAt: new Date(Date.now() + 7_200_000) },
      5000,
    );
    const { orderId } = await createOrder(db, buyer.id, listing.id);
    await fundOrder(db, buyer.id, orderId);
    const later = new Date(Date.now() + 2 * 3_600_000);
    const result = await cronTick(db, later);
    expect(result.refunded).toBe(1);
    const row = (await db.select().from(orders).where(eq(orders.id, orderId)))[0];
    expect(row.status).toBe("refunded");
  });

  it("auto-releases handed over orders after the grace window", async () => {
    const db = await freshDb();
    const seller = await makeUser("Seller");
    const buyer = await makeUser("Buyer");
    const startAt = new Date(Date.now() + 3_600_000);
    const { listing } = await makeListing(seller.id, { startsAt: startAt, endsAt: new Date(startAt.getTime() + 3_600_000) }, 5000);
    const { orderId } = await createOrder(db, buyer.id, listing.id);
    await fundOrder(db, buyer.id, orderId);
    await handoverOrder(db, seller.id, orderId, "");
    const result = await cronTick(db, new Date(startAt.getTime() + 25 * 3_600_000));
    expect(result.released).toBe(1);
    const row = (await db.select().from(orders).where(eq(orders.id, orderId)))[0];
    expect(row.status).toBe("released");
  });

  it("never exposes wallet secrets in API payloads", async () => {
    const db = await freshDb();
    const seller = await makeUser("Seller");
    const buyer = await makeUser("Buyer");
    const { listing } = await makeListing(seller.id, {}, 5000);
    const { orderId } = await createOrder(db, buyer.id, listing.id);
    await fundOrder(db, buyer.id, orderId);
    const payload = JSON.stringify(await listOrders(db, buyer.id, "buyer"));
    expect(payload).not.toMatch(/walletSecret|secretEnc|privateKey/i);
    expect(payload).not.toContain(buyer.walletSecretEnc.slice(0, 12));
    void orders;
    void HttpError;
    void STARTING_TOKENS;
  });
});
