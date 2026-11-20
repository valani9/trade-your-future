import { z } from "zod";
import { handle, json, body, withIdempotency } from "@/lib/api/helpers";
import { createOrder, listOrders } from "@/lib/services/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ listingId: z.string().min(1) });

export async function POST(request: Request) {
  return handle(request, async (ctx) => {
    return withIdempotency(ctx, "orders.create", async () => {
      const input = await body(request, (v) => schema.parse(v));
      const order = await createOrder(ctx.db, ctx.userId, input.listingId);
      return { status: 201, body: order };
    });
  });
}

export async function GET(request: Request) {
  return handle(request, async ({ userId, db, request: req }) => {
    const url = new URL(req.url);
    const role = url.searchParams.get("role") === "seller" ? "seller" : "buyer";
    return json({ items: await listOrders(db, userId, role) });
  });
}
