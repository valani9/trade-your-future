type Bucket = { tokens: number; updatedAt: number };

const buckets = new Map<string, Bucket>();
const WINDOW_MS = 60_000;

export function rateLimit(key: string, limit = 60): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { tokens: limit, updatedAt: now };
  const refill = ((now - bucket.updatedAt) / WINDOW_MS) * limit;
  const tokens = Math.min(limit, bucket.tokens + refill);

  if (tokens < 1) {
    buckets.set(key, { tokens, updatedAt: now });
    return { ok: false, retryAfter: Math.ceil(((1 - tokens) / limit) * 60) };
  }
  buckets.set(key, { tokens: tokens - 1, updatedAt: now });
  if (buckets.size > 5_000) {
    for (const [k, v] of buckets) if (now - v.updatedAt > WINDOW_MS * 5) buckets.delete(k);
  }
  return { ok: true, retryAfter: 0 };
}

export function resetRateLimits() {
  buckets.clear();
}
