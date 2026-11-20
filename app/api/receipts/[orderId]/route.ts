import { handle, json } from "@/lib/api/helpers";
import { getOrder, orderMemos } from "@/lib/services/orders";
import { solana } from "@/lib/solana";
import { ESCROW_PUBKEY } from "@/lib/solana";
import { config } from "@/lib/config";
import { chainConfirmations } from "@/lib/services/streams";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await context.params;
  return handle(request, async ({ userId, db }) => {
    const order = await getOrder(db, userId, orderId);
    const cluster = "devnet";
    const link = (sig: string | null) =>
      sig ? `https://explorer.solana.com/tx/${sig}?cluster=${cluster}` : null;
    return json({
      orderId: order.id,
      amountCents: order.amountCents,
      feeCents: order.feeCents,
      netCents: order.netCents,
      status: order.status,
      cluster,
      escrowAddress: ESCROW_PUBKEY(),
      mintAddress: config.mint() || null,
      funded: { signature: order.fundTx, explorer: link(order.fundTx) },
      released: { signature: order.releaseTx, explorer: link(order.releaseTx) },
      refunded: { signature: order.refundTx, explorer: link(order.refundTx) },
      memo: { signature: order.memoTx, explorer: link(order.memoTx) },
      memos: (await orderMemos(db, orderId, userId)).map((entry) => ({
        memo: entry.memo,
        signature: entry.signature,
        explorer: link(entry.signature),
      })),
      confirmations: (await chainConfirmations(db, orderId)).map((c) => ({ ...c, explorer: link(c.signature) })),
      simulated: solana().kind === "mock",
    });
  });
}
