import { beforeEach, describe, expect, it, vi } from "vitest";
import { freshDb, makeListing, makePlan, makeUser } from "./helpers";
import { groupClashes, createListing, suggestPriceCents } from "@/lib/services/plans";
import { parseConfirmation } from "@/lib/services/import";
import { syncCalendar } from "@/lib/services/google";
import { plans } from "@/lib/db/schema";
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

const at = (iso: string) => new Date(iso).toISOString();

describe("clashes", () => {
  it("groups overlapping plans only", () => {
    const groups = groupClashes([
      { id: "a", startsAt: at("2026-11-21T19:00:00Z"), endsAt: at("2026-11-21T22:00:00Z"), status: "active" },
      { id: "b", startsAt: at("2026-11-21T20:00:00Z"), endsAt: at("2026-11-21T23:00:00Z"), status: "active" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].planIds).toEqual(["a", "b"]);
  });

  it("does not treat touching plans as a clash", () => {
    const groups = groupClashes([
      { id: "a", startsAt: at("2026-11-21T19:00:00Z"), endsAt: at("2026-11-21T21:00:00Z"), status: "active" },
      { id: "b", startsAt: at("2026-11-21T21:00:00Z"), endsAt: at("2026-11-21T23:00:00Z"), status: "active" },
    ]);
    expect(groups).toHaveLength(0);
  });

  it("groups a fully contained plan with its container", () => {
    const groups = groupClashes([
      { id: "outer", startsAt: at("2026-11-21T18:00:00Z"), endsAt: at("2026-11-21T23:00:00Z"), status: "active" },
      { id: "inner", startsAt: at("2026-11-21T19:00:00Z"), endsAt: at("2026-11-21T20:00:00Z"), status: "active" },
    ]);
    expect(groups[0].planIds).toEqual(["outer", "inner"]);
  });

  it("groups three-way clashes together", () => {
    const groups = groupClashes([
      { id: "a", startsAt: at("2026-11-21T18:00:00Z"), endsAt: at("2026-11-21T20:00:00Z"), status: "active" },
      { id: "b", startsAt: at("2026-11-21T19:00:00Z"), endsAt: at("2026-11-21T21:00:00Z"), status: "active" },
      { id: "c", startsAt: at("2026-11-21T20:30:00Z"), endsAt: at("2026-11-21T22:00:00Z"), status: "active" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].planIds).toEqual(["a", "b", "c"]);
  });

  it("compares absolute instants across timezones", () => {
    const groups = groupClashes([
      { id: "austin", startsAt: at("2026-11-22T01:00:00Z"), endsAt: at("2026-11-22T03:00:00Z"), status: "active" },
      { id: "newyork", startsAt: at("2026-11-21T21:00:00Z"), endsAt: at("2026-11-22T01:30:00Z"), status: "active" },
    ]);
    expect(groups[0].planIds).toEqual(["newyork", "austin"]);
  });

  it("ignores sold plans", () => {
    const groups = groupClashes([
      { id: "a", startsAt: at("2026-11-21T19:00:00Z"), endsAt: at("2026-11-21T22:00:00Z"), status: "active" },
      { id: "b", startsAt: at("2026-11-21T19:00:00Z"), endsAt: at("2026-11-21T22:00:00Z"), status: "sold" },
    ]);
    expect(groups).toHaveLength(0);
  });
});

describe("confirmation import", () => {
  const now = new Date("2026-11-20T12:00:00Z");

  it("reads a ticket order", () => {
    const parsed = parseConfirmation(
      "Your order for Maggie Rogers at Stubb's BBQ, Austin on Sat, Nov 21, 2026 at 7:30 PM. Total $95.00",
      now,
    );
    expect(parsed.title).toContain("Maggie Rogers");
    expect(parsed.category).toBe("concert");
    expect(parsed.startsAt.toISOString()).toBe("2026-11-22T01:30:00.000Z");
    expect(parsed.faceValueCents).toBe(9500);
  });

  it("reads a restaurant reservation", () => {
    const parsed = parseConfirmation(
      "Reservation confirmed: Uchi, New York Friday, November 21 at 8:00 PM for 2 guests",
      now,
    );
    expect(parsed.category).toBe("restaurant");
    expect(parsed.startsAt.toISOString()).toBe("2026-11-22T01:00:00.000Z");
  });

  it("reads a sports ticket", () => {
    const parsed = parseConfirmation("You're going to Celtics vs Knicks, TD Garden, Boston on Nov 21 at 7:30pm", now);
    expect(parsed.category).toBe("sports");
    expect(parsed.city).toBe("Boston");
  });

  it("reads a flight", () => {
    const parsed = parseConfirmation("Flight AA1023 AUS to JFK, Austin, departing Nov 29 2026 at 7:40 AM", now);
    expect(parsed.category).toBe("flight");
    expect(parsed.startsAt.getUTCHours()).toBe(13);
  });

  it("reads a hotel stay", () => {
    const parsed = parseConfirmation("Your stay at The Bowery Hotel, New York, check-in 11/22/2026", now);
    expect(parsed.category).toBe("hotel");
  });

  it("rejects garbage with a friendly 422", () => {
    try {
      parseConfirmation("thanks for your purchase", now);
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(422);
      expect((error as HttpError).message).toMatch(/date/i);
    }
  });

  it("rejects a plan in the past", () => {
    expect(() => parseConfirmation("Dinner at Uchi on Jan 2, 2026 at 7:00 PM", now)).toThrow(/already happened/i);
  });
});

describe("listings", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("rejects bad prices", async () => {
    const db = await freshDb();
    const me = await makeUser("Me");
    const plan = await makePlan(me.id);
    await expect(createListing(db, me.id, { planId: plan.id, priceCents: 0 })).rejects.toThrow(/between/);
    await expect(createListing(db, me.id, { planId: plan.id, priceCents: -100 })).rejects.toThrow(/between/);
    await expect(createListing(db, me.id, { planId: plan.id, priceCents: 1_000_001 })).rejects.toThrow(/between/);
  });

  it("forbids listing someone else's plan", async () => {
    const db = await freshDb();
    const me = await makeUser("Me");
    const other = await makeUser("Other");
    const plan = await makePlan(other.id);
    await expect(createListing(db, me.id, { planId: plan.id, priceCents: 5000 })).rejects.toThrow(/not your plan/i);
  });

  it("rejects a second open listing", async () => {
    const db = await freshDb();
    const me = await makeUser("Me");
    const plan = await makePlan(me.id);
    await createListing(db, me.id, { planId: plan.id, priceCents: 5000 });
    await expect(createListing(db, me.id, { planId: plan.id, priceCents: 6000 })).rejects.toThrow(/already on sale/i);
  });

  it("blocks non-transferable plans", async () => {
    const db = await freshDb();
    const me = await makeUser("Me");
    const plan = await makePlan(me.id, { transferability: "non_transferable" });
    await expect(createListing(db, me.id, { planId: plan.id, priceCents: 5000 })).rejects.toThrow(/resold/);
  });

  it("blocks plans that already started", async () => {
    const db = await freshDb();
    const me = await makeUser("Me");
    const plan = await makePlan(me.id, {
      startsAt: new Date(Date.now() - 3_600_000),
      endsAt: new Date(Date.now() + 3_600_000),
    });
    await expect(createListing(db, me.id, { planId: plan.id, priceCents: 5000 })).rejects.toThrow(/started/);
  });

  it("suggests a price inside the allowed band", () => {
    const near = suggestPriceCents({ faceValueCents: 10000, category: "concert", startsAt: new Date(Date.now() + 2 * 86_400_000) });
    const far = suggestPriceCents({ faceValueCents: 10000, category: "concert", startsAt: new Date(Date.now() + 40 * 86_400_000) });
    expect(near).toBeGreaterThan(0);
    expect(far).toBeGreaterThan(near);
    expect(far).toBeLessThanOrEqual(1_000_000);
  });
});

describe("calendar sync", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("is idempotent and marks removed events expired", async () => {
    const db = await freshDb();
    const me = await makeUser("Me");
    const { users } = await import("@/lib/db/schema");
    await db
      .update(users)
      .set({
        googleAccessToken: "fake",
        googleRefreshToken: "fake",
        googleExpiresAt: new Date(Date.now() + 3_600_000),
      })
      .where(eq(users.id, me.id));

    const events = [
      {
        id: "evt-1",
        summary: "Longhorns vs Sooners",
        location: "Darrell K Royal Stadium, Austin",
        start: { dateTime: "2026-12-01T19:00:00Z" },
        end: { dateTime: "2026-12-01T22:00:00Z" },
      },
      {
        id: "evt-2",
        summary: "All day thing",
        start: { date: "2026-12-02" },
        end: { date: "2026-12-03" },
      },
    ];
    const fakeFetch = (async () => ({ ok: true, status: 200, json: async () => ({ items: events }) })) as unknown as typeof fetch;

    await syncCalendar(db, me.id, fakeFetch);
    await syncCalendar(db, me.id, fakeFetch);
    const mine = await db.select().from(plans).where(eq(plans.userId, me.id));
    expect(mine).toHaveLength(1);
    expect(mine[0].title).toBe("Longhorns vs Sooners");
    expect(mine[0].category).toBe("sports");

    const emptyFetch = (async () => ({ ok: true, status: 200, json: async () => ({ items: [] }) })) as unknown as typeof fetch;
    await syncCalendar(db, me.id, emptyFetch);
    const after = await db.select().from(plans).where(eq(plans.userId, me.id));
    expect(after[0].status).toBe("expired");
  });

  it("skips declined events", async () => {
    const db = await freshDb();
    const me = await makeUser("Me");
    const { users } = await import("@/lib/db/schema");
    await db
      .update(users)
      .set({ googleAccessToken: "fake", googleExpiresAt: new Date(Date.now() + 3_600_000) })
      .where(eq(users.id, me.id));
    const events = [
      {
        id: "declined",
        summary: "Dinner at Uchi",
        location: "Austin",
        start: { dateTime: "2026-12-01T19:00:00Z" },
        end: { dateTime: "2026-12-01T21:00:00Z" },
        attendees: [{ self: true, responseStatus: "declined" }],
      },
      {
        id: "accepted",
        summary: "Sushi at Uchi",
        location: "Austin",
        start: { dateTime: "2026-12-02T19:00:00Z" },
        end: { dateTime: "2026-12-02T21:00:00Z" },
        attendees: [{ self: true, responseStatus: "accepted" }],
      },
    ];
    const fakeFetch = (async () => ({ ok: true, status: 200, json: async () => ({ items: events }) })) as unknown as typeof fetch;
    await syncCalendar(db, me.id, fakeFetch);
    const mine = await db.select().from(plans).where(eq(plans.userId, me.id));
    expect(mine).toHaveLength(1);
    expect(mine[0].title).toBe("Sushi at Uchi");
  });

  it("skips declined events and requires a reconnect without a token", async () => {
    const db = await freshDb();
    const me = await makeUser("Me");
    await expect(syncCalendar(db, me.id)).rejects.toThrow(/Reconnect/i);
    void makeListing;
  });
});
