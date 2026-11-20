// Live prediction-market odds for sports plans, read from the public
// Gemini Prediction Markets REST API (no key required).
//
// A ticket to "Celtics vs Knicks" is worth more when the game is a coin flip
// than when it's a blowout. We look up the moneyline market for the matchup
// and surface the implied win probability on the card and in the sell sheet.

const GEMINI_BASE = process.env.GEMINI_PM_BASE ?? "https://api.gemini.com";
const CACHE_MS = 60_000;

export type MarketOdds = {
  source: "gemini";
  eventTitle: string;
  eventTicker: string;
  startsAt: string | null;
  sides: Array<{ name: string; probability: number }>;
  favorite: { name: string; probability: number };
  closeGame: boolean;
  volume: number | null;
  url: string;
};

type GeminiContract = {
  label: string;
  prices?: { bestBid?: string; bestAsk?: string; buy?: { yes?: string }; sell?: { yes?: string } };
};

type GeminiEvent = {
  title: string;
  ticker: string;
  slug?: string;
  startTime?: string;
  volume?: string | number;
  participants?: Array<{ name: string; abbreviation?: string }>;
  sportsMarket?: { type?: string };
  contracts?: GeminiContract[];
};

const cache = new Map<string, { at: number; value: MarketOdds | null }>();

export function splitMatchup(title: string): [string, string] | null {
  const parts = title.split(/\s+(?:vs\.?|v\.?|@|at)\s+/i).map((s) => s.trim()).filter(Boolean);
  if (parts.length !== 2) return null;
  return [parts[0], parts[1]];
}

function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function mentions(event: GeminiEvent, team: string): boolean {
  const t = norm(team);
  if (!t) return false;
  const hay = [event.title, ...(event.participants ?? []).flatMap((p) => [p.name, p.abbreviation ?? ""])]
    .map(norm)
    .join(" | ");
  return hay.split(" | ").some((h) => h === t || h.split(" ").includes(t) || h.includes(t));
}

export function impliedProbability(contract: GeminiContract): number | null {
  const p = contract.prices;
  if (!p) return null;
  const bid = Number(p.bestBid ?? p.sell?.yes);
  const ask = Number(p.bestAsk ?? p.buy?.yes);
  if (Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0) return (bid + ask) / 2;
  if (Number.isFinite(ask) && ask > 0) return ask;
  if (Number.isFinite(bid) && bid > 0) return bid;
  return null;
}

export function pickMoneyline(events: GeminiEvent[], a: string, b: string, startsAt?: Date): GeminiEvent | null {
  const moneylines = events.filter((e) => (e.sportsMarket?.type ?? "moneyline") === "moneyline" && !/:/.test(e.title));
  const both = moneylines.filter((e) => mentions(e, a) && mentions(e, b));
  const pool = both.length ? both : [];
  if (!pool.length) return null;
  if (!startsAt) return pool[0];
  return pool
    .slice()
    .sort(
      (x, y) =>
        Math.abs(new Date(x.startTime ?? 0).getTime() - startsAt.getTime()) -
        Math.abs(new Date(y.startTime ?? 0).getTime() - startsAt.getTime()),
    )[0];
}

/** Contract labels are truncated team names ("Los Angeles L"); say the full name instead. */
export function teamName(label: string, event: GeminiEvent): string {
  const l = norm(label);
  if (!l) return label;
  const match = (event.participants ?? []).find((p) => {
    const n = norm(p.name);
    return n === l || n.startsWith(l) || l.startsWith(n);
  });
  return match?.name ?? label;
}

export function toOdds(event: GeminiEvent): MarketOdds | null {
  const sides = (event.contracts ?? [])
    .map((c) => ({ name: teamName(c.label, event), probability: impliedProbability(c) }))
    .filter((s): s is { name: string; probability: number } => s.probability !== null);
  if (sides.length < 2) return null;
  const total = sides.reduce((sum, s) => sum + s.probability, 0);
  const normalised = sides.map((s) => ({ name: s.name, probability: Math.round((s.probability / total) * 100) / 100 }));
  const favorite = normalised.reduce((best, s) => (s.probability > best.probability ? s : best));
  return {
    source: "gemini",
    eventTitle: event.title,
    eventTicker: event.ticker,
    startsAt: event.startTime ?? null,
    sides: normalised,
    favorite,
    closeGame: favorite.probability <= 0.6,
    volume: event.volume !== undefined ? Number(event.volume) : null,
    url: `https://www.gemini.com/predictions/${event.slug ?? event.ticker}`,
  };
}

export async function oddsForMatchup(
  title: string,
  startsAt?: Date,
  fetchImpl: typeof fetch = fetch,
): Promise<MarketOdds | null> {
  const teams = splitMatchup(title);
  if (!teams) return null;
  const key = `${norm(title)}|${startsAt?.toISOString().slice(0, 10) ?? ""}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  let value: MarketOdds | null = null;
  try {
    const url = new URL("/v1/prediction-markets/events", GEMINI_BASE);
    url.searchParams.set("status", "active");
    url.searchParams.set("category", "Sports");
    url.searchParams.set("limit", "50");
    url.searchParams.set("search", teams[0]);
    const res = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const body = (await res.json()) as { data?: GeminiEvent[] };
      const event = pickMoneyline(body.data ?? [], teams[0], teams[1], startsAt);
      value = event ? toOdds(event) : null;
    }
  } catch {
    value = null;
  }
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Nudges a suggested resale price by how contested the game is. */
export function marketAdjustedPrice(baseCents: number, odds: MarketOdds | null): number {
  if (!odds) return baseCents;
  const factor = odds.favorite.probability <= 0.6 ? 1.08 : odds.favorite.probability >= 0.8 ? 0.95 : 1;
  return Math.max(100, Math.round((baseCents * factor) / 100) * 100);
}
