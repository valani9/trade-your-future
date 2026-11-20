"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Check, ExternalLink, Shield } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, Row } from "@/components/ui/Card";
import { Sheet } from "@/components/ui/Sheet";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusPill } from "@/components/ui/Pill";
import { useToast } from "@/components/ui/Toast";
import { formatEventDate } from "@/lib/utils";
import { formatUsd } from "@/lib/money";
import { STATUS_STEPS, statusLabel, stepLabel } from "@/components/app/orderStatus";

type Order = {
  id: string;
  status: string;
  amountCents: number;
  feeCents: number;
  netCents: number;
  buyerId: string;
  sellerId: string;
  buyerName: string | null;
  sellerName: string | null;
  handoverNote: string | null;
  fundTx: string | null;
  releaseTx: string | null;
  refundTx: string | null;
  memoTx: string | null;
  listingId: string;
  plan: {
    id: string;
    title: string;
    venue: string;
    city: string;
    category: string;
    timeZone: string;
    startsAt: string;
    endsAt: string;
    imageUrl: string | null;
    transferability: string;
  };
};

type Receipt = {
  funded: { signature: string | null; explorer: string | null };
  released: { signature: string | null; explorer: string | null };
  refunded: { signature: string | null; explorer: string | null };
  memo: { signature: string | null; explorer: string | null };
  escrowAddress: string;
  cluster: string;
};

