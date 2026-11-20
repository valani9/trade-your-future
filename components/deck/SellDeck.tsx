"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, ClipboardPaste, Tag } from "lucide-react";
import type { PlanCardData } from "./PlanCard";
import { PlanCard, type PlanHandle } from "./PlanCard";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Sheet } from "@/components/ui/Sheet";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { formatUsd } from "@/lib/money";
import { formatEventDate } from "@/lib/utils";

type ClashGroup = { dayLabel: string; planIds: string[] };

export function SellDeck({ demoMode }: { demoMode: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [plans, setPlans] = useState<PlanCardData[] | null>(null);
  const [clashes, setClashes] = useState<ClashGroup[]>([]);
  const [top, setTop] = useState(0);
  const [sellPlan, setSellPlan] = useState<PlanCardData | null>(null);
  const [price, setPrice] = useState(0);
  const [suggest, setSuggest] = useState<{ suggestedPriceCents: number; minPriceCents: number; maxPriceCents: number } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [pasted, setPasted] = useState("");
  const [syncing, setSyncing] = useState(false);
  const deckRef = useRef<PlanHandle>(null);

  const load = useCallback(async () => {
    const [plansRes, clashRes] = await Promise.all([
      fetch("/api/plans", { cache: "no-store" }),
      fetch("/api/clashes", { cache: "no-store" }),
    ]);
    const plansData = (await plansRes.json()) as { items: PlanCardData[] };
    const clashData = (await clashRes.json()) as { groups: ClashGroup[] };
    setPlans((plansData.items ?? []).filter((p) => p.status === "active" || p.status === "listed"));
    setClashes(clashData.groups ?? []);
    setTop((n) => Math.min(n, Math.max(0, (plansData.items?.length ?? 1) - 1)));
  }, []);

  useEffect(() => {
    load()
      .catch(() => toast.show("Couldn't load your plans", "error"))
      .finally(() => setPlans((prev) => prev ?? []));
  }, [load, toast]);

  async function openSell(plan: PlanCardData) {
    setSellPlan(plan);
    setPrice(plan.faceValueCents || 1000);
    try {
      const res = await fetch(`/api/listings/${plan.id}/suggest`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setSuggest(data);
        setPrice(data.suggestedPriceCents);
      }
    } catch {
      setSuggest(null);
    }
  }

  async function list() {
    if (!sellPlan) return;
    setBusy(true);
    try {
      const res = await fetch("/api/listings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planId: sellPlan.id, priceCents: price }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.show(data.error ?? "Couldn't list it", "error");
        return;
      }
      setSellPlan(null);
      setTop((n) => n + 1);
      await load();
      toast.show("Listed. It's in everyone's deck now.", "money");
    } finally {
      setBusy(false);
    }
  }

  async function keep() {
    setTop((n) => n + 1);
  }

  async function unlist() {
    const listingId = sellPlan?.listing?.id;
    if (!listingId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/listings/${listingId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.show(data.error ?? "Couldn't take it off sale", "error");
        return;
      }
      setSellPlan(null);
      await load();
      toast.show("Off sale. It's yours again.");
    } finally {
      setBusy(false);
    }
  }

  async function syncCalendar() {
    setSyncing(true);
    try {
      const res = await fetch("/api/plans/sync", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.show(data.error ?? "Couldn't reach your calendar", "error");
        return;
      }
      await load();
      toast.show(`Pulled ${data.imported ?? 0} plans`);
    } finally {
      setSyncing(false);
    }
  }

  async function importPlan() {
    setBusy(true);
    try {
      const res = await fetch("/api/plans/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: pasted }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.show(data.error ?? "Couldn't read that", "error");
        return;
      }
      setImportOpen(false);
      setPasted("");
      await load();
      toast.show("Added to your plans");
    } finally {
      setBusy(false);
    }
  }

  const visible = useMemo(() => (plans ?? []).slice(top, top + 3), [plans, top]);
  const clashPlans = useMemo(() => {
    const group = clashes[0];
    if (!group || !plans) return [];
    return group.planIds.map((id) => plans.find((p) => p.id === id)).filter(Boolean) as PlanCardData[];
  }, [clashes, plans]);

  if (plans === null) {
    return (
      <div className="space-y-3 px-4 pt-6">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="aspect-[3/4] w-full rounded-card" />
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100dvh-72px)] flex-col px-4">
      <header className="flex items-center justify-between px-1 pt-5 pb-3">
        <div>
          <p className="text-[12px] uppercase tracking-[0.14em] text-muted">Sell</p>
          <h1 className="text-[20px] font-semibold tracking-tighter">Your plans</h1>
        </div>
        <button
          onClick={syncCalendar}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-pill border border-line px-4 text-[12px] text-muted hover:text-ink"
        >
          <CalendarPlus size={13} /> Sync
          {syncing ? <span className="text-[12px] text-muted">…</span> : null}
        </button>
      </header>

      {clashPlans.length >= 2 ? (
        <button onClick={() => openSell(clashPlans[1])} className="mb-4 block w-full text-left">
          <Card className="border-coral/25 bg-coral/[0.07] px-4 py-3.5">
            <p className="text-[13px] font-medium text-coral">
              {clashPlans.length} plans at {formatEventDate(new Date(clashPlans[0].startsAt), clashPlans[0].timeZone).split(" · ")[0]} ·{" "}
              {clashPlans[0].venue}
            </p>
            <p className="mt-0.5 text-[12px] text-muted">
              Sell {clashPlans[1].title.split(" ").slice(0, 4).join(" ")} and pocket the difference →
            </p>
          </Card>
        </button>
      ) : null}

      {plans.length === 0 ? (
        <EmptyState
          title="No plans yet."
          body="Pull your calendar, or paste a confirmation and we'll read it."
          action={
            <div className="flex flex-col gap-2">
              <Button onClick={syncCalendar} loading={syncing}>
                Connect calendar
              </Button>
              <Button variant="ghost" onClick={() => setImportOpen(true)}>
                Paste a confirmation
              </Button>
            </div>
          }
        />
      ) : top >= plans.length ? (
        <div className="flex flex-1 items-center justify-center rounded-card border border-line bg-surface">
          <EmptyState
            title="That's all your plans."
            body="Kept every one. Add more whenever you like."
            action={
              <Button variant="ghost" onClick={() => setTop(0)}>
                Look again
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <div className="relative mx-auto aspect-[3/4] w-full max-w-[400px]">
            {visible
              .map((plan, i) => (
                <PlanCard
                  key={plan.id}
                  ref={i === 0 ? deckRef : undefined}
                  plan={plan}
                  depth={i}
                  onSell={() => openSell(plan)}
                  onKeep={keep}
                />
              ))
              .reverse()}
          </div>

          <div className="mt-5 flex items-center justify-center gap-5">
            <button
              aria-label="Sell this one"
              onClick={() => deckRef.current?.swipe("left")}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-slate text-white transition-transform active:scale-95"
            >
              <Tag size={24} strokeWidth={2} />
            </button>
            <button
              aria-label="Keep this one"
              onClick={() => deckRef.current?.swipe("right")}
              className="flex h-16 w-16 items-center justify-center rounded-full border border-line bg-white/[0.04] text-ink transition-transform active:scale-95"
            >
              <span className="text-[18px]">→</span>
            </button>
          </div>
          <p className="mt-3 text-center text-[12px] text-muted">Left to sell · right to keep</p>
        </>
      )}

      <button
        onClick={() => setImportOpen(true)}
        className="mt-3 inline-flex min-h-11 items-center justify-center gap-1.5 px-2 text-[13px] text-muted hover:text-ink"
      >
        <ClipboardPaste size={13} /> Paste a confirmation
      </button>

      <Sheet
        open={Boolean(sellPlan)}
        onClose={() => setSellPlan(null)}
        title={sellPlan?.listing ? "On sale" : "What's it worth?"}
      >
        {sellPlan ? (
          <>
            <p className="text-[13px] text-muted">
              {sellPlan.title} · {formatEventDate(new Date(sellPlan.startsAt), sellPlan.timeZone)}
            </p>
            <div className="mt-5 flex items-baseline justify-between">
              <span className="text-[13px] text-muted">Your price</span>
              <span className="num text-[30px] font-semibold leading-none">{formatUsd(price)}</span>
            </div>
            <input
              type="range"
              aria-label="Asking price"
              min={suggest?.minPriceCents ?? 100}
              max={suggest?.maxPriceCents ?? Math.max(sellPlan.faceValueCents * 3, 10000)}
              step={100}
              value={price}
              onChange={(e) => setPrice(Number(e.target.value))}
              className="mt-4 h-11 w-full accent-coral"
            />
            <div className="mt-3 rounded-btn border border-line bg-raised px-4 py-3">
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-muted">You get</span>
                <span className="num font-semibold text-mint">{formatUsd(price - Math.floor(price / 10))}</span>
              </div>
              <p className="mt-1 text-[12px] text-muted">10% fee, only when it sells.</p>
            </div>
            <div className="mt-5 space-y-2">
              {sellPlan.listing ? (
                <Button full variant="danger" onClick={unlist} loading={busy}>
                  Take it off sale
                </Button>
              ) : (
                <Button full onClick={list} loading={busy}>
                  List for {formatUsd(price)}
                </Button>
              )}
              <Button full variant="quiet" onClick={() => setSellPlan(null)}>
                Maybe later
              </Button>
            </div>
          </>
        ) : null}
      </Sheet>

      <Sheet open={importOpen} onClose={() => setImportOpen(false)} title="Paste a confirmation">
        <p className="text-[13px] leading-relaxed text-muted">
          Drop in a ticket email or reservation and we&apos;ll pull out the date, venue and price.
        </p>
        <textarea
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          rows={5}
          placeholder="Your order for Maggie Rogers at Stubb's BBQ on Sat, Nov 21, 2026 at 7:30 PM. Total $95.00"
          className="mt-4 w-full resize-none rounded-btn border border-line bg-base px-3.5 py-3 text-[13px] text-ink placeholder:text-faint focus:border-white/20 focus:outline-none"
        />
        <div className="mt-4">
          <Button full onClick={importPlan} loading={busy} disabled={pasted.trim().length < 6}>
            Add to my plans
          </Button>
        </div>
      </Sheet>

      {demoMode ? <p className="mt-4 text-center text-[12px] text-muted">Demo workspace</p> : null}
      <button onClick={() => router.refresh()} className="sr-only">
        Refresh
      </button>
    </div>
  );
}
