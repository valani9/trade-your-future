import { SellDeck } from "@/components/deck/SellDeck";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

export default function SellPage() {
  return <SellDeck demoMode={config.demoMode()} />;
}
