import { describe, expect, it } from "vitest";
import { marketAdjustedPrice, oddsForMatchup, pickMoneyline, splitMatchup, teamName, toOdds } from "@/lib/services/markets";
import { narrateCard, parseCommand } from "@/lib/services/voice";
import { extractMatches } from "@/lib/services/streams";

const game = {
  title: "Boston vs Sacramento",
  ticker: "NBA-2611220300-BOS-SAC-M",
  slug: "boston-vs-sacramento",
  startTime: "2026-11-22T03:00:00Z",
  sportsMarket: { type: "moneyline" },
  participants: [
    { name: "Sacramento Kings", abbreviation: "SAC" },
    { name: "Boston Celtics", abbreviation: "BOS" },
  ],
  contracts: [
    { label: "Boston", prices: { bestBid: "0.70", bestAsk: "0.72" } },
    { label: "Sacramento", prices: { bestBid: "0.28", bestAsk: "0.30" } },
  ],
};

describe("gemini prediction markets", () => {
  it("splits matchups", () => {
    expect(splitMatchup("Celtics vs Kings")).toEqual(["Celtics", "Kings"]);
    expect(splitMatchup("Sushi at Uchi")).toEqual(["Sushi", "Uchi"]);
    expect(splitMatchup("Maggie Rogers")).toBeNull();
  });

  it("matches a moneyline by team nickname and reads implied odds", () => {
    const event = pickMoneyline([game], "Celtics", "Kings");
    expect(event?.ticker).toBe(game.ticker);
    const odds = toOdds(event!)!;
    expect(odds.favorite.name).toBe("Boston Celtics");
    expect(odds.favorite.probability).toBeCloseTo(0.71, 2);
    expect(odds.closeGame).toBe(false);
  });

  it("spells out a truncated team label and leaves strangers alone", () => {
    expect(teamName("Los Angeles L", game)).toBe("Los Angeles L");
    const lakers = {
      ...game,
      participants: [
        { name: "Los Angeles Lakers", abbreviation: "LAL" },
        { name: "Sacramento Kings", abbreviation: "SAC" },
      ],
    };
    expect(teamName("Los Angeles L", lakers)).toBe("Los Angeles Lakers");
    expect(teamName("Sacramento", lakers)).toBe("Sacramento Kings");
  });

  it("ignores games that don't include both teams", () => {
    expect(pickMoneyline([game], "Celtics", "Knicks")).toBeNull();
  });

  it("raises the suggestion for close games and trims it for blowouts", () => {
    const close = { ...toOdds(game)!, favorite: { name: "x", probability: 0.52 }, closeGame: true };
    const blowout = { ...toOdds(game)!, favorite: { name: "x", probability: 0.85 } };
    expect(marketAdjustedPrice(10_000, close)).toBe(10_800);
    expect(marketAdjustedPrice(10_000, blowout)).toBe(9_500);
    expect(marketAdjustedPrice(10_000, null)).toBe(10_000);
  });

  it("returns null instead of throwing when the API is down", async () => {
    const failing = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await oddsForMatchup("Hawks vs Heat", undefined, failing)).toBeNull();
  });
});

describe("voice", () => {
  it("parses spoken commands", () => {
    expect(parseCommand("yeah claim it")).toBe("claim");
    expect(parseCommand("nah, skip")).toBe("pass");
    expect(parseCommand("wait go back")).toBe("undo");
    expect(parseCommand("what was that")).toBe("repeat");
    expect(parseCommand("hmm")).toBeNull();
  });

  it("narrates a card in plain words", () => {
    const text = narrateCard({
      title: "Celtics vs Kings",
      venue: "TD Garden",
      city: "Boston",
      priceCents: 12_000,
      startsAt: "2026-11-22T00:30:00Z",
      timeZone: "America/New_York",
    });
    expect(text).toContain("Celtics vs Kings");
    expect(text).toContain("120 dollars");
  });
});

describe("quicknode streams", () => {
  it("pulls tyf memos out of a filtered delivery", () => {
    const orderId = "6f1c2d9a-1111-4222-8333-944455556666";
    const payload = {
      matchedTransactions: [
        { signature: "sigA", slot: 123, blockTime: 1, memo: `Program log: Memo (len 50): "tyf:${orderId}:funded"` },
        { signature: "sigB", slot: 124, blockTime: 2, memo: "Program log: unrelated" },
      ],
    };
    expect(extractMatches(payload)).toEqual([
      { orderId, state: "funded", signature: "sigA", slot: 123, blockTime: 1 },
    ]);
  });

  it("reads raw block payloads too", () => {
    const payload = {
      data: [
        {
          slot: 9,
          blockTime: 5,
          transactions: [{ transaction: { signatures: ["sigC"] }, meta: { logMessages: ['Memo "tyf:abcdef12:released"'] } }],
        },
      ],
    };
    expect(extractMatches(payload)[0]).toMatchObject({ orderId: "abcdef12", state: "released", signature: "sigC", slot: 9 });
  });
});
