import { beforeEach, describe, expect, it, vi } from "vitest";
import { freshDb, makeListing, makePlan, makeUser } from "./helpers";
import { acceptSwap, declineSwap, listSwaps, proposeSwap } from "@/lib/services/swaps";
import { listings, plans, swaps } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { solana } from "@/lib/solana";
import { centsToBaseUnits } from "@/lib/money";

let currentUser: { id: string } | null = null as { id: string } | null;
vi.mock("@/lib/auth", () => ({
  requireUser: async () => currentUser,
  auth: async () => (currentUser ? { user: { id: currentUser.id } } : null),
  handlers: {},
  signIn: async () => undefined,
  signOut: async () => undefined,
}));

describe("swaps", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("computes a positive diff when my plan is worth more", async () => {
    const db = await freshDb();
    const me = await makeUser("Me");
    const them = await makeUser("Them");
    const mine = await makePlan(me.id, { faceValueCents: 20000 });
    const { listing } = await makeListing(them.id, { faceValueCents: 12000 }, 12000);
    const swap = await proposeSwap(db, me.id, mine.id, listing.id);
    expect(swap.diffCents).toBe(8000);
  });

  it("computes a negative diff when their plan is worth more", async () => {
    const db = await freshDb();
    const me = await makeUser("Me");
    const them = await makeUser("Them");
    const mine = await makePlan(me.id, { faceValueCents: 5000 });
    const { listing } = await makeListing(them.id, { faceValueCents: 20000 }, 20000);
    const swap = await proposeSwap(db, me.id, mine.id, listing.id);
    expect(swap.diffCents).toBe(-15000);
  });

  it("settles an even trade with no transfer and moves both plans", async () => {
    const db = await freshDb();
    const me = await makeUser("Me");
    const them = await makeUser("Them");
    const mine = await makePlan(me.id, { faceValueCents: 9000 });
    const { listing, plan: theirs } = await makeListing(them.id, { faceValueCents: 9000 }, 9000);
    const swap = await proposeSwap(db, me.id, mine.id, listing.id);
    expect(swap.diffCents).toBe(0);
    const result = await acceptSwap(db, them.id, swap.id);
    expect(result.status).toBe("settled");

    const mineNow = (await db.select().from(plans).where(eq(plans.id, mine.id)))[0];
    const theirsNow = (await db.select().from(plans).where(eq(plans.id, theirs.id)))[0];
    expect(mineNow.userId).toBe(them.id);
    expect(theirsNow.userId).toBe(me.id);
    expect(mineNow.status).toBe("swapped");
  });

  it("charges the side that owes the difference", async () => {
    const db = await freshDb();
    const me = await makeUser("Me");
    const them = await makeUser("Them");
    const mine = await makePlan(me.id, { faceValueCents: 4000 });
    const { listing } = await makeListing(them.id, { faceValueCents: 14000 }, 14000);
    const before = await solana().balance(me.walletPubkey);
    const swap = await proposeSwap(db, me.id, mine.id, listing.id);
    await acceptSwap(db, them.id, swap.id);
    const after = await solana().balance(me.walletPubkey);
    expect(before - after).toBe(centsToBaseUnits(10000));
  });

  it("rejects swapping your own listing", async () => {
    const db = await freshDb();
    const me = await makeUser("Me");
    const mine = await makePlan(me.id, { faceValueCents: 4000 });
    const { listing } = await makeListing(me.id, { faceValueCents: 9000 }, 9000);
    await expect(proposeSwap(db, me.id, mine.id, listing.id)).rejects.toMatchObject({ status: 400 });
  });

  it("rejects an offer on a plan that is already listed or sold", async () => {
    const db = await freshDb();
    const me = await makeUser("Me");
    const them = await makeUser("Them");
    const listed = await makePlan(me.id, { faceValueCents: 4000, status: "listed" });
    const { listing } = await makeListing(them.id, { faceValueCents: 9000 }, 9000);
    await expect(proposeSwap(db, me.id, listed.id, listing.id)).rejects.toMatchObject({ status: 409 });
  });

  it("cancels a stale swap when the listing sold first", async () => {
    const db = await freshDb();
    const me = await makeUser("Me");
    const them = await makeUser("Them");
    const mine = await makePlan(me.id, { faceValueCents: 9000 });
    const { listing } = await makeListing(them.id, { faceValueCents: 9000 }, 9000);
    const swap = await proposeSwap(db, me.id, mine.id, listing.id);
    await db.update(listings).set({ status: "sold" }).where(eq(listings.id, listing.id));
    await expect(acceptSwap(db, them.id, swap.id)).rejects.toMatchObject({ status: 409 });
    const row = (await db.select().from(swaps).where(eq(swaps.id, swap.id)))[0];
    expect(row.status).toBe("cancelled");
  });

  it("forbids the proposer from accepting their own offer", async () => {
    const db = await freshDb();
    const me = await makeUser("Me");
    const them = await makeUser("Them");
    const mine = await makePlan(me.id, { faceValueCents: 9000 });
    const { listing } = await makeListing(them.id, { faceValueCents: 9000 }, 9000);
    const swap = await proposeSwap(db, me.id, mine.id, listing.id);
    await expect(acceptSwap(db, me.id, swap.id)).rejects.toMatchObject({ status: 403 });
  });

  it("declines a swap and lists both directions", async () => {
    const db = await freshDb();
    const me = await makeUser("Me");
    const them = await makeUser("Them");
    const mine = await makePlan(me.id, { faceValueCents: 9000 });
    const { listing } = await makeListing(them.id, { faceValueCents: 9000 }, 9000);
    const swap = await proposeSwap(db, me.id, mine.id, listing.id);
    await declineSwap(db, them.id, swap.id);
    const mineList = await listSwaps(db, me.id);
    const themList = await listSwaps(db, them.id);
    expect(mineList[0].status).toBe("declined");
    expect(mineList[0].direction).toBe("outgoing");
    expect(themList[0].direction).toBe("incoming");
  });

  it("auto-accepts with the demo counterparty after the bot delay", async () => {
    const db = await freshDb();
    const me = await makeUser("Me");
    const bot = await makeUser("Bot", { isDemo: true });
    const mine = await makePlan(me.id, { faceValueCents: 9000 });
    const { listing } = await makeListing(bot.id, { faceValueCents: 9000 }, 9000);
    const swap = await proposeSwap(db, me.id, mine.id, listing.id);
    await db.update(swaps).set({ createdAt: new Date(Date.now() - 10_000) }).where(eq(swaps.id, swap.id));
    const rows = await listSwaps(db, me.id);
    expect(rows[0].status).toBe("settled");
  });
});
