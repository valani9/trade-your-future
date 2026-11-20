"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatEventDate } from "@/lib/utils";
import { formatUsd } from "@/lib/money";
import { Card } from "@/components/ui/Card";
import { StatusPill } from "@/components/ui/Pill";
import { Skeleton } from "@/components/ui/Skeleton";
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

export default function OrdersPage() {
  const [role, setRole] = useState<"buyer" | "seller">("buyer");
  const [items, setItems] = useState<Order[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    fetch(`/api/orders?role=${role}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setItems(data.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [role]);

  return (
    <div className="px-4 pb-6">
      <header className="px-1 pt-5 pb-4">
        <p className="text-[11px] uppercase tracking-[0.16em] text-faint">Orders</p>
        <h1 className="text-[20px] font-semibold tracking-tighter">What you&apos;re trading</h1>
      </header>

      <div className="mb-4 flex gap-1 rounded-pill border border-line bg-surface p-1" role="tablist">
        {(["buyer", "seller"] as const).map((r) => (
          <button
            key={r}
            role="tab"
            aria-selected={role === r}
            onClick={() => setRole(r)}
            className={`flex-1 rounded-pill py-2 text-[13px] font-medium transition-colors ${
              role === r ? "bg-white/[0.08] text-ink" : "text-muted"
            }`}
          >
            {r === "buyer" ? "Buying" : "Selling"}
          </button>
        ))}
      </div>

      {items === null ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title={role === "buyer" ? "Nothing claimed yet." : "Nothing on sale yet."}
          body={role === "buyer" ? "Swipe right on something you want." : "Sell a plan you can't make."}
          action={
            <Link href={role === "buyer" ? "/buy" : "/sell"} className="text-[14px] font-medium text-coral">
              {role === "buyer" ? "Browse the deck" : "Go to sell"}
            </Link>
          }
        />
      ) : (
        <ul className="space-y-3">
          {items.map((order) => (
            <li key={order.id}>
              <Link href={`/orders/${order.id}`} className="block">
                <Card className="flex gap-3 p-3 transition-colors hover:bg-raised">
                  <div className="h-20 w-16 overflow-hidden rounded-xl bg-raised">
                    {order.plan.imageUrl ? (
                      <img src={order.plan.imageUrl} alt="" className="h-full w-full object-cover" />
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
                      <span className="text-[11px] text-faint">
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
  );
}
