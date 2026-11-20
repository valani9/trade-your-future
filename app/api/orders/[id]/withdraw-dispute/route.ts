import { handle, withIdempotency } from "@/lib/api/helpers";
import { withdrawDispute } from "@/lib/services/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handle(request, async (ctx) => {
    return withIdempotency(ctx, `orders.withdraw_dispute:${id}`, async () => {
      const order = await withdrawDispute(ctx.db, ctx.userId, id);
      return { status: 200, body: order };
    });
  });
}
