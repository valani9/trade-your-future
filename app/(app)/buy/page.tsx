import { preload } from "react-dom";
import { BuyDeck } from "@/components/deck/BuyDeck";
import { config } from "@/lib/config";
import { appDb } from "@/lib/boot";
import { requireUser } from "@/lib/auth";
import { getFeed } from "@/lib/services/feed";

export const dynamic = "force-dynamic";

export default async function BuyPage() {
  const session = await requireUser();
  const db = await appDb();
  const first = session ? await getFeed(db, session.id, null).catch(() => null) : null;
  if (first?.items[0]?.imageUrl) preload(first.items[0].imageUrl, { as: "image", fetchPriority: "high" });
  return <BuyDeck demoMode={config.demoMode()} initial={first?.items ?? null} initialCursor={first?.nextCursor ?? null} />;
}
