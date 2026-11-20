import { getFeed } from "@/lib/services/feed";
import { handle, handlePublic, json } from "@/lib/api/helpers";
import { requireUser } from "@/lib/auth";
import { appDb } from "@/lib/boot";
import { expireStaleListings } from "@/lib/services/plans";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");
  const anonymous = url.searchParams.get("demo") === "1" && config.demoMode();
  const user = anonymous ? null : await requireUser();
  if (!user && !anonymous) return json({ error: "Sign in to continue", code: "unauthorized" }, 401);

  return handlePublic(request, async (db) => {
    if (user) await expireStaleListings(db);
    const page = await getFeed(db, user?.id ?? null, cursor);
    return json({ items: page.items, nextCursor: page.nextCursor });
  });
}

void appDb;
void handle;
