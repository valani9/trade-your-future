"use client";

import { useEffect, useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import type { FeedCard } from "@/lib/services/feed";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { formatUsd } from "@/lib/money";
import { formatEventDate } from "@/lib/utils";

type MyPlan = {
  id: string;
  title: string;
  venue: string;
  city: string;
  timeZone: string;
  startsAt: string;
  faceValueCents: number;
  transferability: string;
  status: string;
};

export function SwapSheet({ card, onClose }: { card: FeedCard | null; onClose: () => void }) {
  const toast = useToast();
  const [plans, setPlans] = useState<MyPlan[] | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!card) return;
    setPlans(null);
    setFailed(false);
    fetch("/api/plans")
      .then((r) => {
        if (!r.ok) throw new Error("plans");
        return r.json();
      })
      .then((data) => setPlans((data.items ?? []).filter((p: MyPlan) => p.status === "active" && p.transferability !== "non_transferable")))
      .catch(() => {
        setFailed(true);
        setPlans([]);
      });
  }, [card]);

  async function propose(plan: MyPlan) {
    if (!card) return;
    setSending(plan.id);
    try {
      const res = await fetch("/api/swaps", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ offerPlanId: plan.id, wantListingId: card.listingId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.show(data.error ?? "Couldn't send that offer", "error");
        return;
      }
      const diff = data.diffCents ?? 0;
      toast.show(
        diff === 0
          ? "Even trade. Offer sent."
          : diff > 0
            ? `Offer sent. They'd owe you ${formatUsd(diff)}.`
            : `Offer sent. You'd owe ${formatUsd(-diff)}.`,
      );
      onClose();
    } finally {
      setSending(null);
    }
  }

  return (
    <Sheet open={Boolean(card)} onClose={onClose} title="Swap instead">
      <p className="text-[13px] leading-relaxed text-muted">
        Trade one of your plans for this one. Whoever&apos;s side is worth more pays the difference.
      </p>
      <div className="mt-4 space-y-2">
        {plans === null ? (
          <>
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </>
        ) : failed ? (
          <p className="rounded-btn border border-line px-4 py-4 text-[13px] text-muted">
            Couldn&apos;t load your plans. Close this and try again.
          </p>
        ) : plans.length === 0 ? (
          <p className="rounded-btn border border-line px-4 py-4 text-[13px] text-muted">
            You need an active plan to trade. Add one from the Sell tab.
          </p>
        ) : (
          plans.map((plan) => {
            const diff = plan.faceValueCents - (card?.priceCents ?? 0);
            return (
              <button
                key={plan.id}
                onClick={() => propose(plan)}
                disabled={sending !== null}
                className="flex w-full items-center gap-3 rounded-btn border border-line bg-raised px-3.5 py-3 text-left transition-colors hover:bg-white/[0.06] disabled:opacity-50"
              >
                <ArrowLeftRight size={16} className="shrink-0 text-slate" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">{plan.title}</span>
                  <span className="block text-[12px] text-muted">
                    {formatEventDate(new Date(plan.startsAt), plan.timeZone)}
                  </span>
                </span>
                <span className="num shrink-0 text-right text-[12px] text-muted">
                  {diff === 0 ? "Even" : diff > 0 ? `You get ${formatUsd(diff)}` : `You pay ${formatUsd(-diff)}`}
                </span>
              </button>
            );
          })
        )}
      </div>
      <div className="mt-4">
        <Button full variant="quiet" onClick={onClose}>
          Never mind
        </Button>
      </div>
    </Sheet>
  );
}
