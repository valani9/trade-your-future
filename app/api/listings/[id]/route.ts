import { handle, json } from "@/lib/api/helpers";
import { cancelListing } from "@/lib/services/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handle(request, async ({ userId, db }) => {
    const result = await cancelListing(db, userId, id);
    return json(result);
  });
}
