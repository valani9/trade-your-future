import { z } from "zod";
import { json, fail } from "@/lib/api/helpers";
import { oddsForMatchup } from "@/lib/services/markets";
import { rateLimit } from "@/lib/api/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const query = z.object({
  title: z.string().min(3).max(120),
  startsAt: z.string().datetime().optional(),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = query.safeParse({
    title: url.searchParams.get("title") ?? "",
    startsAt: url.searchParams.get("startsAt") ?? undefined,
  });
  if (!parsed.success) return fail(400, "Invalid query", "invalid_input");
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!rateLimit(`markets:${ip}`, 120).ok) return fail(429, "Slow down a moment", "rate_limited");
  const odds = await oddsForMatchup(
    parsed.data.title,
    parsed.data.startsAt ? new Date(parsed.data.startsAt) : undefined,
  );
  return json({ odds });
}
