import { handle, json } from "@/lib/api/helpers";
import { syncCalendar } from "@/lib/services/google";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handle(request, async ({ userId, db }) => {
    const result = await syncCalendar(db, userId);
    return json(result);
  });
}
