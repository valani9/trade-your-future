import { handle, json } from "@/lib/api/helpers";
import { getOrder } from "@/lib/services/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handle(request, async ({ userId, db }) => json(await getOrder(db, userId, id)));
}
