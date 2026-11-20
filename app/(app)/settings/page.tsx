"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/Button";
import { Card, Row } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";

type Me = { name: string | null; email: string | null; isDemo: boolean; googleConnected: boolean };

export default function SettingsPage() {
  const toast = useToast();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then(setMe)
      .catch(() => undefined);
  }, []);

  const [confirmReset, setConfirmReset] = useState(false);

  async function resetDemo() {
    setResetting(true);
    try {
      const res = await fetch("/api/demo/reset", { method: "POST" });
      if (!res.ok) {
        toast.show("Couldn't reset the demo", "error");
        return;
      }
      toast.show("Demo reset");
      router.push("/buy");
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="px-4 pb-8">
      <header className="px-1 pt-5 pb-4">
        <p className="text-[13px] font-semibold text-muted">Settings</p>
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tighter">Account</h1>
      </header>

      <Card>
        <Row>
          <span className="text-[13px] text-muted">Signed in as</span>
          <span className="text-[13px]">{me?.name ?? me?.email ?? "—"}</span>
        </Row>
        <Row>
          <span className="text-[13px] text-muted">Google Calendar</span>
          <span className="text-[13px] text-ink/70">{me?.googleConnected ? "Connected" : "Not connected"}</span>
        </Row>
      </Card>

      {me?.isDemo ? (
        <div className="mt-4">
          {confirmReset ? (
            <div className="rounded-card border border-line bg-surface p-4">
              <p className="text-[14px] font-medium">Reset the demo?</p>
              <p className="mt-1 text-[13px] text-muted">
                Every order, listing and plan goes back to the seed, and anything you paid returns to your balance.
              </p>
              <div className="mt-3 flex gap-2">
                <Button size="md" onClick={resetDemo} loading={resetting}>
                  Reset it
                </Button>
                <Button size="md" variant="quiet" onClick={() => setConfirmReset(false)}>
                  Keep my demo
                </Button>
              </div>
            </div>
          ) : (
            <Button full variant="ghost" onClick={() => setConfirmReset(true)}>
              Reset the demo
            </Button>
          )}
        </div>
      ) : null}

      <div className="mt-3">
        <Button full variant="quiet" onClick={() => signOut({ callbackUrl: "/" })}>
          Sign out
        </Button>
      </div>
    </div>
  );
}
