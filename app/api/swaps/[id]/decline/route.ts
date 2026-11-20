import { handle, json } from "@/lib/api/helpers";
import { declineSwap } from "@/lib/services/swaps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handle(request, async ({ userId, db }) => json(await declineSwap(db, userId, id)));
}
