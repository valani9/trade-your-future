import { and, eq, inArray, notInArray } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { listings, plans, users } from "@/lib/db/schema";
import { HttpError } from "@/lib/config";
import { id } from "@/lib/utils";

type CalendarEvent = {
  id: string;
  summary?: string;
  location?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: Array<{ self?: boolean; responseStatus?: string }>;
};

const demoEvents: CalendarEvent[] = [
  {
    id: "demo-cal-1",
    summary: "Longhorns vs Sooners",
    location: "Darrell K Royal Stadium, Austin",
    start: { dateTime: nextIso(11, 19, 0), timeZone: "America/Chicago" },
    end: { dateTime: nextIso(11, 22, 0), timeZone: "America/Chicago" },
  },
  {
    id: "demo-cal-2",
    summary: "Dinner at Uchi",
    location: "Uchi, Austin",
    start: { dateTime: nextIso(6, 20, 0), timeZone: "America/Chicago" },
    end: { dateTime: nextIso(6, 22, 0), timeZone: "America/Chicago" },
  },
  {
    id: "demo-cal-3",
    summary: "Wheel-throwing workshop",
    location: "Clay Room, San Francisco",
    start: { dateTime: nextIso(18, 18, 0), timeZone: "America/Los_Angeles" },
    end: { dateTime: nextIso(18, 20, 0), timeZone: "America/Los_Angeles" },
  },
];

function nextIso(days: number, hourUtc: number, minute: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hourUtc, minute, 0, 0);
  return d.toISOString();
}

function classify(summary: string, location: string) {
  const text = `${summary} ${location}`;
  if (/\b(vs\.?|game|stadium|arena|match)\b/i.test(text)) return "sports" as const;
  if (/\b(dinner|reservation|lunch|brunch|restaurant|table)\b/i.test(text)) return "restaurant" as const;
  if (/\b(hotel|check-?in|stay)\b/i.test(text)) return "hotel" as const;
  if (/\b(class|workshop|lesson|cooking|pottery)\b/i.test(text)) return "class" as const;
  if (/\b(flight|boarding|airline|terminal)\b/i.test(text)) return "flight" as const;
  if (/\b(concert|live|tour|show|festival|comedy|theater)\b/i.test(text)) return "concert" as const;
  return "experience" as const;
}

function cityOf(location: string): { city: string; timeZone: string } {
  if (/new york|nyc|brooklyn/i.test(location)) return { city: "New York", timeZone: "America/New_York" };
  if (/san francisco|oakland|sf/i.test(location)) return { city: "San Francisco", timeZone: "America/Los_Angeles" };
  if (/boston/i.test(location)) return { city: "Boston", timeZone: "America/New_York" };
  return { city: "Austin", timeZone: "America/Chicago" };
}

async function refreshToken(db: Db, userId: string, row: { googleRefreshToken: string | null }) {
  if (!row.googleRefreshToken) return null;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      refresh_token: row.googleRefreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) return null;
  await db
    .update(users)
    .set({
      googleAccessToken: data.access_token,
      googleExpiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000),
    })
    .where(eq(users.id, userId));
  return data.access_token;
}

export async function fetchCalendarEvents(
  db: Db,
  userId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CalendarEvent[]> {
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = rows[0];
  if (!user) throw new HttpError(404, "Not found", "not_found");

  let token = user.googleAccessToken;
  const expired = !user.googleExpiresAt || user.googleExpiresAt.getTime() < Date.now() + 60_000;
  if ((!token || expired) && user.googleRefreshToken) token = await refreshToken(db, userId, user);
  if (!token && process.env.DEMO_MODE !== "false") return demoEvents;
  if (!token) throw new HttpError(409, "Reconnect Google to pull your calendar", "reconnect_google");

  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + 60 * 86_400_000).toISOString();
  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.searchParams.set("timeMin", timeMin);
  url.searchParams.set("timeMax", timeMax);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "250");

  const res = await fetchImpl(url.toString(), { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 401) throw new HttpError(409, "Reconnect Google to pull your calendar", "reconnect_google");
  if (!res.ok) throw new HttpError(502, "Calendar is having a moment. Try again.", "calendar_error");
  const data = (await res.json()) as { items?: CalendarEvent[] };
  return data.items ?? [];
}

export async function syncCalendar(db: Db, userId: string, fetchImpl: typeof fetch = fetch) {
  const events = await fetchCalendarEvents(db, userId, fetchImpl);
  const seen: string[] = [];
  let imported = 0;

  for (const event of events) {
    if (!event.start?.dateTime || !event.end?.dateTime) continue;
    const me = event.attendees?.find((a) => a.self);
    if (me?.responseStatus === "declined") continue;
    const startsAt = new Date(event.start.dateTime);
    if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() < Date.now() - 86_400_000) continue;
    const endsAt = new Date(event.end.dateTime);
    const location = event.location ?? "";
    const { city, timeZone } = cityOf(location);
    const externalId = `gcal:${event.id}`;
    seen.push(externalId);

    const existing = await db
      .select({ id: plans.id, status: plans.status })
      .from(plans)
      .where(and(eq(plans.userId, userId), eq(plans.source, "calendar"), eq(plans.externalId, externalId)))
      .limit(1);

    const values = {
      category: classify(event.summary ?? "", location),
      title: (event.summary ?? "Calendar event").slice(0, 120),
      venue: (location.split(",")[0] || "To confirm").slice(0, 120),
      city,
      timeZone: event.start.timeZone ?? timeZone,
      startsAt,
      endsAt: endsAt > startsAt ? endsAt : new Date(startsAt.getTime() + 7_200_000),
      source: "calendar" as const,
      externalId,
      status: "active" as const,
    };

    if (existing[0]) {
      if (existing[0].status !== "sold" && existing[0].status !== "swapped") {
        await db.update(plans).set(values).where(eq(plans.id, existing[0].id));
        imported++;
      }
    } else {
      await db.insert(plans).values({ id: id(), userId, transferability: "transferable", ...values });
      imported++;
    }
  }

  if (seen.length) {
    const gone = await db
      .select({ id: plans.id })
      .from(plans)
      .where(
        and(
          eq(plans.userId, userId),
          eq(plans.source, "calendar"),
          eq(plans.status, "active"),
          notInArray(plans.externalId, seen),
        ),
      );
    for (const row of gone) {
      await db.update(plans).set({ status: "expired" }).where(eq(plans.id, row.id));
      await db
        .update(listings)
        .set({ status: "cancelled" })
        .where(and(eq(listings.planId, row.id), inArray(listings.status, ["open", "pending"])));
    }
  }

  return { imported, scanned: events.length };
}
