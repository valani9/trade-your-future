import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { handle, json, body } from "@/lib/api/helpers";
import { swipes, listings } from "@/lib/db/schema";
import { createOrder } from "@/lib/services/orders";
import { HttpError } from "@/lib/config";
import { id } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  listingId: z.string().min(1),
  direction: z.enum(["left", "right"]),
});

export async function POST(request: Request) {
  return handle(request, async ({ userId, db }) => {
    const input = await body(request, (v) => schema.parse(v));
    const rows = await db.select().from(listings).where(eq(listings.id, input.listingId)).limit(1);
    const listing = rows[0];
    if (!listing) throw new HttpError(404, "Listing not found", "not_found");
    if (listing.sellerId === userId) throw new HttpError(403, "That's your own listing", "forbidden");
    if (listing.status !== "open") throw new HttpError(409, "No longer available", "unavailable");

    const existing = await db
      .select({ id: swipes.id })
      .from(swipes)
      .where(and(eq(swipes.userId, userId), eq(swipes.listingId, input.listingId)))
      .limit(1);
    if (existing[0]) throw new HttpError(409, "Already swiped", "already_swiped");

    await db.insert(swipes).values({
      id: id(),
      userId,
      listingId: input.listingId,
      direction: input.direction,
    });

    if (input.direction === "right") {
      const order = await createOrder(db, userId, input.listingId);
      return json({ direction: "right", orderId: order.orderId, amountCents: order.amountCents }, 201);
    }
    return json({ direction: "left", orderId: null }, 201);
  });
}
