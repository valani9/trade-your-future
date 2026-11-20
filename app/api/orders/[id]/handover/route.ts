import { z } from "zod";
import { handle, json, body, withIdempotency } from "@/lib/api/helpers";
import { handoverOrder } from "@/lib/services/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ note: z.string().max(400).optional() });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handle(request, async (ctx) => {
    return withIdempotency(ctx, `orders.handover:${id}`, async () => {
      const input = await body(request, (v) => schema.parse(v ?? {}));
      const order = await handoverOrder(ctx.db, ctx.userId, id, input.note ?? "");
      return { status: 200, body: order };
    });
  });
}
