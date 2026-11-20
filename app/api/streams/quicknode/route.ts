import crypto from "node:crypto";
import { json, fail, payloadTooLarge } from "@/lib/api/helpers";
import { appDb } from "@/lib/boot";
import { extractMatches, recordMatches, verifyOnChain } from "@/lib/services/streams";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function authorised(request: Request, raw: string): boolean {
  const token = process.env.QUICKNODE_STREAM_TOKEN;
  if (!token) return false;
  // A shared secret sent as a custom header on the stream's destination.
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (bearer && safeEqual(bearer, token)) return true;
  // QuickNode also signs deliveries with the stream's security token:
  // HMAC-SHA256(token, nonce + timestamp + body), hex, in x-qn-signature.
  const nonce = request.headers.get("x-qn-nonce");
  const timestamp = request.headers.get("x-qn-timestamp");
  const signature = request.headers.get("x-qn-signature");
  if (nonce && timestamp && signature) {
    const expected = crypto.createHmac("sha256", token).update(nonce + timestamp + raw).digest("hex");
    return safeEqual(expected, signature);
  }
  return false;
}

export async function POST(request: Request) {
  const tooLarge = payloadTooLarge(request, 2_000_000);
  if (tooLarge) return tooLarge;
  const raw = await request.text();
  const signed = authorised(request, raw);
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return fail(400, "Expected JSON", "invalid_input");
  }
  const extracted = extractMatches(payload);
  // Unsigned deliveries are accepted only for what the chain itself confirms.
  const matches = signed ? extracted : await verifyOnChain(extracted);
  if (!signed && extracted.length > 0 && matches.length === 0) return fail(401, "Bad stream signature", "unauthorized");
  const db = await appDb();
  const added = await recordMatches(db, matches);
  return json({ received: matches.length, recorded: added });
}
