// Ingests QuickNode Streams deliveries for Solana devnet.
//
// The stream is filtered server-side (see docs/quicknode-filter.js) down to
// transactions that carry one of our `tyf:<orderId>:<state>` memos. Each
// delivery is matched back to its order and stored as a `chain.confirmed`
// event with the slot and block time, so the order timeline can show that the
// network finalised each step independently of our own RPC call.

import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { auditEvents, orders } from "@/lib/db/schema";
import { id } from "@/lib/utils";

export type StreamMatch = { orderId: string; state: string; signature: string; slot: number | null; blockTime: number | null };

const MEMO_RE = /tyf:([A-Za-z0-9_-]{6,64}):([a-z_]{3,24})/;

/** Pulls every tyf memo out of a Streams payload, whatever its exact shape. */
export function extractMatches(payload: unknown): StreamMatch[] {
  const out: StreamMatch[] = [];
  const seen = new Set<string>();

  const visitTx = (tx: Record<string, unknown>, slot: number | null, blockTime: number | null) => {
    const sigs = (tx.signatures as string[] | undefined) ?? ((tx.transaction as Record<string, unknown> | undefined)?.signatures as string[] | undefined);
    const signature = (tx.signature as string | undefined) ?? sigs?.[0];
    if (!signature) return;
    const text = JSON.stringify(tx);
    const m = text.match(MEMO_RE);
    if (!m) return;
    const key = `${signature}:${m[1]}:${m[2]}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ orderId: m[1], state: m[2], signature, slot, blockTime });
  };

  const visit = (node: unknown, slot: number | null, blockTime: number | null) => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item, slot, blockTime);
      return;
    }
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    const nextSlot = typeof obj.slot === "number" ? obj.slot : slot;
    const nextTime = typeof obj.blockTime === "number" ? obj.blockTime : blockTime;
    if (obj.signature || obj.signatures || (obj.transaction && typeof obj.transaction === "object")) {
      visitTx(obj, nextSlot, nextTime);
    }
    for (const key of ["data", "matchedTransactions", "transactions", "blocks", "result"]) {
      if (key in obj) visit(obj[key], nextSlot, nextTime);
    }
  };

  visit(payload, null, null);
  return out;
}

/** Records each match once; returns how many were new. */
export async function recordMatches(db: Db, matches: StreamMatch[]): Promise<number> {
  let added = 0;
  for (const match of matches) {
    const exists = await db.select({ id: orders.id }).from(orders).where(eq(orders.id, match.orderId)).limit(1);
    if (!exists[0]) continue;
    const dupe = await db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.orderId, match.orderId),
          eq(auditEvents.type, "chain.confirmed"),
          sql`${auditEvents.payload}->>'signature' = ${match.signature}`,
        ),
      )
      .limit(1);
    if (dupe[0]) continue;
    await db.insert(auditEvents).values({
      id: id(),
      orderId: match.orderId,
      actorId: null,
      type: "chain.confirmed",
      payload: { state: match.state, signature: match.signature, slot: match.slot, blockTime: match.blockTime, source: "quicknode-streams" },
    });
    added++;
  }
  return added;
}

export async function chainConfirmations(db: Db, orderId: string) {
  const rows = await db
    .select({ payload: auditEvents.payload, createdAt: auditEvents.createdAt })
    .from(auditEvents)
    .where(and(eq(auditEvents.orderId, orderId), eq(auditEvents.type, "chain.confirmed")))
    .orderBy(auditEvents.createdAt);
  return rows.map((r) => {
    const p = r.payload as { state: string; signature: string; slot: number | null };
    return { state: p.state, signature: p.signature, slot: p.slot, seenAt: r.createdAt.toISOString() };
  });
}
