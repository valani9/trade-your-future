import { eq } from "drizzle-orm";
import { handle, json } from "@/lib/api/helpers";
import { plans } from "@/lib/db/schema";
import { suggestPriceCents } from "@/lib/services/plans";
import { HttpError } from "@/lib/config";
import { sellerNetCents } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handle(request, async ({ db, userId }) => {
    const rows = await db.select().from(plans).where(eq(plans.id, id)).limit(1);
    const plan = rows[0];
    if (!plan) throw new HttpError(404, "Plan not found", "not_found");
    if (plan.userId !== userId) throw new HttpError(403, "That's not your plan", "forbidden");
    const suggested = suggestPriceCents(plan);
    return json({
      suggestedPriceCents: suggested,
      suggestedNetCents: sellerNetCents(suggested),
      faceValueCents: plan.faceValueCents,
      minPriceCents: 100,
      maxPriceCents: Math.min(Math.max(plan.faceValueCents * 3, 100), 1_000_000),
    });
  });
}
