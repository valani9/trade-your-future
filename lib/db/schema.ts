import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const categoryEnum = pgEnum("plan_category", [
  "concert",
  "sports",
  "restaurant",
  "hotel",
  "class",
  "experience",
  "flight",
]);
export const sourceEnum = pgEnum("plan_source", ["calendar", "import", "manual", "seed"]);
export const transferabilityEnum = pgEnum("plan_transferability", [
  "transferable",
  "venue_approval",
  "name_change",
  "non_transferable",
]);
export const planStatusEnum = pgEnum("plan_status", ["active", "listed", "sold", "swapped", "expired"]);
export const listingStatusEnum = pgEnum("listing_status", [
  "open",
  "pending",
  "sold",
  "cancelled",
  "expired",
]);
export const swipeDirectionEnum = pgEnum("swipe_direction", ["left", "right"]);
export const orderStatusEnum = pgEnum("order_status", [
  "created",
  "funded",
  "handed_over",
  "released",
  "refunded",
  "disputed",
  "failed",
]);
export const swapStatusEnum = pgEnum("swap_status", [
  "proposed",
  "accepted",
  "declined",
  "settled",
  "cancelled",
]);

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  image: text("image"),
  isDemo: boolean("is_demo").notNull().default(false),
  walletPubkey: text("wallet_pubkey").notNull(),
  walletSecretEnc: text("wallet_secret_enc").notNull(),
  googleAccessToken: text("google_access_token"),
  googleRefreshToken: text("google_refresh_token"),
  googleExpiresAt: timestamp("google_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const plans = pgTable(
  "plans",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    category: categoryEnum("category").notNull(),
    title: text("title").notNull(),
    venue: text("venue").notNull(),
    city: text("city").notNull(),
    timeZone: text("time_zone").notNull().default("America/Chicago"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    source: sourceEnum("source").notNull(),
    externalId: text("external_id"),
    faceValueCents: integer("face_value_cents").notNull().default(0),
    transferability: transferabilityEnum("transferability").notNull().default("transferable"),
    status: planStatusEnum("status").notNull().default("active"),
    imageUrl: text("image_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("plans_user_source_external_uq").on(t.userId, t.source, t.externalId),
    index("plans_user_starts_idx").on(t.userId, t.startsAt),
    check("plans_face_value_range", sql`${t.faceValueCents} >= 0 AND ${t.faceValueCents} <= 1000000`),
    check("plans_time_order", sql`${t.endsAt} > ${t.startsAt}`),
  ],
);

export const listings = pgTable(
  "listings",
  {
    id: text("id").primaryKey(),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    sellerId: text("seller_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    priceCents: integer("price_cents").notNull(),
    suggestedPriceCents: integer("suggested_price_cents").notNull().default(0),
    status: listingStatusEnum("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("listings_one_live_per_plan").on(t.planId).where(sql`status in ('open', 'pending')`),
    index("listings_feed_idx").on(t.status, t.expiresAt, t.createdAt),
    check("listings_price_range", sql`${t.priceCents} > 0 AND ${t.priceCents} <= 1000000`),
  ],
);

export const swipes = pgTable(
  "swipes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    listingId: text("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    direction: swipeDirectionEnum("direction").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("swipes_user_listing_uq").on(t.userId, t.listingId)],
);

export const orders = pgTable(
  "orders",
  {
    id: text("id").primaryKey(),
    listingId: text("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    buyerId: text("buyer_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sellerId: text("seller_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    amountCents: integer("amount_cents").notNull(),
    feeCents: integer("fee_cents").notNull(),
    status: orderStatusEnum("status").notNull().default("created"),
    fundTx: text("fund_tx"),
    releaseTx: text("release_tx"),
    refundTx: text("refund_tx"),
    memoTx: text("memo_tx"),
    handoverNote: text("handover_note"),
    releaseDueAt: timestamp("release_due_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("orders_one_live_per_listing")
      .on(t.listingId)
      .where(sql`status in ('created','funded','handed_over')`),
    index("orders_buyer_idx").on(t.buyerId, t.createdAt),
    index("orders_seller_idx").on(t.sellerId, t.createdAt),
    check("orders_amount_range", sql`${t.amountCents} > 0 AND ${t.amountCents} <= 1000000`),
    check("orders_fee_range", sql`${t.feeCents} >= 0 AND ${t.feeCents} < ${t.amountCents}`),
  ],
);

export const swaps = pgTable("swaps", {
  id: text("id").primaryKey(),
  offerPlanId: text("offer_plan_id")
    .notNull()
    .references(() => plans.id, { onDelete: "cascade" }),
  wantListingId: text("want_listing_id")
    .notNull()
    .references(() => listings.id, { onDelete: "cascade" }),
  proposerId: text("proposer_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  counterpartyId: text("counterparty_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  diffCents: integer("diff_cents").notNull().default(0),
  status: swapStatusEnum("status").notNull().default("proposed"),
  settleTx: text("settle_tx"),
  orderId: text("order_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditEvents = pgTable("events", {
  id: text("id").primaryKey(),
  orderId: text("order_id"),
  actorId: text("actor_id"),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    statusCode: integer("status_code").notNull(),
    body: jsonb("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("idempotency_user_scope_key_uq").on(t.userId, t.scope, t.key)],
);

export type User = typeof users.$inferSelect;
export type Plan = typeof plans.$inferSelect;
export type Listing = typeof listings.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type Swap = typeof swaps.$inferSelect;
