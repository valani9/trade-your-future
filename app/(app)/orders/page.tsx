"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatEventDate } from "@/lib/utils";
import { formatUsd } from "@/lib/money";
import { Card } from "@/components/ui/Card";
import { StatusPill } from "@/components/ui/Pill";
import { Skeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { statusLabel } from "@/components/app/orderStatus";

type Order = {
  id: string;
  status: string;
  amountCents: number;
  netCents: number;
  buyerId: string;
  sellerId: string;
  buyerName: string | null;
  sellerName: string | null;
  plan: { title: string; venue: string; city: string; startsAt: string; timeZone: string; imageUrl: string | null };
};

type SwapRow = {
  id: string;
  status: string;
  diffCents: number;
  direction: "incoming" | "outgoing";
  offer: { id: string; title: string; city: string; startsAt: string; imageUrl: string | null } | null;
  want: { listingId: string; title: string; city: string; startsAt: string; imageUrl: string | null; priceCents: number } | null;
};

export default function OrdersPage() {
  const [role, setRole] = useState<"buyer" | "seller" | "trades">("buyer");
  const [items, setItems] = useState<Order[] | null>(null);
  const [swaps, setSwaps] = useState<SwapRow[] | null>(null);
  const [selling, setSelling] = useState<Array<{ id: string; title: string; venue: string; city: string; priceCents: number; netCents: number }>>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const loadSwaps = useCallback(async () => {
    const res = await fetch("/api/swaps", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      setSwaps(data.items ?? []);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (role === "trades") {
      setSwaps(null);
      void loadSwaps();
      return () => {
        cancelled = true;
      };
    }
    setItems(null);
    setError(false);
    if (role === "seller") {
      fetch("/api/plans")
        .then((r) => r.json())
        .then((data) => {
          const listed = (data.items ?? [])
            .filter((p: { listing: unknown }) => Boolean(p.listing))
            .map((p: { id: string; title: string; venue: string; city: string; listing: { priceCents: number; netCents: number } }) => ({
              id: p.id,
              title: p.title,
              venue: p.venue,
              city: p.city,
              priceCents: p.listing.priceCents,
              netCents: p.listing.netCents,
            }));
          if (!cancelled) setSelling(listed);
        })
        .catch(() => undefined);
    }
    fetch(`/api/orders?role=${role}`)
      .then(async (r) => {
        if (!r.ok) throw new Error("orders");
        return r.json();
      })
      .then((data) => {
        if (!cancelled) setItems(data.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [role, loadSwaps]);

  async function answerSwap(id: string, action: "accept" | "decline") {
    setBusy(id);
    try {
      const res = await fetch(`/api/swaps/${id}/${action}`, { method: "POST" });
      if (!res.ok) return;
      await loadSwaps();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="px-4 pb-6">
      <header className="px-1 pt-5 pb-4">
        <p className="text-[12px] uppercase tracking-[0.14em] text-muted">Orders</p>
        <h1 className="text-[20px] font-semibold tracking-tighter">What you&apos;re trading</h1>
      </header>

      <div className="mb-4 flex gap-1 rounded-pill border border-line bg-surface p-1" role="tablist" aria-label="Order views">
        {(["buyer", "seller", "trades"] as const).map((r) => (
          <button
            key={r}
            role="tab"
            id={`tab-${r}`}
            aria-selected={role === r}
            aria-controls={`panel-${r}`}
            tabIndex={role === r ? 0 : -1}
            onClick={() => setRole(r)}
            onKeyDown={(e) => {
              const order = ["buyer", "seller", "trades"] as const;
              const at = order.indexOf(r);
              const next = e.key === "ArrowRight" ? order[(at + 1) % order.length] : e.key === "ArrowLeft" ? order[(at + 2) % order.length] : null;
              if (!next) return;
              e.preventDefault();
              setRole(next);
              document.getElementById(`tab-${next}`)?.focus();
            }}
            className={`min-h-11 flex-1 rounded-pill text-[13px] font-medium transition-colors ${
              role === r ? "bg-white/[0.08] text-ink" : "text-muted"
            }`}
          >
            {r === "buyer" ? "Buying" : r === "seller" ? "Selling" : "Trades"}
          </button>
        ))}
      </div>

      <div id={`panel-${role}`} role="tabpanel" aria-labelledby={`tab-${role}`}>
      {error ? (
        <EmptyState
          title="Couldn't load your orders."
          body="The connection dropped. Try again in a moment."
          action={
            <Button variant="ghost" onClick={() => setRole(role)}>
              Try again
            </Button>
          }
        />
      ) : null}
      {error ? null : role === "trades" ? (
        swaps === null ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : swaps.length === 0 ? (
          <EmptyState
            title="No trades yet."
            body="Open a card you like and tap Swap instead."
            action={
              <Link href="/buy" className="inline-flex min-h-11 items-center px-2 text-[14px] font-medium text-coral">
                Browse the deck
              </Link>
            }
          />
        ) : (
          <ul className="space-y-3">
            {swaps.map((swap) => (
              <li key={swap.id}>
                <Card className="p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-[13px] text-muted">
                      {swap.direction === "incoming" ? "They want" : "You want"}
                    </p>
                    <StatusPill status={swap.status} />
                  </div>
                  <p className="mt-1 text-[15px] font-medium">{swap.want?.title ?? "A plan"}</p>
                  <p className="text-[12px] text-faint">
                    for {swap.offer?.title ?? "your plan"}
                    {swap.diffCents === 0
                      ? " · even trade"
                      : swap.diffCents > 0
                        ? ` · +${formatUsd(swap.diffCents)}`
                        : ` · −${formatUsd(-swap.diffCents)}`}
                  </p>
                  {swap.direction === "incoming" && swap.status === "proposed" ? (
                    <div className="mt-3 flex gap-2">
                      <Button size="sm" onClick={() => answerSwap(swap.id, "accept")} loading={busy === swap.id}>
                        Accept
                      </Button>
                      <Button size="sm" variant="quiet" onClick={() => answerSwap(swap.id, "decline")}>
                        Decline
                      </Button>
                    </div>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        )
      ) : items === null ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : role === "seller" && items.length === 0 && selling.length === 0 ? (
        <EmptyState
          title="No buyers yet."
          body="Sell a plan from the Sell tab and it shows up in everyone's deck."
          action={
            <Link href="/sell" className="inline-flex min-h-11 items-center px-2 text-[14px] font-medium text-coral">
              Go to sell
            </Link>
          }
        />
      ) : items.length === 0 && selling.length === 0 ? (
        <EmptyState
          title={role === "buyer" ? "Nothing claimed yet." : "Nothing on sale yet."}
          body={role === "buyer" ? "Swipe right on something you want." : "Sell a plan you can't make."}
          action={
            <Link href={role === "buyer" ? "/buy" : "/sell"} className="inline-flex min-h-11 items-center px-2 text-[14px] font-medium text-coral">
              {role === "buyer" ? "Browse the deck" : "Go to sell"}
            </Link>
          }
        />
      ) : (
        <ul className="space-y-3">
          {role === "seller"
            ? selling.map((plan) => (
                <li key={`listing-${plan.id}`}>
                  <Card className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[15px] font-medium">{plan.title}</p>
                        <p className="mt-0.5 truncate text-[12px] text-muted">
                          {plan.venue} · {plan.city}
                        </p>
                      </div>
                      <span className="num shrink-0 whitespace-nowrap text-[14px] font-semibold">
                        {formatUsd(plan.priceCents)}
                      </span>
                    </div>
                    <p className="mt-2 text-[12px] text-faint">On sale · you get {formatUsd(plan.netCents)}</p>
                  </Card>
                </li>
              ))
            : null}
          {items.map((order) => (
            <li key={order.id}>
              <Link href={`/orders/${order.id}`} className="block">
                <Card className="flex gap-3 p-3 transition-colors hover:bg-raised">
                  <div className="h-20 w-16 overflow-hidden rounded-xl bg-raised">
                    {order.plan.imageUrl ? (
                      <img src={order.plan.imageUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-[15px] font-medium">{order.plan.title}</p>
                      <StatusPill status={order.status} label={statusLabel(order.status)} />
                    </div>
                    <p className="mt-0.5 truncate text-[12px] text-muted">
                      {order.plan.venue} · {order.plan.city}
                    </p>
                    <p className="mt-0.5 text-[12px] text-faint">
                      {formatEventDate(new Date(order.plan.startsAt), order.plan.timeZone)}
                    </p>
                    <div className="mt-1.5 flex items-center justify-between">
                      <span className="num text-[15px] font-semibold">{formatUsd(order.amountCents)}</span>
                      <span className="text-[12px] text-faint">
                        {role === "seller" ? `You get ${formatUsd(order.netCents)}` : order.sellerName}
                      </span>
                    </div>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
      </div>
    </div>
  );
}
