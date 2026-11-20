"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card, Row } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { formatUsd } from "@/lib/money";

type Wallet = { balanceCents: number; heldCents: number; demo: boolean };

export default function WalletPage() {
  const toast = useToast();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState(false);

  async function load() {
    setError(false);
    try {
      const res = await fetch("/api/wallet", { cache: "no-store" });
      if (!res.ok) throw new Error("wallet");
      setWallet(await res.json());
    } catch {
      setError(true);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function addFunds() {
    setAdding(true);
    try {
      const res = await fetch("/api/wallet/fund", { method: "POST" });
      if (!res.ok) {
        toast.show("Couldn't add funds", "error");
        return;
      }
      await load();
      toast.show("Added $100", "money");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="px-4 pb-8">
      <header className="px-1 pt-5 pb-4">
        <p className="text-[13px] font-semibold text-muted">Balance</p>
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tighter">Money you can spend</h1>
      </header>

      <Card className="px-5 py-6">
        {wallet ? (
          <>
            <p className="num text-[42px] font-semibold leading-none tracking-tightest">
              {formatUsd(wallet.balanceCents)}
            </p>
            <p className="mt-2 text-[12px] text-muted">Spendable now</p>
          </>
        ) : error ? (
          <div>
            <p className="text-[15px] font-medium">Couldn&apos;t load your balance.</p>
            <button onClick={() => void load()} className="mt-2 min-h-11 text-[13px] font-medium text-coral">
              Try again
            </button>
          </div>
        ) : (
          <Skeleton className="h-12 w-40" />
        )}
      </Card>

      {wallet?.demo ? (
        <div className="mt-4">
          <Button full variant="ghost" onClick={addFunds} loading={adding}>
            Add test funds
          </Button>
        </div>
      ) : null}

      <Card className="mt-6">
        <Row>
          <span className="text-[13px] text-muted">Held until handover</span>
          <span className="num text-[13px] text-ink/80">{wallet ? formatUsd(wallet.heldCents) : "—"}</span>
        </Row>
        <Link href="/orders" className="block">
          <Row className="hover:bg-raised">
            <span className="text-[14px]">Your orders</span>
            <span className="text-[13px] text-muted">→</span>
          </Row>
        </Link>
        <Link href="/settings" className="block">
          <Row className="hover:bg-raised">
            <span className="text-[14px]">Settings</span>
            <span className="text-[13px] text-muted">→</span>
          </Row>
        </Link>
      </Card>
    </div>
  );
}
