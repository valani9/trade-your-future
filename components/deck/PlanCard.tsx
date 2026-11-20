"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { formatEventDate, shortcutsBlocked } from "@/lib/utils";
import { formatUsd } from "@/lib/money";
import { Pill } from "@/components/ui/Pill";

export type PlanCardData = {
  id: string;
  title: string;
  venue: string;
  city: string;
  timeZone: string;
  startsAt: string;
  faceValueCents: number;
  transferability: string;
  imageUrl: string | null;
  status: string;
  listing: { id: string; priceCents: number; status: string; netCents: number; expiresAt: string } | null;
};

export type PlanHandle = { swipe: (dir: "left" | "right") => void };

const TRANSFER_LABEL: Record<string, string> = {
  transferable: "Transferable",
  venue_approval: "Venue approval",
  name_change: "Name change",
  non_transferable: "Can't be resold",
};

export const PlanCard = forwardRef<
  PlanHandle,
  { plan: PlanCardData; depth: number; onSell: () => void; onKeep: () => Promise<void> }
>(function PlanCard({ plan, depth, onSell, onKeep }, ref) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-280, 280], [-12, 12]);
  const keepOpacity = useTransform(x, [30, 150], [0, 1]);
  const sellOpacity = useTransform(x, [-150, -30], [1, 0]);
  const locked = useRef(false);
  const [disabled, setDisabled] = useState<string | null>(null);

  async function commit(dir: "left" | "right") {
    if (locked.current) return;
    if (dir === "left" && plan.transferability === "non_transferable") {
      setDisabled("This one can't be resold");
      animate(x, 0, { type: "spring", stiffness: 300, damping: 30 });
      return;
    }
    locked.current = true;
    if (dir === "left") {
      onSell();
      locked.current = false;
      return;
    }
    try {
      await onKeep();
      animate(x, 640, { duration: 0.22, ease: [0.22, 1, 0.36, 1] });
    } catch {
      animate(x, 0, { type: "spring", stiffness: 300, damping: 30 });
    } finally {
      locked.current = false;
    }
  }

  useImperativeHandle(ref, () => ({ swipe: commit }));

  useEffect(() => {
    if (depth !== 0) return;
    const onKey = (event: KeyboardEvent) => {
      if (shortcutsBlocked(event)) return;
      if (event.key === "ArrowRight") void commit("right");
      if (event.key === "ArrowLeft") void commit("left");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <motion.div
      drag={depth === 0 ? "x" : false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.85}
      style={{ x, rotate: depth === 0 ? rotate : 0, zIndex: 30 - depth, scale: 1 - depth * 0.04, y: depth * 10 }}
      onDragEnd={(_, info) => {
        if (depth !== 0) return;
        const fast = Math.abs(info.velocity.x) > 550;
        const far = Math.abs(info.offset.x) > 120;
        if (fast || far) void commit(info.offset.x > 0 ? "right" : "left");
      }}
      className="absolute inset-0 touch-pan-y select-none overflow-hidden rounded-card border border-line bg-surface shadow-soft"
    >
      {plan.imageUrl ? (
        <img
          src={plan.imageUrl}
          alt=""
          draggable={false}
          decoding="async"
          fetchPriority={depth === 0 ? "high" : "auto"}
          loading={depth === 0 ? "eager" : "lazy"}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-b from-[#1C1F25] to-[#0F1115]" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-base via-base/35 to-transparent" style={{ top: "40%" }} />

      <div className="absolute inset-x-4 top-4 flex items-start justify-between">
        <div className="flex flex-col gap-1.5">
          <Pill tone="coral" className="bg-black/55 backdrop-blur-sm">{plan.status === "listed" ? "On sale" : "Your plan"}</Pill>
          <Pill className="bg-black/55 backdrop-blur-sm text-ink/90">{TRANSFER_LABEL[plan.transferability] ?? plan.transferability}</Pill>
        </div>
      </div>

      <motion.div
        aria-hidden
        style={{ opacity: keepOpacity }}
        className="pointer-events-none absolute left-5 top-24 rotate-[-10deg] rounded-btn border-2 border-mint px-3 py-1 text-[18px] font-bold tracking-wider text-mint"
      >
        KEEP
      </motion.div>
      <motion.div
        aria-hidden
        style={{ opacity: sellOpacity }}
        className="pointer-events-none absolute right-5 top-24 rotate-[10deg] rounded-btn border-2 border-slate px-3 py-1 text-[18px] font-bold tracking-wider text-slate"
      >
        SELL
      </motion.div>

      <div className="absolute inset-x-0 bottom-0 p-5">
        <h2 className="line-clamp-2 text-[26px] font-semibold leading-[1.1] tracking-tighter">{plan.title}</h2>
        <p className="mt-1.5 text-[13px] text-muted">
          {plan.venue} · {plan.city}
        </p>
        <p className="mt-0.5 text-[13px] text-ink/70">{formatEventDate(new Date(plan.startsAt), plan.timeZone)}</p>
        <div className="mt-4 flex items-end justify-between">
          <span className="text-[12px] uppercase tracking-[0.1em] text-ink/70">
            {plan.listing ? `Listed ${formatUsd(plan.listing.priceCents)}` : `Face ${formatUsd(plan.faceValueCents)}`}
          </span>
          {plan.listing ? (
            <span className="num text-[16px] font-medium text-mint">{formatUsd(plan.listing.netCents)} back</span>
          ) : null}
        </div>
      </div>

      {disabled ? (
        <div className="absolute inset-x-4 bottom-24 rounded-btn bg-coral/15 px-3 py-2 text-center text-[12px] text-coral">
          {disabled}
        </div>
      ) : null}
    </motion.div>
  );
});
