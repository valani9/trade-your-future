import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "coral" | "slate" | "mint";

const tones: Record<Tone, string> = {
  neutral: "bg-white/[0.07] text-ink/80",
  coral: "bg-coral/15 text-coral",
  slate: "bg-slate/15 text-slate",
  mint: "bg-mint/15 text-mint",
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
