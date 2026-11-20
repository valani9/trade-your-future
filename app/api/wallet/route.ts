import { handle, json } from "@/lib/api/helpers";
import { solana } from "@/lib/solana";
import { getWalletSecret } from "@/lib/auth/users";
import { baseUnitsToCents, formatUsd } from "@/lib/money";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handle(request, async ({ userId }) => {
    const wallet = await getWalletSecret(userId);
    const baseUnits = await solana().balance(wallet.pubkey);
    const cents = baseUnitsToCents(baseUnits);
    return json({ balanceCents: cents, balanceLabel: formatUsd(cents), demo: config.demoMode() });
  });
}
