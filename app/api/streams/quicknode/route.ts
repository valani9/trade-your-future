import crypto from "node:crypto";
import { json, fail } from "@/lib/api/helpers";
import { appDb } from "@/lib/boot";
import { extractMatches, recordMatches } from "@/lib/services/streams";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorised(request: Request, raw: string): boolean {
  const token = process.env.QUICKNODE_STREAM_TOKEN;
  if (!token) return false;
  // QuickNode signs deliveries with the stream's security token:
  // HMAC-SHA256(token, nonce + timestamp + body), hex, in x-qn-signature.
  const nonce = request.headers.get("x-qn-nonce");
  const timestamp = request.headers.get("x-qn-timestamp");
  const signature = request.headers.get("x-qn-signature");
  if (nonce && timestamp && signature) {
    const expected = crypto.createHmac("sha256", token).update(nonce + timestamp + raw).digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  // Fallback for a custom header set on the destination.
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return bearer === token;
}

export async function POST(request: Request) {
  const raw = await request.text();
  if (!authorised(request, raw)) return fail(401, "Bad stream signature", "unauthorized");
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return fail(400, "Expected JSON", "invalid_input");
  }
  const matches = extractMatches(payload);
  const db = await appDb();
  const added = await recordMatches(db, matches);
  return json({ received: matches.length, recorded: added });
}
