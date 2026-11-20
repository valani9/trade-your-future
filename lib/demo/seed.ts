import { sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { listings, plans, users } from "@/lib/db/schema";
import { solana } from "@/lib/solana";
import { centsToBaseUnits } from "@/lib/money";
import { id } from "@/lib/utils";
import { DEMO_EMAIL } from "@/lib/auth/users";

export const DEMO_USER_ID = "demo-alex-rivera";

type Category = "concert" | "sports" | "restaurant" | "hotel" | "class" | "experience" | "flight";
type Transfer = "transferable" | "venue_approval" | "name_change" | "non_transferable";

type Template = {
  category: Category;
  titles: string[];
  venues: [string, string, string][];
  image: string;
  price: [number, number];
  durationMin: number;
  transfer: Transfer;
  timeZone: string;
  hours: number[];
};

const CT = "America/Chicago";
const ET = "America/New_York";
const PT = "America/Los_Angeles";

const templates: Template[] = [
  {
    category: "concert",
    titles: ["Maggie Rogers", "Japanese Breakfast", "Smino Live", "Sylvan Esso", "Big Thief", "Faye Webster", "Phoebe Bridgers & Friends", "Men I Trust"],
    venues: [
      ["Stubb's BBQ", "Austin", CT],
      ["Brooklyn Steel", "New York", ET],
      ["The Independent", "San Francisco", PT],
      ["Roadrunner", "Boston", ET],
    ],
    image: "concert-hall",
    price: [6500, 24000],
    durationMin: 180,
    transfer: "transferable",
    timeZone: CT,
    hours: [19, 20, 21],
  },
  {
    category: "sports",
    titles: ["Celtics vs Knicks", "Warriors vs Lakers", "Longhorns vs Sooners", "Red Sox vs Yankees", "Mavericks vs Suns", "Rangers vs Bruins"],
    venues: [
      ["TD Garden", "Boston", ET],
      ["Chase Center", "San Francisco", PT],
      ["Darrell K Royal Stadium", "Austin", CT],
      ["Fenway Park", "Boston", ET],
    ],
    image: "arena-game",
    price: [5500, 32000],
    durationMin: 170,
    transfer: "venue_approval",
    timeZone: ET,
    hours: [19, 20],
  },
  {
    category: "restaurant",
    titles: ["Sushi at Uchi", "Chef's tasting at Atelier", "Bar seats at Le Coucou", "Dinner at March", "Omakase at Sushi Bar"],
    venues: [
      ["Uchi", "Austin", CT],
      ["Atelier Crenn", "San Francisco", PT],
      ["Le Coucou", "New York", ET],
      ["March", "New York", ET],
    ],
    image: "restaurant-table",
    price: [9000, 42000],
    durationMin: 120,
    transfer: "name_change",
    timeZone: ET,
    hours: [19, 20, 21],
  },
  {
    category: "hotel",
    titles: ["Two nights at The Line", "One night at Ace Hotel", "Weekend at Hotel San José", "Night at The Bowery"],
    venues: [
      ["The Line Hotel", "Austin", CT],
      ["Ace Hotel", "Brooklyn", ET],
      ["Hotel San José", "Austin", CT],
      ["The Bowery Hotel", "New York", ET],
    ],
    image: "hotel-room",
    price: [18000, 72000],
    durationMin: 600,
    transfer: "name_change",
    timeZone: ET,
    hours: [15],
  },
  {
    category: "class",
    titles: ["Pasta night with Chef Ada", "Wheel-throwing workshop", "Knife skills class", "Sourdough intensive"],
    venues: [
      ["Salt & Time Kitchen", "Austin", CT],
      ["Clay Room", "San Francisco", PT],
      ["Coastal Kitchen", "Boston", ET],
    ],
    image: "pottery-studio",
    price: [4500, 18000],
    durationMin: 120,
    transfer: "transferable",
    timeZone: CT,
    hours: [18, 19],
  },
  {
    category: "experience",
    titles: ["Rooftop for six", "Karaoke room, two hours", "Stand-up at the Cellar", "Wine flight tasting"],
    venues: [
      ["Zilker Rooftop", "Austin", CT],
      ["The Cellar", "New York", ET],
      ["Barrel House", "San Francisco", PT],
    ],
    image: "rooftop-night",
    price: [3500, 25000],
    durationMin: 120,
    transfer: "transferable",
    timeZone: ET,
    hours: [19, 20, 21],
  },
  {
    category: "flight",
    titles: ["AUS → JFK one way", "SFO → BOS one way", "BOS → AUS round trip", "JFK → SFO one way"],
    venues: [
      ["Austin-Bergstrom", "Austin", CT],
      ["SFO", "San Francisco", PT],
      ["Logan", "Boston", ET],
    ],
    image: "plane-window",
    price: [12000, 58000],
    durationMin: 240,
    transfer: "name_change",
    timeZone: CT,
    hours: [7, 11, 17],
  },
];

const sellers = [
  "Maya Chen",
  "Jordan Ellis",
  "Priya Raman",
  "Diego Alvarez",
  "Nina Okafor",
  "Sam Whitfield",
  "Chloe Park",
  "Marco Bianchi",
  "Tess Nakamura",
  "Rafael Souza",
  "Elena Volkova",
  "Owen Brady",
];

const TZ_OFFSET: Record<string, number> = {
  "America/Chicago": 6,
  "America/New_York": 5,
  "America/Los_Angeles": 8,
};

export function localTime(day: Date, hour: number, minute: number, timeZone: string): Date {
  const offset = TZ_OFFSET[timeZone] ?? 6;
  return new Date(day.getTime() + (hour + offset) * 3_600_000 + minute * 60_000);
}

function startOfDay(base: Date, offsetDays: number): Date {
  const d = new Date(base);
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() + offsetDays * 86_400_000);
}

