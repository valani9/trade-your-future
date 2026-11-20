"use client";

import { useState } from "react";
import { Volume2 } from "lucide-react";
import { say } from "@/lib/voiceClient";

export function ListenButton({ text, label = "Listen" }: { text: string; label?: string }) {
  const [playing, setPlaying] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        if (playing) return;
        setPlaying(true);
        try {
          await say(text);
        } finally {
          setPlaying(false);
        }
      }}
      className="flex min-h-11 w-full items-center justify-between rounded-btn border border-line px-3 text-[12px] text-ink/80 hover:bg-ink/[0.04]"
      aria-label={label}
    >
      <span>{playing ? "Playing…" : label}</span>
      <Volume2 size={13} />
    </button>
  );
}
