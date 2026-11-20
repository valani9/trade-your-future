"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import type { FeedCard } from "@/lib/services/feed";
import { formatEventDate } from "@/lib/utils";
import { formatUsd } from "@/lib/money";
import { Pill } from "@/components/ui/Pill";

export type SwipeHandle = { swipe: (dir: "left" | "right") => void };

const TRANSFER_LABEL: Record<string, string> = {
  transferable: "Transferable",
  venue_approval: "Venue approval",
  name_change: "Name change",
  non_transferable: "Can't resell",
};

export const SwipeCard = forwardRef<
  SwipeHandle,
  {
    card: FeedCard;
    depth: number;
    onCommit: (dir: "left" | "right") => Promise<void>;
  }
>(function SwipeCard({ card, depth, onCommit }, ref) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-280, 280], [-12, 12]);
  const keepOpacity = useTransform(x, [30, 150], [0, 1]);
  const goOpacity = useTransform(x, [-150, -30], [1, 0]);
  const locked = useRef(false);

  async function commit(dir: "left" | "right") {
    if (locked.current) return;
    locked.current = true;
    try {
      await onCommit(dir);
      animate(x, dir === "right" ? 640 : -640, { duration: 0.22, ease: [0.22, 1, 0.36, 1] });
    } catch {
      animate(x, 0, { type: "spring", stiffness: 300, damping: 30 });
      locked.current = false;
    }
  }

  useImperativeHandle(ref, () => ({ swipe: commit }));

  useEffect(() => {
    if (depth !== 0) return;
    const onKey = (event: KeyboardEvent) => {
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
      style={{
        x,
        rotate: depth === 0 ? rotate : 0,
        zIndex: 30 - depth,
        scale: 1 - depth * 0.04,
        y: depth * 10,
      }}
      onDragEnd={(_, info) => {
        if (depth !== 0) return;
        const fast = Math.abs(info.velocity.x) > 550;
        const far = Math.abs(info.offset.x) > 120;
        if (fast || far) {
          void commit(info.offset.x > 0 ? "right" : "left");
        }
      }}
      className="absolute inset-0 touch-pan-y select-none rounded-card border border-line bg-surface shadow-soft overflow-hidden"
    >
      {card.imageUrl ? (
        <img
          src={card.imageUrl}
          alt=""
          draggable={false}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-b from-[#1C1F25] to-[#0F1115]" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-base via-base/35 to-transparent" style={{ top: "40%" }} />

      <div className="absolute inset-x-4 top-4 flex items-start justify-between">
        <div className="flex flex-col gap-1.5">
          <Pill tone="coral">{card.category}</Pill>
          <Pill>{TRANSFER_LABEL[card.transferability] ?? card.transferability}</Pill>
        </div>
        {card.isDemo ? <span className="text-[10px] tracking-wide text-ink/60">Demo listing</span> : null}
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
        style={{ opacity: goOpacity }}
        className="pointer-events-none absolute right-5 top-24 rotate-[10deg] rounded-btn border-2 border-slate px-3 py-1 text-[18px] font-bold tracking-wider text-slate"
      >
        LET GO
      </motion.div>

      <div className="absolute inset-x-0 bottom-0 p-5">
        <h2 className="line-clamp-2 text-[26px] font-semibold leading-[1.1] tracking-tighter">{card.title}</h2>
        <p className="mt-1.5 text-[13px] text-muted">
          {card.venue} · {card.city}
        </p>
        <p className="mt-0.5 text-[13px] text-ink/70">
          {formatEventDate(new Date(card.startsAt), card.timeZone)}
        </p>
        <div className="mt-4 flex items-end justify-between">
          <span className="text-[11px] uppercase tracking-[0.12em] text-faint">
            {card.sellerName ? `From ${card.sellerName.split(" ")[0]}` : "Resale"}
          </span>
          <span className="num text-[30px] font-semibold leading-none">{formatUsd(card.priceCents)}</span>
        </div>
      </div>
    </motion.div>
  );
});
