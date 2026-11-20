import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "coral" | "slate" | "mint";

const tones: Record<Tone, string> = {
  neutral: "bg-black/55 text-ink/90 border border-white/15",
  coral: "bg-[#2A1512] text-coral border border-coral/45",
  slate: "bg-[#151832] text-slate border border-slate/45",
  mint: "bg-[#10251D] text-mint border border-mint/45",
};

export function Pill({
  tone = "neutral",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-pill px-2.5 py-1 text-[12px] font-medium uppercase tracking-[0.06em]",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

const statusTone: Record<string, Tone> = {
  open: "coral",
  pending: "slate",
  funded: "slate",
  created: "neutral",
  handed_over: "slate",
  released: "mint",
  refunded: "neutral",
  disputed: "coral",
  failed: "neutral",
  sold: "mint",
  cancelled: "neutral",
  expired: "neutral",
  proposed: "slate",
  accepted: "mint",
  declined: "neutral",
  settled: "mint",
};

export function StatusPill({ status, label }: { status: string; label?: string }) {
  return <Pill tone={statusTone[status] ?? "neutral"}>{label ?? status.replace(/_/g, " ")}</Pill>;
}
