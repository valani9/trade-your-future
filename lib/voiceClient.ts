"use client";

let current: HTMLAudioElement | null = null;
let settle: (() => void) | null = null;
let generation = 0;

/** Resolves whoever is waiting on say(); called on end, error, and on any cut-off. */
function finish() {
  const done = settle;
  settle = null;
  done?.();
}

/** Plays text through the ElevenLabs route, falling back to the browser voice. */
export async function say(text: string): Promise<void> {
  const gen = ++generation;
  current?.pause();
  finish();
  try {
    const res = await fetch("/api/voice/speak", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (res.ok) {
      const blob = await res.blob();
      if (gen !== generation) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      current = audio;
      await new Promise<void>((resolve) => {
        settle = resolve;
        audio.onended = () => gen === generation && finish();
        audio.onerror = () => gen === generation && finish();
        audio.play().catch(() => gen === generation && finish());
      });
      URL.revokeObjectURL(url);
      return;
    }
  } catch {
    // fall through
  }
  if (gen !== generation) return;
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    await new Promise<void>((resolve) => {
      settle = resolve;
      const u = new SpeechSynthesisUtterance(text);
      u.onend = () => gen === generation && finish();
      u.onerror = () => gen === generation && finish();
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    });
  }
}

/** Cuts off whatever is speaking, so turning voice mode off is immediate. */
export function stopSpeaking(): void {
  generation++;
  current?.pause();
  current = null;
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  finish();
}

/** Records ~2.5s from the mic and returns the parsed command. */
export async function listenForCommand(ms = 2500): Promise<string | null> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return null;
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  try {
    const recorder = new MediaRecorder(stream);
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    const done = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
    recorder.start();
    await new Promise((r) => setTimeout(r, ms));
    recorder.stop();
    await done;
    const form = new FormData();
    form.append("audio", new Blob(chunks, { type: recorder.mimeType || "audio/webm" }), "command.webm");
    const res = await fetch("/api/voice/transcribe", { method: "POST", body: form });
    if (!res.ok) return null;
    const data = (await res.json()) as { command: string | null };
    return data.command;
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}