export function buildFeedRows(now = new Date()) {
  const rows: Array<{
    category: Category;
    title: string;
    venue: string;
    city: string;
    timeZone: string;
    startsAt: Date;
    endsAt: Date;
    faceValueCents: number;
    transferability: Transfer;
    imageUrl: string;
    sellerIndex: number;
  }> = [];
  let seed = 7;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const offsets = [1, 2, 3, 4, 5, 6, 8, 9, 10, 12, 13, 15, 17, 19, 21, 24, 27];
  let count = 0;
  for (let round = 0; round < 4; round++) {
    for (const template of templates) {
      for (let k = 0; k < 3; k++) {
        const venue = template.venues[(count + k) % template.venues.length];
        const title = template.titles[(count + k * 3) % template.titles.length];
        const dayOffset = offsets[(count + k + round) % offsets.length];
        const hour = template.hours[(count + k) % template.hours.length];
        const startDay = startOfDay(now, dayOffset);
        const startsAt = localTime(startDay, hour, 15, venue[2]);
        if (startsAt.getTime() - now.getTime() < 6 * 3_600_000) continue;
        const endsAt = new Date(startsAt.getTime() + template.durationMin * 60_000);
        const span = template.price[1] - template.price[0];
        const faceValueCents = Math.round((template.price[0] + rand() * span) / 100) * 100;
        rows.push({
          category: template.category,
          title,
          venue: venue[0],
          city: venue[1],
          timeZone: venue[2],
          startsAt,
          endsAt,
          faceValueCents,
          transferability: template.transfer,
          imageUrl: `/demo/${template.image}.jpg`,
          sellerIndex: (count + round) % sellers.length,
        });
        count++;
      }
    }
  }
  return rows;
}

export function buildDemoPlans(now = new Date()) {
  const sat = startOfDay(now, (6 - now.getUTCDay() + 7) % 7 || 7);
  const dinner = localTime(sat, 18, 30, CT);
  const concert = localTime(sat, 19, 0, CT);
  return [
    {
      category: "concert" as Category,
      title: "Maggie Rogers",
      venue: "Stubb's BBQ",
      city: "Austin",
      timeZone: CT,
      startsAt: concert,
      endsAt: new Date(concert.getTime() + 180 * 60_000),
      faceValueCents: 9500,
      transferability: "transferable" as Transfer,
      imageUrl: "/demo/concert-hall.jpg",
    },
    {
      category: "restaurant" as Category,
      title: "Chef's tasting at Atelier Crenn",
      venue: "Atelier Crenn",
      city: "Austin",
      timeZone: CT,
      startsAt: dinner,
      endsAt: new Date(dinner.getTime() + 120 * 60_000),
      faceValueCents: 22000,
      transferability: "name_change" as Transfer,
      imageUrl: "/demo/restaurant-table.jpg",
    },
    {
      category: "flight" as Category,
      title: "AUS → JFK one way",
      venue: "Austin-Bergstrom",
      city: "Austin",
      timeZone: CT,
      startsAt: localTime(startOfDay(now, 9), 7, 40, CT),
      endsAt: localTime(startOfDay(now, 9), 11, 40, CT),
      faceValueCents: 31000,
      transferability: "name_change" as Transfer,
      imageUrl: "/demo/plane-window.jpg",
    },
    {
      category: "class" as Category,
      title: "Pasta night with Chef Ada",
      venue: "Salt & Time Kitchen",
      city: "Austin",
      timeZone: CT,
      startsAt: localTime(startOfDay(now, 14), 18, 0, CT),
      endsAt: localTime(startOfDay(now, 14), 20, 0, CT),
      faceValueCents: 6500,
      transferability: "transferable" as Transfer,
      imageUrl: "/demo/pottery-studio.jpg",
    },
  ];
}

