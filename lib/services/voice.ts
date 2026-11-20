// Voice layer, backed by ElevenLabs.
//   - speak():      text-to-speech (eleven_flash_v2_5) for card narration and receipts
//   - transcribe(): speech-to-text (scribe_v1) for hands-free "claim" / "pass" commands
// Without ELEVENLABS_API_KEY both return null and the client falls back to
// the browser's built-in speech APIs, so the app still works offline.

const BASE = "https://api.elevenlabs.io";
const DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM";

export function voiceEnabled() {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

export async function speak(text: string, fetchImpl: typeof fetch = fetch): Promise<ArrayBuffer | null> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return null;
  const voice = process.env.ELEVENLABS_VOICE_ID ?? DEFAULT_VOICE;
  const res = await fetchImpl(`${BASE}/v1/text-to-speech/${voice}?output_format=mp3_44100_64`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: "eleven_flash_v2_5", voice_settings: { stability: 0.45, similarity_boost: 0.8 } }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`tts ${res.status}`);
  return res.arrayBuffer();
}

export async function transcribe(audio: Blob, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return null;
  const form = new FormData();
  form.append("model_id", "scribe_v1");
  form.append("file", audio, "command.webm");
  const res = await fetchImpl(`${BASE}/v1/speech-to-text`, {
    method: "POST",
    headers: { "xi-api-key": key },
    body: form,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`stt ${res.status}`);
  const data = (await res.json()) as { text?: string };
  return data.text ?? "";
}

export type VoiceCommand = "claim" | "pass" | "undo" | "repeat" | null;

export function parseCommand(text: string): VoiceCommand {
  const t = text.toLowerCase();
  if (/\b(undo|go back|wait)\b/.test(t)) return "undo";
  if (/\b(repeat|again|what was that)\b/.test(t)) return "repeat";
  if (/\b(claim|yes|take it|buy|i'll take|grab)\b/.test(t)) return "claim";
  if (/\b(pass|no|skip|next|nope)\b/.test(t)) return "pass";
  return null;
}

export function narrateCard(card: { title: string; venue: string; city: string; priceCents: number; startsAt: string; timeZone: string }) {
  const when = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
    timeZone: card.timeZone,
  }).format(new Date(card.startsAt));
  const dollars = Math.round(card.priceCents / 100);
  return `${card.title}, at ${card.venue} in ${card.city}, ${when}. ${dollars} dollars. Say claim or pass.`;
}