export default function OrderPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const [order, setOrder] = useState<Order | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [handoverOpen, setHandoverOpen] = useState(false);
  const [note, setNote] = useState("");
  const [meId, setMeId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/orders/${params.id}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as Order;
    setOrder(data);
    const receiptRes = await fetch(`/api/receipts/${params.id}`, { cache: "no-store" });
    if (receiptRes.ok) setReceipt((await receiptRes.json()) as Receipt);
  }, [params.id]);

  useEffect(() => {
    void load();
    fetch("/api/me")
      .then((r) => r.json())
      .then((data) => setMeId(data.id ?? null))
      .catch(() => undefined);
  }, [load]);

  useEffect(() => {
    if (!order) return;
    if (!["created", "funded", "handed_over"].includes(order.status)) return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [order, load]);

  async function act(action: "fund" | "confirm" | "cancel" | "dispute", body?: object) {
    setBusy(action);
    try {
      const res = await fetch(`/api/orders/${params.id}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": `${action}-${params.id}` },
        body: JSON.stringify(body ?? {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.show(data.error ?? "That didn't work", "error");
        return;
      }
      await load();
      toast.show(
        action === "confirm" ? "Done. Nice one." : action === "fund" ? "Paid. Held until handover." : "Updated",
        action === "fund" ? "money" : "neutral",
      );
    } catch {
      toast.show("Connection lost. Try again.", "error");
    } finally {
      setBusy(null);
    }
  }

  async function handover() {
    setBusy("handover");
    try {
      const res = await fetch(`/api/orders/${params.id}/handover`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": `handover-${params.id}` },
        body: JSON.stringify({ note }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.show(data.error ?? "That didn't work", "error");
        return;
      }
      setHandoverOpen(false);
      await load();
      toast.show("Handed over");
    } finally {
      setBusy(null);
    }
  }

  if (!order) {
    return (
      <div className="space-y-4 px-4 pt-6">
        <Skeleton className="h-56 w-full rounded-card" />
        <Skeleton className="h-32 w-full rounded-card" />
      </div>
    );
  }

  const stepIndex = STATUS_STEPS.indexOf(order.status as (typeof STATUS_STEPS)[number]);
  const isBuyer = meId !== null && meId === order.buyerId;
  const isSeller = meId !== null && meId === order.sellerId;

  return (
    <div className="px-4 pb-8">
      <header className="flex items-center justify-between px-1 pt-4 pb-3">
        <button onClick={() => router.push("/orders")} className="text-[13px] text-muted hover:text-ink">
          ← Orders
        </button>
        <StatusPill status={order.status} label={statusLabel(order.status)} />
      </header>

      <Card className="overflow-hidden">
        <div className="flex gap-3 p-4">
          <div className="h-24 w-20 overflow-hidden rounded-xl bg-raised">
            {order.plan.imageUrl ? <img src={order.plan.imageUrl} alt="" className="h-full w-full object-cover" /> : null}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="line-clamp-2 text-[19px] font-semibold leading-tight tracking-tighter">{order.plan.title}</h1>
            <p className="mt-1 text-[12px] text-muted">
              {order.plan.venue} · {order.plan.city}
            </p>
            <p className="text-[12px] text-ink/70">{formatEventDate(new Date(order.plan.startsAt), order.plan.timeZone)}</p>
          </div>
        </div>

        <div className="border-t border-line px-4 py-3.5">
          <div className="flex items-center justify-between text-[12px]">
            {STATUS_STEPS.map((step, i) => (
              <div key={step} className="flex flex-1 flex-col items-center gap-1.5">
                <div className="flex w-full items-center">
                  <span className={`h-px flex-1 ${i === 0 ? "bg-transparent" : i <= stepIndex ? "bg-mint/60" : "bg-white/10"}`} />
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full border text-[10px] ${
                      i <= stepIndex ? "border-mint/50 bg-mint/15 text-mint" : "border-white/12 text-faint"
                    }`}
                  >
                    {i <= stepIndex ? <Check size={11} strokeWidth={3} /> : i + 1}
                  </span>
                  <span
                    className={`h-px flex-1 ${i === STATUS_STEPS.length - 1 ? "bg-transparent" : i < stepIndex ? "bg-mint/60" : "bg-white/10"}`}
                  />
                </div>
                <span className={`text-center text-[10px] ${i <= stepIndex ? "text-ink/80" : "text-faint"}`}>
                  {stepLabel(step)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {order.status === "created" ? (
        <div className="mt-4 space-y-2">
          <Button full onClick={() => act("fund")} loading={busy === "fund"}>
            Pay {formatUsd(order.amountCents)}
          </Button>
          <p className="text-center text-[12px] text-faint">Held until the seller hands over.</p>
        </div>
      ) : null}

      {order.status === "handed_over" && isBuyer ? (
        <div className="mt-4 space-y-2">
          <Button full onClick={() => act("confirm")} loading={busy === "confirm"}>
            Got it — release {formatUsd(order.netCents)}
          </Button>
          <p className="text-center text-[12px] text-faint">
            {order.handoverNote ? order.handoverNote : "Seller marked it handed over."}
          </p>
        </div>
      ) : null}

      {isSeller && (order.status === "funded" || order.status === "handed_over") ? (
        <div className="mt-3">
          <Button full variant="ghost" onClick={() => setHandoverOpen(true)}>
            Hand it over to {order.buyerName?.split(" ")[0] ?? "the buyer"}
          </Button>
        </div>
      ) : null}

      {isSeller && order.status === "created" ? (
        <p className="mt-4 text-center text-[12px] text-faint">Waiting on the buyer to pay.</p>
      ) : null}

      <Card className="mt-4">
        <Row>
          <span className="text-[13px] text-muted">Amount</span>
          <span className="num text-[14px] font-medium">{formatUsd(order.amountCents)}</span>
        </Row>
        <Row>
          <span className="text-[13px] text-muted">Seller gets</span>
          <span className="num text-[14px] font-medium">
            {formatUsd(order.netCents)} <span className="text-faint">· fee {formatUsd(order.feeCents)}</span>
          </span>
        </Row>
        {order.handoverNote ? (
          <Row>
            <span className="text-[13px] text-muted">Note</span>
            <span className="max-w-[60%] text-right text-[13px]">{order.handoverNote}</span>
          </Row>
        ) : null}
      </Card>

      {receipt && order.status === "released" ? (
        <div className="mt-4 overflow-hidden rounded-card border border-line bg-raised">
          <div className="relative border-b border-dashed border-white/15 px-5 py-4">
            <p className="text-[10px] uppercase tracking-[0.16em] text-faint">Receipt</p>
            <p className="mt-1.5 text-[17px] font-semibold tracking-tighter">{order.plan.title}</p>
            <p className="text-[12px] text-muted">
              {formatEventDate(new Date(order.plan.startsAt), order.plan.timeZone)}
            </p>
            <div className="absolute -left-2 -bottom-2 h-4 w-4 rounded-full bg-base" />
            <div className="absolute -right-2 -bottom-2 h-4 w-4 rounded-full bg-base" />
          </div>
          <div className="space-y-2 px-5 py-4">
            <p className="flex items-center gap-1.5 text-[12px] text-muted">
              <Shield size={13} className="text-mint" /> Secured on Solana
            </p>
            {[receipt.funded, receipt.released, receipt.memo].map((entry, i) =>
              entry.explorer ? (
                <a
                  key={i}
                  href={entry.explorer}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between rounded-btn border border-line px-3 py-2 text-[12px] text-ink/80 hover:bg-white/[0.04]"
                >
                  <span className="truncate">{i === 0 ? "Payment" : i === 1 ? "Payout" : "Receipt"}</span>
                  <ExternalLink size={13} />
                </a>
              ) : null,
            )}
          </div>
        </div>
      ) : null}

      {order.status === "refunded" ? (
        <Card className="mt-4 px-4 py-3.5">
          <p className="text-[13px] text-mint">Refunded in full. Back in your balance.</p>
        </Card>
      ) : null}

      {order.status === "released" ? (
        <div className="mt-5 flex gap-2">
          <Link href="/buy" className="flex-1">
            <Button full variant="ghost">
              Keep browsing
            </Button>
          </Link>
          <Link href="/orders" className="flex-1">
            <Button full variant="quiet">
              All orders
            </Button>
          </Link>
        </div>
      ) : null}

      <Sheet open={handoverOpen} onClose={() => setHandoverOpen(false)} title="Hand it over">
        <p className="text-[13px] leading-relaxed text-muted">
          Add a note for the buyer (or leave it blank). We&apos;ll hold the money until they confirm.
        </p>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="Tickets forwarded to your email"
          className="mt-4 w-full resize-none rounded-btn border border-line bg-base px-3.5 py-3 text-[14px] text-ink placeholder:text-faint focus:border-white/20 focus:outline-none"
        />
        <div className="mt-4">
          <Button full onClick={handover} loading={busy === "handover"}>
            Mark handed over
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
