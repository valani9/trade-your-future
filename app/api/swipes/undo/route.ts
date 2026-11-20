import { and, desc, eq } from "drizzle-orm";
import { handle, json } from "@/lib/api/helpers";
import { listings, orders, swipes } from "@/lib/db/schema";
import { HttpError } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handle(request, async ({ userId, db }) => {
    const rows = await db
      .select()
      .from(swipes)
      .where(eq(swipes.userId, userId))
      .orderBy(desc(swipes.createdAt))
      .limit(1);
    const last = rows[0];
    if (!last) throw new HttpError(409, "Nothing to undo", "nothing_to_undo");
    if (Date.now() - last.createdAt.getTime() > 60_000) throw new HttpError(409, "Too late to undo", "undo_expired");

    await db.delete(swipes).where(and(eq(swipes.userId, userId), eq(swipes.listingId, last.listingId)));

    const openOrders = await db
      .select({ id: orders.id, status: orders.status, listingId: orders.listingId })
      .from(orders)
      .where(and(eq(orders.buyerId, userId), eq(orders.listingId, last.listingId)))
      .limit(1);
    const order = openOrders[0];
    if (order && order.status === "created") {
      await db.delete(orders).where(eq(orders.id, order.id));
      await db.update(listings).set({ status: "open" }).where(eq(listings.id, order.listingId));
    }
    return json({ undone: true, listingId: last.listingId, direction: last.direction });
  });
}
