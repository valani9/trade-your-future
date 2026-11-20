import { HttpError } from "@/lib/config";

export type ParsedPlan = {
  title: string;
  venue: string;
  city: string;
  category: "concert" | "sports" | "restaurant" | "hotel" | "class" | "experience" | "flight";
  startsAt: Date;
  endsAt: Date;
  faceValueCents: number;
  timeZone: string;
};

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8,
  september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

const CITIES: Array<[RegExp, string, string]> = [
  [/\baustin\b/i, "Austin", "America/Chicago"],
  [/\bnew york\b|\bnyc\b|\bbrooklyn\b|\bmanhattan\b/i, "New York", "America/New_York"],
  [/\bsan francisco\b|\bsf\b/i, "San Francisco", "America/Los_Angeles"],
  [/\bboston\b|\bcambridge\b/i, "Boston", "America/New_York"],
  [/\bchicago\b/i, "Chicago", "America/Chicago"],
  [/\blos angeles\b|\bla\b/i, "Los Angeles", "America/Los_Angeles"],
  [/\bseattle\b/i, "Seattle", "America/Los_Angeles"],
];

function parseDate(text: string, now: Date): { date: Date; hasTime: boolean } | null {
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?/);
  if (iso) {
    const date = new Date(
      Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), Number(iso[4] ?? 19) - 6, Number(iso[5] ?? 0)),
    );
    return { date, hasTime: Boolean(iso[4]) };
  }
  const numeric = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/);
  if (numeric) {
    const year = numeric[3].length === 2 ? 2000 + Number(numeric[3]) : Number(numeric[3]);
    const date = new Date(Date.UTC(year, Number(numeric[1]) - 1, Number(numeric[2]), 13));
    return { date, hasTime: false };
  }
  const monthFirst = text.match(
    /\b(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?/i,
  );
  if (monthFirst) {
    const month = MONTHS[monthFirst[1].toLowerCase()];
    const day = Number(monthFirst[2]);
    const year = monthFirst[3] ? Number(monthFirst[3]) : now.getUTCFullYear();
    let date = new Date(Date.UTC(year, month, day, 13));
    if (!monthFirst[3] && date.getTime() < now.getTime() - 7 * 86_400_000) {
      date = new Date(Date.UTC(year + 1, month, day, 13));
    }
    return { date, hasTime: false };
  }
  return null;
}

function parseTime(text: string): { hours: number; minutes: number } | null {
  const twelve = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (twelve) {
    let hours = Number(twelve[1]) % 12;
    if (twelve[3].toLowerCase() === "pm") hours += 12;
    return { hours, minutes: Number(twelve[2] ?? 0) };
  }
  const twentyFour = text.match(/\b(\d{1,2}):(\d{2})\b(?!\s*\$)/);
  if (twentyFour) {
    const hours = Number(twentyFour[1]);
    if (hours > 23) return null;
    return { hours, minutes: Number(twentyFour[2]) };
  }
  return null;
}

function categoryOf(text: string): ParsedPlan["category"] {
  if (/\b(flight|airline|boarding|depart|terminal|airways|united|delta|jetblue|american airlines)\b/i.test(text)) return "flight";
  if (/\b(hotel|check-in|check in|checkin|your stay|nights? at|resort)\b/i.test(text)) return "hotel";
  if (/\b(reservation|table for|dinner|brunch|lunch|restaurant|omakase|tasting)\b/i.test(text)) return "restaurant";
  if (/\b(class|workshop|lesson|cooking|pottery|seminar)\b/i.test(text)) return "class";
  if (/\b(vs\.?|game|stadium|arena|match|playoff)\b/i.test(text)) return "sports";
  if (/\b(concert|tour|live|music|festival|show|theater|theatre|comedy)\b/i.test(text)) return "concert";
  return "experience";
}

function durationMinutes(category: ParsedPlan["category"]): number {
  switch (category) {
    case "restaurant":
      return 120;
    case "hotel":
      return 600;
    case "flight":
      return 240;
    case "class":
      return 120;
    case "sports":
      return 170;
    case "concert":
      return 180;
    default:
      return 120;
  }
}

export function parseConfirmation(text: string, now = new Date()): ParsedPlan {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length < 6) throw new HttpError(422, "Paste a bit more of the confirmation email.", "unparseable");

  const found = parseDate(clean, now);
  if (!found) throw new HttpError(422, "Couldn't find a date in there. Try adding something like Nov 21, 7:00 PM.", "no_date");

  const time = parseTime(clean);
  const cityMatch = CITIES.find(([pattern]) => pattern.test(clean));
  const timeZone = cityMatch?.[2] ?? "America/Chicago";

  const offset = timeZone === "America/Los_Angeles" ? 8 : timeZone === "America/Chicago" ? 6 : 5;
  const startsAt = new Date(found.date.getTime());
  startsAt.setUTCHours((time?.hours ?? 19) + offset, time?.minutes ?? 0, 0, 0);

  if (startsAt.getTime() < now.getTime() - 3_600_000) {
    throw new HttpError(422, "That one already happened.", "in_the_past");
  }

  const category = categoryOf(clean);
  const priceMatch = clean.match(/\$\s?([\d,]+(?:\.\d{2})?)/);
  const faceValueCents = priceMatch ? Math.round(Number(priceMatch[1].replace(/,/g, "")) * 100) : 0;

  const venueMatch =
    clean.match(/\bat\s+([A-Z][\w'&.\- ]{2,40}?)(?:,|\s+on\s+|\s+in\s+|\.\s|$)/) ??
    clean.match(/\bvenue:?\s*([\w'&.\- ]{2,40}?)(?:,|\.|$)/i);
  const titleMatch =
    clean.match(/(?:order for|reservation(?: confirmed)?:?|you'?re going to|confirmed:?|tickets? (?:to|for))\s+([\w'&.\- ]{3,50}?)(?:\s+at\s+|\s*,|\s+on\s+|\.|$)/i) ??
    clean.match(/^\s*([\w'&.\- ]{3,50}?)(?:\s+at\s+|,)/);

  const venue = venueMatch?.[1]?.trim() ?? "Venue to confirm";
  const title = (titleMatch?.[1]?.trim() || venue).replace(/\s+/g, " ");
  const city = cityMatch?.[1] ?? "Austin";

  return {
    title: title.slice(0, 80),
    venue: venue.slice(0, 80),
    city,
    category,
    startsAt,
    endsAt: new Date(startsAt.getTime() + durationMinutes(category) * 60_000),
    faceValueCents,
    timeZone,
  };
}
