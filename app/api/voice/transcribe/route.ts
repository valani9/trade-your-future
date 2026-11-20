import { json, fail, handle, payloadTooLarge } from "@/lib/api/helpers";
import { parseCommand, transcribe } from "@/lib/services/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const tooLarge = payloadTooLarge(request, 2_500_000);
  if (tooLarge) return tooLarge;
  return handle(request, async () => {
    const form = await request.formData().catch(() => null);
    const file = form?.get("audio");
    if (!(file instanceof Blob) || file.size === 0 || file.size > 2_000_000) {
      return fail(400, "Expected a short audio clip", "invalid_input");
    }
    try {
      const text = await transcribe(file);
      if (text === null) return fail(501, "Voice is off", "voice_off");
      return json({ text, command: parseCommand(text) });
    } catch {
      return fail(502, "Voice is unavailable", "voice_unavailable");
    }
  });
}
