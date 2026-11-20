import { BuyDeck } from "@/components/deck/BuyDeck";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

export default function BuyPage() {
  return <BuyDeck demoMode={config.demoMode()} />;
}
