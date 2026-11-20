import { Button } from "@/components/ui/Button";
import { Card, Row } from "@/components/ui/Card";
import { Pill, StatusPill } from "@/components/ui/Pill";
import { CardSkeleton, Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatUsd } from "@/lib/money";

export default function Styleguide() {
  return (
    <main className="mx-auto max-w-app space-y-10 px-5 py-10">
      <header>
        <p className="text-[11px] uppercase tracking-[0.16em] text-faint">Design system</p>
        <h1 className="mt-2 text-[34px] font-semibold tracking-tightest">After dark</h1>
      </header>

      <section className="space-y-3">
        <h2 className="text-[13px] uppercase tracking-[0.12em] text-muted">Buttons</h2>
        <div className="grid gap-3">
          <Button full>Claim it</Button>
          <Button variant="letgo" full>
            Let it go
          </Button>
          <Button variant="ghost" full>
            Swap instead
          </Button>
          <div className="flex gap-2">
            <Button size="md" variant="primary">
              Pay $84
            </Button>
            <Button size="md" variant="quiet">
              Cancel
            </Button>
            <Button size="sm" variant="danger">
              Remove
            </Button>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-[13px] uppercase tracking-[0.12em] text-muted">Cards and pills</h2>
        <Card>
          <Row>
            <span className="text-[15px]">Sat, Nov 21 · 7:00 PM</span>
            <Pill tone="coral">Concert</Pill>
          </Row>
          <Row>
            <span className="text-[15px] text-muted">Amount</span>
            <span className="num text-[15px] font-semibold">{formatUsd(8400)}</span>
          </Row>
        </Card>
        <div className="flex flex-wrap gap-2">
          <Pill>Demo listing</Pill>
          <Pill tone="slate">Transferable</Pill>
          <Pill tone="mint">Paid</Pill>
          <StatusPill status="handed_over" />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-[13px] uppercase tracking-[0.12em] text-muted">Numbers</h2>
        <div className="flex items-baseline gap-4">
          <span className="num text-[44px] font-semibold tracking-tightest">$1,280.00</span>
          <span className="text-[15px] text-muted">balance</span>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-[13px] uppercase tracking-[0.12em] text-muted">Loading</h2>
        <CardSkeleton />
        <Skeleton className="h-12 w-full" />
      </section>

      <section>
        <EmptyState title="You've seen everything." body="New drops soon." action={<Button variant="ghost">Refresh</Button>} />
      </section>
    </main>
  );
}
