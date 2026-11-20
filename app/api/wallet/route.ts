import { handle, json } from "@/lib/api/helpers";
import { solana } from "@/lib/solana";
import { getWalletSecret } from "@/lib/auth/users";
import { baseUnitsToCents, formatUsd } from "@/lib/money";
import { config } from "@/lib/config";
import { and, eq, inArray, sql } from "drizzle-orm";
import { orders } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handle(request, async ({ userId, db }) => {
    const wallet = await getWalletSecret(userId);
    const baseUnits = await solana().balance(wallet.pubkey);
    const cents = baseUnitsToCents(baseUnits);
    const held = await db
      .select({ total: sql<number>`coalesce(sum(${orders.amountCents}), 0)::int` })
      .from(orders)
      .where(and(eq(orders.buyerId, userId), inArray(orders.status, ["funded", "handed_over", "disputed"])));
    return json({
      balanceCents: cents,
      balanceLabel: formatUsd(cents),
      heldCents: held[0]?.total ?? 0,
      demo: config.demoMode(),
    });
  });
}
