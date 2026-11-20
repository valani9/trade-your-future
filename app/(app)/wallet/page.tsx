"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card, Row } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { formatUsd } from "@/lib/money";

type Wallet = { balanceCents: number; demo: boolean };

export default function WalletPage() {
  const toast = useToast();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [adding, setAdding] = useState(false);

  async function load() {
    const res = await fetch("/api/wallet", { cache: "no-store" });
    if (res.ok) setWallet(await res.json());
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
        <p className="text-[11px] uppercase tracking-[0.16em] text-faint">Balance</p>
        <h1 className="text-[20px] font-semibold tracking-tighter">Money you can spend</h1>
      </header>

      <Card className="px-5 py-6">
        {wallet ? (
          <>
            <p className="num text-[42px] font-semibold leading-none tracking-tightest">
              {formatUsd(wallet.balanceCents)}
            </p>
            <p className="mt-2 text-[12px] text-faint">Spendable now</p>
          </>
        ) : (
          <Skeleton className="h-12 w-40" />
        )}
      </Card>

      <div className="mt-4">
        <Button full variant="ghost" onClick={addFunds} loading={adding}>
          Add test funds
        </Button>
      </div>

      <Card className="mt-6">
        <Row>
          <span className="text-[13px] text-muted">Held in escrow</span>
          <span className="text-[13px] text-ink/70">See orders</span>
        </Row>
        <Link href="/orders" className="block">
          <Row className="hover:bg-raised">
            <span className="text-[14px]">Your orders</span>
            <span className="text-[13px] text-faint">→</span>
          </Row>
        </Link>
        <Link href="/settings" className="block">
          <Row className="hover:bg-raised">
            <span className="text-[14px]">Settings</span>
            <span className="text-[13px] text-faint">→</span>
          </Row>
        </Link>
      </Card>
    </div>
  );
}
