import { handle, json } from "@/lib/api/helpers";
import { getMyPlans } from "@/lib/services/plans";
import { expireStaleListings } from "@/lib/services/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handle(request, async ({ userId, db }) => {
    await expireStaleListings(db);
    const items = await getMyPlans(db, userId);
    return json({ items });
  });
}
