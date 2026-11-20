import { z } from "zod";
import { fail } from "@/lib/api/helpers";
import { rateLimit } from "@/lib/api/ratelimit";
import { speak } from "@/lib/services/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ text: z.string().min(1).max(400) });

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!rateLimit(`voice:${ip}`, 40).ok) return fail(429, "Slow down a moment", "rate_limited");
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return fail(400, "Invalid text", "invalid_input");
  try {
    const audio = await speak(parsed.data.text);
    if (!audio) return fail(501, "Voice is off", "voice_off");
    return new Response(audio, { headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } });
  } catch {
    return fail(502, "Voice is unavailable", "voice_unavailable");
  }
}