export async function seedDemo(db: Db, now = new Date()) {
  const demoRow = await db.select({ id: users.id }).from(users).where(sql`${users.email} = ${DEMO_EMAIL}`).limit(1);
  let demoUserId = demoRow[0]?.id;
  if (!demoUserId) {
    const wallet = solana().createWallet();
    demoUserId = id();
    await db.insert(users).values({
      id: demoUserId,
      email: DEMO_EMAIL,
      name: "Alex Rivera",
      isDemo: true,
      walletPubkey: wallet.pubkey,
      walletSecretEnc: wallet.secretEnc,
    });
  }

  const sellerIds: string[] = [];
  for (const name of sellers) {
    const email = `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@sellers.tyf.app`;
    const found = await db.select({ id: users.id }).from(users).where(sql`${users.email} = ${email}`).limit(1);
    if (found[0]) {
      const wallet = await db.select({ walletPubkey: users.walletPubkey }).from(users).where(sql`${users.email} = ${email}`).limit(1);
      if (wallet[0] && (await solana().balance(wallet[0].walletPubkey)) < centsToBaseUnits(10_000)) {
        await solana().airdropTokens(wallet[0].walletPubkey, centsToBaseUnits(50_000));
      }
      sellerIds.push(found[0].id);
      continue;
    }
    const wallet = solana().createWallet();
    const sid = id();
    await db.insert(users).values({
      id: sid,
      email,
      name,
      isDemo: true,
      walletPubkey: wallet.pubkey,
      walletSecretEnc: wallet.secretEnc,
    });
    await solana().airdropTokens(wallet.pubkey, centsToBaseUnits(50_000));
    sellerIds.push(sid);
  }

  const feed = buildFeedRows(now);
  const listingRows: (typeof listings.$inferInsert)[] = [];
  for (const row of feed) {
    const planId = id();
    const sellerId = sellerIds[row.sellerIndex];
    await db.insert(plans).values({
      id: planId,
      userId: sellerId,
      category: row.category,
      title: row.title,
      venue: row.venue,
      city: row.city,
      timeZone: row.timeZone,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      source: "seed",
      externalId: `${row.title}-${row.venue}-${row.startsAt.toISOString()}`,
      faceValueCents: row.faceValueCents,
      transferability: row.transferability,
      status: "listed",
      imageUrl: row.imageUrl,
    });
    listingRows.push({
      id: id(),
      planId,
      sellerId,
      priceCents: row.faceValueCents,
      suggestedPriceCents: row.faceValueCents,
      status: "open",
      expiresAt: row.startsAt,
    });
  }
  for (let i = 0; i < listingRows.length; i += 20) {
    await db.insert(listings).values(listingRows.slice(i, i + 20));
  }

  for (const plan of buildDemoPlans(now)) {
    await db.insert(plans).values({
      id: id(),
      userId: demoUserId,
      category: plan.category,
      title: plan.title,
      venue: plan.venue,
      city: plan.city,
      timeZone: plan.timeZone,
      startsAt: plan.startsAt,
      endsAt: plan.endsAt,
      source: "seed",
      externalId: `demo-${plan.title}`,
      faceValueCents: plan.faceValueCents,
      transferability: plan.transferability,
      status: "active",
      imageUrl: plan.imageUrl,
    });
  }

  return { demoUserId, listingCount: listingRows.length };
}

export async function ensureSeed(db: Db) {
  const rows = await db.execute<{ count: string }>(sql`select count(*)::text as count from listings`);
  const count = Number((rows as unknown as { rows: Array<{ count: string }> }).rows?.[0]?.count ?? 0);
  if (count > 0) return;
  await seedDemo(db);
}

export async function resetDemo(db: Db) {
  await db.execute(sql`truncate table events, idempotency_keys, swaps, orders, swipes, listings, plans restart identity cascade`);
  await db.execute(sql`delete from users where email <> ${DEMO_EMAIL}`);
  return seedDemo(db);
}
