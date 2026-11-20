"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Heart, Undo2, X } from "lucide-react";
import type { FeedCard } from "@/lib/services/feed";
import { SwipeCard, type SwipeHandle } from "./SwipeCard";
import { Button } from "@/components/ui/Button";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Sheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { formatUsd } from "@/lib/money";
import { SwapSheet } from "@/components/app/SwapSheet";
import { ArrowLeftRight, Mic, MicOff } from "lucide-react";
import { listenForCommand, say, stopSpeaking } from "@/lib/voiceClient";
import { narrateCard } from "@/lib/services/voice";

export function BuyDeck({
  demoMode,
  initial = null,
  initialCursor = null,
}: {
  demoMode: boolean;
  initial?: FeedCard[] | null;
  initialCursor?: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [cards, setCards] = useState<FeedCard[]>(initial ?? []);
  const [top, setTop] = useState(0);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState(false);
  const [exhausted, setExhausted] = useState(Boolean(initial) && !initialCursor);
  const [claim, setClaim] = useState<{ orderId: string; card: FeedCard } | null>(null);
  const [short, setShort] = useState(false);
  const [shortfall, setShortfall] = useState(0);
  const [toppingUp, setToppingUp] = useState(false);
  const [paying, setPaying] = useState(false);
  const [undoLeft, setUndoLeft] = useState(0);
  const [swapOpen, setSwapOpen] = useState(false);
  const deckRef = useRef<SwipeHandle>(null);
  const inFlight = useRef(false);
  const [voice, setVoice] = useState(false);
  const voiceRun = useRef(0);

  const load = useCallback(
    async (next?: string | null) => {
      const res = await fetch(`/api/feed${next ? `?cursor=${encodeURIComponent(next)}` : ""}`, { cache: "no-store" });
      if (!res.ok) throw new Error("feed");
      const data = (await res.json()) as { items: FeedCard[]; nextCursor: string | null };
      setCards((prev) => (next ? [...prev, ...data.items] : data.items));
      setCursor(data.nextCursor);
      if (!data.nextCursor) setExhausted(true);
    },
    [],
  );

  useEffect(() => {
    if (initial) return;
    load(null)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [load, initial]);

  async function reload() {
    setLoading(true);
    setError(false);
    setTop(0);
    setExhausted(false);
    try {
      await load(null);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!cursor || exhausted) return;
    if (cards.length - top <= 3) load(cursor).catch(() => undefined);
  }, [cards.length, top, cursor, exhausted, load]);

  useEffect(() => {
    if (!claim) {
      setShort(false);
      return;
    }
    fetch("/api/wallet", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => setShortfall(Math.max(0, Math.ceil((claim.card.priceCents - (data.balanceCents ?? 0)) / 100) * 100)))
      .catch(() => undefined);
  }, [claim]);

  useEffect(() => {
    if (undoLeft <= 0) return;
    const timer = setInterval(() => setUndoLeft((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(timer);
  }, [undoLeft]);

  async function onCommit(dir: "left" | "right") {
    if (inFlight.current) throw new Error("busy");
    const card = cards[top];
    if (!card) throw new Error("empty");
    inFlight.current = true;
    try {
      const res = await fetch("/api/swipes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ listingId: card.listingId, direction: dir }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.show(data.error ?? "That one slipped away", "error");
        throw new Error(data.error ?? "swipe failed");
      }
      setTop((n) => n + 1);
      setUndoLeft(5);
      if (dir === "right" && data.orderId) setClaim({ orderId: data.orderId, card });
    } finally {
      inFlight.current = false;
    }
  }

  async function releaseClaim() {
    const orderId = claim?.orderId;
    setShort(false);
    setClaim(null);
    if (!orderId) return;
    try {
      const res = await fetch("/api/swipes/undo", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.show(data.error ?? "It's still held for you in Orders", "error");
        return;
      }
      setTop((n) => Math.max(0, n - 1));
      setUndoLeft(0);
      toast.show("Gave it back");
    } catch {
      toast.show("It's still held for you in Orders", "error");
    }
  }

  async function undo() {
    try {
      const res = await fetch("/api/swipes/undo", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.show(data.error ?? "Nothing to undo", "error");
        return;
      }
      setTop((n) => Math.max(0, n - 1));
      setUndoLeft(0);
      toast.show("Brought it back");
    } catch {
      toast.show("Couldn't undo that", "error");
    }
  }

  function closeClaim() {
    setShort(false);
    setClaim(null);
  }

  async function topUpAndPay() {
    if (!claim) return;
    setToppingUp(true);
    try {
      const needed = Math.max(1, Math.ceil(shortfall / 10_000));
      for (let i = 0; i < needed; i++) {
        const res = await fetch("/api/wallet/fund", { method: "POST" });
        if (!res.ok) {
          toast.show("Couldn't add funds right now", "error");
          return;
        }
      }
      setShort(false);
      toast.show(`Added ${formatUsd(needed * 10_000)}`, "money");
      await pay();
    } finally {
      setToppingUp(false);
    }
  }

  async function pay() {
    if (!claim) return;
    setPaying(true);
    try {
      const res = await fetch(`/api/orders/${claim.orderId}/fund`, {
        method: "POST",
        headers: { "idempotency-key": `pay-${claim.orderId}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 402) {
          setShort(true);
          return;
        }
        toast.show(data.error ?? "Payment didn't go through", "error");
        return;
      }
      toast.show("Paid. Held until handover.", "money");
      setClaim(null);
      router.push(`/orders/${claim.orderId}`);
    } finally {
      setPaying(false);
    }
  }

  const visible = cards.slice(top, top + 3);
  const done = !loading && top >= cards.length && exhausted;

  // Hands-free mode: read the top card aloud, listen for "claim" or "pass".
  useEffect(() => {
    if (!voice || claim || loading) return;
    const card = cards[top];
    if (!card) return;
    const run = ++voiceRun.current;
    (async () => {
      await say(narrateCard(card));
      for (let attempt = 0; attempt < 2 && voiceRun.current === run; attempt++) {
        const command = await listenForCommand().catch(() => null);
        if (voiceRun.current !== run) return;
        if (command === "claim") return deckRef.current?.swipe("right");
        if (command === "pass") return deckRef.current?.swipe("left");
        if (command === "undo") return void undo();
        if (command === "repeat") {
          await say(narrateCard(card));
          continue;
        }
        if (attempt === 0) await say("Say claim or pass.");
      }
    })();
    const runRef = voiceRun;
    return () => {
      runRef.current++;
      stopSpeaking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice, top, claim, loading, cards.length]);

  return (
    <div className="flex min-h-[calc(100dvh-72px)] flex-col px-4">
      <header className="flex items-center justify-between px-1 pt-5 pb-3">
        <div>
          <p className="text-[13px] font-semibold text-muted">Buy</p>
          <h1 className="text-[26px] font-extrabold leading-tight tracking-tighter">Tonight, next week, someday</h1>
        </div>
        <div className="flex items-center gap-2">
          {demoMode ? <span className="text-[12px] tracking-wide text-muted">Demo</span> : null}
          <button
            type="button"
            aria-pressed={voice}
            aria-label={voice ? "Turn voice off" : "Shop by voice"}
            onClick={() => {
              setVoice((v) => !v);
              if (!voice) toast.show("Voice on. Say claim or pass.");
            }}
            className={`flex h-11 w-11 items-center justify-center rounded-full border ${voice ? "border-coral text-coral" : "border-line text-muted"}`}
          >
            {voice ? <Mic size={18} /> : <MicOff size={18} />}
          </button>
        </div>
      </header>

      <div className="relative flex-1">
        <div className="relative mx-auto aspect-[3/4] h-[min(calc(100dvh-352px),480px)] w-auto max-w-[400px]">
          {loading ? (
            <CardSkeleton />
          ) : error ? (
            <div className="flex h-full items-center justify-center rounded-card border border-line bg-surface">
              <EmptyState
                title="Couldn't load the deck."
                body="The connection dropped. Nothing was claimed."
                action={
                  <Button variant="ghost" onClick={reload}>
                    Try again
                  </Button>
                }
              />
            </div>
          ) : done ? (
            <div className="flex h-full items-center justify-center rounded-card border border-line bg-surface">
              <EmptyState
                title="You've seen everything."
                body="New drops soon. Check back after the next round of resales."
                action={
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setLoading(true);
                      setTop(0);
                      setExhausted(false);
                      load(null)
                        .catch(() => undefined)
                        .finally(() => setLoading(false));
                    }}
                  >
                    Refresh
                  </Button>
                }
              />
            </div>
          ) : (
            visible
              .map((card, i) => (
                <SwipeCard
                  key={card.listingId}
                  ref={i === 0 ? deckRef : undefined}
                  card={card}
                  depth={i}
                  onCommit={onCommit}
                />
              ))
              .reverse()
          )}
        </div>

        {!done && !loading && !error ? (
          <div className="mt-5 flex items-center justify-center gap-5">
            <button
              aria-label="Let it go"
              onClick={() => deckRef.current?.swipe("left")}
              className="flex h-[68px] w-[68px] items-center justify-center rounded-full border border-line bg-surface text-ink shadow-soft transition-transform active:scale-90"
            >
              <X size={28} strokeWidth={2.6} />
            </button>
            <button
              aria-label="Claim it"
              onClick={() => deckRef.current?.swipe("right")}
              className="flex h-[76px] w-[76px] items-center justify-center rounded-full bg-coral text-white shadow-[0_18px_36px_-12px_rgba(255,77,46,0.6)] transition-transform active:scale-90"
            >
              <Heart size={30} strokeWidth={2} fill="currentColor" />
            </button>
          </div>
        ) : null}

        {!done && !loading && !error && visible[0] ? (
          <div className="mt-3 flex justify-center">
            <button
              onClick={() => setSwapOpen(true)}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-pill border border-line bg-surface px-4 text-[13px] font-semibold text-ink/80 shadow-card hover:text-ink"
            >
              <ArrowLeftRight size={13} /> Swap instead
            </button>
          </div>
        ) : null}

        {undoLeft > 0 ? (
          <div className="mt-3 flex justify-center">
            <button
              onClick={undo}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-pill px-4 text-[13px] text-muted hover:text-ink"
            >
              <Undo2 size={13} /> Undo · {undoLeft}s
            </button>
          </div>
        ) : (
          <p className="mt-3 text-center text-[12px] text-muted">Swipe right to claim · left to pass</p>
        )}
      </div>

      <SwapSheet card={swapOpen ? (visible[0] ?? null) : null} onClose={() => setSwapOpen(false)} />

      <Sheet open={Boolean(claim)} onClose={closeClaim} title="Claimed">
        <p className="text-[14px] leading-relaxed text-muted">
          {claim ? claim.card.title : ""} is held for you for 30 minutes.
        </p>
        <div className="mt-5 rounded-btn border border-line bg-raised px-4 py-3.5">
          <div className="flex items-center justify-between">
            <span className="text-[14px] text-muted">You pay</span>
            <span className="num text-[24px] font-extrabold">{claim ? formatUsd(claim.card.priceCents) : ""}</span>
          </div>
          <p className="mt-1 text-[12px] text-muted">Held until the seller hands over.</p>
        </div>
        {short ? (
          <div className="mt-4 rounded-btn border border-coral/30 bg-coral/[0.08] px-4 py-3">
            <p className="text-[13px] text-ink/85">You&apos;re ${shortfall} short. Add $100 of test funds and pay now?</p>
          </div>
        ) : null}
        <div className="mt-5 space-y-2">
          {short ? (
            <Button full onClick={topUpAndPay} loading={toppingUp}>
              Add $100 and pay
            </Button>
          ) : (
            <Button full onClick={pay} loading={paying}>
              Pay {claim ? formatUsd(claim.card.priceCents) : ""}
            </Button>
          )}
          <Button full variant="quiet" onClick={releaseClaim}>
            Not now
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
