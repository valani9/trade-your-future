import { describe, expect, it } from "vitest";
import { listings, plans, swipes } from "@/lib/db/schema";
import { freshDb, makeListing, makeUser } from "./helpers";
import crypto from "node:crypto";

describe("schema guards", () => {
  it("rejects a listing priced at zero", async () => {
    const db = await freshDb();
    const seller = await makeUser("Seller");
    const plan = await db
      .insert(plans)
      .values({
        id: crypto.randomUUID(),
        userId: seller.id,
        category: "concert",
        title: "Zero price",
        venue: "Somewhere",
        city: "Austin",
        startsAt: new Date(Date.now() + 86_400_000),
        endsAt: new Date(Date.now() + 2 * 86_400_000),
        source: "manual",
        faceValueCents: 1000,
        status: "active",
      })
      .returning();
    await expect(
      db.insert(listings).values({
        id: crypto.randomUUID(),
        planId: plan[0].id,
        sellerId: seller.id,
        priceCents: 0,
        expiresAt: plan[0].startsAt,
      }),
    ).rejects.toThrow();
  });

  it("rejects a duplicate swipe for the same user and listing", async () => {
    const db = await freshDb();
    const seller = await makeUser("Seller");
    const buyer = await makeUser("Buyer");
    const { listing } = await makeListing(seller.id);
    await db.insert(swipes).values({ id: crypto.randomUUID(), userId: buyer.id, listingId: listing.id, direction: "left" });
    await expect(
      db.insert(swipes).values({ id: crypto.randomUUID(), userId: buyer.id, listingId: listing.id, direction: "right" }),
    ).rejects.toThrow();
  });

  it("rejects a plan whose end precedes its start", async () => {
    const db = await freshDb();
    const user = await makeUser();
    const start = new Date(Date.now() + 86_400_000);
    await expect(
      db.insert(plans).values({
        id: crypto.randomUUID(),
        userId: user.id,
        category: "concert",
        title: "Backwards",
        venue: "Somewhere",
        city: "Austin",
        startsAt: start,
        endsAt: new Date(start.getTime() - 60_000),
        source: "manual",
        faceValueCents: 1000,
        status: "active",
      }),
    ).rejects.toThrow();
  });
});
