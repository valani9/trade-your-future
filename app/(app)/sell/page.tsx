import { SellDeck } from "@/components/deck/SellDeck";
import { config } from "@/lib/config";
import { appDb } from "@/lib/boot";
import { requireUser } from "@/lib/auth";
import { getMyPlans, groupClashes } from "@/lib/services/plans";

export const dynamic = "force-dynamic";

export default async function SellPage() {
  const session = await requireUser();
  const db = await appDb();
  const items = session ? await getMyPlans(db, session.id).catch(() => null) : null;
  const groups = items
    ? groupClashes(items.map((p) => ({ id: p.id, startsAt: p.startsAt, endsAt: p.endsAt, status: p.status })))
    : null;
  return <SellDeck demoMode={config.demoMode()} initial={items} initialClashes={groups} />;
}
