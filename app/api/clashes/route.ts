import { handle, json } from "@/lib/api/helpers";
import { getMyPlans, groupClashes } from "@/lib/services/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handle(request, async ({ userId, db }) => {
    const items = await getMyPlans(db, userId);
    const groups = groupClashes(
      items.map((p) => ({ id: p.id, startsAt: p.startsAt, endsAt: p.endsAt, status: p.status })),
    );
    return json({ groups });
  });
}
