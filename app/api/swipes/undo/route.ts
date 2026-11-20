import { and, desc, eq, inArray } from "drizzle-orm";
import { handle, json } from "@/lib/api/helpers";
import { listings, orders, swipes } from "@/lib/db/schema";
import { HttpError } from "@/lib/config";
import { undoClaim } from "@/lib/services/orders";

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

    const settled = await db
      .select({ id: orders.id, status: orders.status })
      .from(orders)
      .where(
        and(
          eq(orders.buyerId, userId),
          eq(orders.listingId, last.listingId),
          inArray(orders.status, ["created", "funded"]),
        ),
      )
      .orderBy(desc(orders.createdAt))
      .limit(1);
    const order = settled[0];
    if (order) await undoClaim(db, userId, order.id);
    return json({ undone: true, listingId: last.listingId, direction: last.direction });
  });
}
