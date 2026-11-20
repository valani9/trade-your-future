import { beforeEach, describe, expect, it, vi } from "vitest";
import { freshDb, makeListing, makeUser } from "./helpers";
import { getFeed } from "@/lib/services/feed";
import { createOrder } from "@/lib/services/orders";
import { swipes } from "@/lib/db/schema";
import crypto from "node:crypto";
import { seedDemo } from "@/lib/demo/seed";

let currentUser: { id: string } | null = null;

vi.mock("@/lib/auth", () => ({
  requireUser: async () => currentUser,
  auth: async () => (currentUser ? { user: { id: currentUser.id } } : null),
  handlers: {},
  signIn: async () => undefined,
  signOut: async () => undefined,
}));

async function callSwipe(body: unknown) {
  const { POST } = await import("@/app/api/swipes/route");
  return POST(
    new Request("http://localhost/api/swipes", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("feed", () => {
  beforeEach(async () => {
    await freshDb();
    currentUser = null;
  });

  it("excludes my own listings, swiped listings and expired ones", async () => {
    const db = await freshDb();
    const me = await makeUser("Me");
    const other = await makeUser("Other");
    const mine = await makeListing(me.id);
    const theirs = await makeListing(other.id);
    const gone = await makeListing(other.id, { startsAt: new Date(Date.now() - 86_400_000) });
    const swiped = await makeListing(other.id);
    await db.insert(swipes).values({ id: crypto.randomUUID(), userId: me.id, listingId: swiped.listing.id, direction: "left" });

    const page = await getFeed(db, me.id, null);
    const ids = page.items.map((i) => i.listingId);
    expect(ids).toContain(theirs.listing.id);
    expect(ids).not.toContain(mine.listing.id);
    expect(ids).not.toContain(gone.listing.id);
    expect(ids).not.toContain(swiped.listing.id);
  });

  it("walks every seeded listing exactly once with cursor pagination", async () => {
    const db = await freshDb();
    const me = await makeUser("Walker");
    const seeded = await seedDemo(db);
    expect(seeded.listingCount).toBeGreaterThan(60);

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 20; i++) {
      const page = await getFeed(db, me.id, cursor);
      seen.push(...page.items.map((item) => item.listingId));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBe(seeded.listingCount);
  });

  it("orders by startsAt ascending", async () => {
    const db = await freshDb();
    const me = await makeUser("Sorter");
    const other = await makeUser("Seller");
    await makeListing(other.id, { startsAt: new Date(Date.now() + 5 * 86_400_000) });
    await makeListing(other.id, { startsAt: new Date(Date.now() + 2 * 86_400_000) });
    const page = await getFeed(db, me.id, null);
    const times = page.items.map((i) => new Date(i.startsAt).getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});

describe("swipes", () => {
  beforeEach(async () => {
    await freshDb();
    currentUser = null;
  });

  it("requires a session", async () => {
    const res = await callSwipe({ listingId: "whatever", direction: "left" });
    expect(res.status).toBe(401);
  });

  it("rejects a second right swipe on the same listing with 409 and keeps one order", async () => {
    const db = await freshDb();
    const me = await makeUser("Me");
    const other = await makeUser("Other");
    const { listing } = await makeListing(other.id);
    currentUser = { id: me.id };

    const first = await callSwipe({ listingId: listing.id, direction: "right" });
    expect(first.status).toBe(201);
    const body = await first.json();
    expect(body.orderId).toBeTruthy();

    const second = await callSwipe({ listingId: listing.id, direction: "right" });
    expect(second.status).toBe(409);

    const rows = await db.execute<{ count: string }>(`select count(*)::text as count from orders`);
    expect(Number((rows as unknown as { rows: [{ count: string }] }).rows[0].count)).toBe(1);
  });

  it("forbids swiping your own listing", async () => {
    const db = await freshDb();
    const me = await makeUser("Me");
    const mine = await makeListing(me.id, { status: "listed" });
    currentUser = { id: me.id };
    const res = await callSwipe({ listingId: mine.listing.id, direction: "right" });
    expect(res.status).toBe(403);
    void db;
  });

  it("rejects a swipe on a sold listing", async () => {
    const db = await freshDb();
    const me = await makeUser("Me");
    const other = await makeUser("Other");
    const { listing } = await makeListing(other.id);
    await db.execute(`update listings set status = 'sold' where id = '${listing.id}'`);
    currentUser = { id: me.id };
    const res = await callSwipe({ listingId: listing.id, direction: "left" });
    expect(res.status).toBe(409);
  });

  it("lets exactly one buyer claim a listing", async () => {
    await freshDb();
    const other = await makeUser("Seller");
    const a = await makeUser("A");
    const b = await makeUser("B");
    const { listing } = await makeListing(other.id);
    currentUser = { id: a.id };
    const first = await callSwipe({ listingId: listing.id, direction: "right" });
    currentUser = { id: b.id };
    const second = await callSwipe({ listingId: listing.id, direction: "right" });
    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
  });

  it("returns an order intent without moving money", async () => {
    const db = await freshDb();
    const me = await makeUser("Me");
    const other = await makeUser("Other");
    const { listing } = await makeListing(other.id, {}, 8400);
    const order = await createOrder(db, me.id, listing.id);
    expect(order.amountCents).toBe(8400);
    expect(order.feeCents).toBe(840);
  });
});
