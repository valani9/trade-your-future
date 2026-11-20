"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { MarketOdds } from "@/lib/services/markets";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import type { FeedCard } from "@/lib/services/feed";
import { formatEventDate, shortcutsBlocked } from "@/lib/utils";
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
  const [odds, setOdds] = useState<MarketOdds | null>(null);

  useEffect(() => {
    if (depth > 1 || card.category !== "sports") return;
    let live = true;
    const params = new URLSearchParams({ title: card.title, startsAt: card.startsAt });
    fetch(`/api/markets?${params}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (live && d?.odds) setOdds(d.odds as MarketOdds);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [card.category, card.title, card.startsAt, depth]);
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
      if (event.repeat || shortcutsBlocked(event)) return;
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
      className="absolute inset-0 touch-pan-y select-none overflow-hidden rounded-card bg-[#1A1A19] text-white shadow-soft"
    >
      {card.imageUrl ? (
        <img
          src={card.imageUrl}
          alt=""
          draggable={false}
          decoding="async"
          fetchPriority={depth === 0 ? "high" : "auto"}
          loading={depth === 0 ? "eager" : "lazy"}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-b from-[#FF8A5C] to-[#FF4D2E]" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent" style={{ top: "35%" }} />

      <div className="absolute inset-x-4 top-4 flex items-start justify-between">
        <div className="flex flex-col gap-1.5">
          <Pill className="bg-white text-ink shadow-card">{card.category}</Pill>
          <Pill className="bg-black/40 backdrop-blur-md text-white">{TRANSFER_LABEL[card.transferability] ?? card.transferability}</Pill>
          {odds ? (
            <Pill className="whitespace-nowrap bg-black/40 backdrop-blur-md text-white" data-testid="market-odds">
              {odds.closeGame ? "Close game" : "Odds"} · {odds.favorite.name.split(" ").slice(-1)[0]}{" "}
              {Math.round(odds.favorite.probability * 100)}%
            </Pill>
          ) : null}
        </div>
        {card.isDemo ? <span className="rounded-pill bg-black/40 px-3 py-1 text-[12px] font-semibold text-white backdrop-blur-md">Demo listing</span> : null}
      </div>

      <motion.div
        aria-hidden
        style={{ opacity: keepOpacity }}
        className="pointer-events-none absolute left-5 top-24 rotate-[-10deg] rounded-2xl border-[3px] border-[#3DDC97] bg-black/20 px-4 py-1.5 text-[22px] font-extrabold tracking-wider text-[#3DDC97]"
      >
        CLAIM
      </motion.div>
      <motion.div
        aria-hidden
        style={{ opacity: goOpacity }}
        className="pointer-events-none absolute right-5 top-24 rotate-[10deg] rounded-2xl border-[3px] border-white bg-black/20 px-4 py-1.5 text-[22px] font-extrabold tracking-wider text-white"
      >
        PASS
      </motion.div>

      <div className="absolute inset-x-0 bottom-0 p-5">
        <h2 className="line-clamp-2 text-[28px] font-extrabold leading-[1.05] tracking-tighter text-white">{card.title}</h2>
        <p className="mt-2 text-[14px] font-medium text-white/80">
          {card.venue} · {card.city}
        </p>
        <p className="mt-0.5 text-[14px] text-white/70">
          {formatEventDate(new Date(card.startsAt), card.timeZone)}
        </p>
        <div className="mt-4 flex items-end justify-between">
          <span className="rounded-pill bg-white/15 px-3 py-1 text-[12px] font-semibold text-white backdrop-blur-md">
            {card.sellerName ? `From ${card.sellerName.split(" ")[0]}` : "Resale"}
          </span>
          <span className="num text-[32px] font-extrabold leading-none text-white">{formatUsd(card.priceCents)}</span>
        </div>
      </div>
    </motion.div>
  );
});
