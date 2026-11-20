import { z } from "zod";
import { handle, json, body } from "@/lib/api/helpers";
import { listSwaps, proposeSwap } from "@/lib/services/swaps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ offerPlanId: z.string().min(1), wantListingId: z.string().min(1) });

export async function POST(request: Request) {
  return handle(request, async ({ userId, db }) => {
    const input = await body(request, (v) => schema.parse(v));
    return json(await proposeSwap(db, userId, input.offerPlanId, input.wantListingId), 201);
  });
}

export async function GET(request: Request) {
  return handle(request, async ({ userId, db }) => json({ items: await listSwaps(db, userId) }));
}
