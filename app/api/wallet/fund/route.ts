import { handle, json } from "@/lib/api/helpers";
import { solana } from "@/lib/solana";
import { config } from "@/lib/config";
import { getWalletSecret } from "@/lib/auth/users";
import { HttpError } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handle(request, async ({ userId }) => {
    if (!config.demoMode()) throw new HttpError(403, "Only available in the demo", "demo_only");
    const wallet = await getWalletSecret(userId);
    const signature = await solana().airdropTokens(wallet.pubkey, 100n * 10_000_000n);
    return json({ ok: true, addedCents: 10_000, signature });
  });
}
