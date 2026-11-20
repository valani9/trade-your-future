CREATE TYPE "public"."plan_category" AS ENUM('concert', 'sports', 'restaurant', 'hotel', 'class', 'experience', 'flight');--> statement-breakpoint
CREATE TYPE "public"."listing_status" AS ENUM('open', 'pending', 'sold', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('created', 'funded', 'handed_over', 'released', 'refunded', 'disputed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('active', 'listed', 'sold', 'swapped', 'expired');--> statement-breakpoint
CREATE TYPE "public"."plan_source" AS ENUM('calendar', 'import', 'manual', 'seed');--> statement-breakpoint
CREATE TYPE "public"."swap_status" AS ENUM('proposed', 'accepted', 'declined', 'settled', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."swipe_direction" AS ENUM('left', 'right');--> statement-breakpoint
CREATE TYPE "public"."plan_transferability" AS ENUM('transferable', 'venue_approval', 'name_change', 'non_transferable');--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text,
	"actor_id" text,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"status_code" integer NOT NULL,
	"body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"seller_id" text NOT NULL,
	"price_cents" integer NOT NULL,
	"suggested_price_cents" integer DEFAULT 0 NOT NULL,
	"status" "listing_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "listings_price_range" CHECK ("listings"."price_cents" > 0 AND "listings"."price_cents" <= 1000000)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"listing_id" text NOT NULL,
	"buyer_id" text NOT NULL,
	"seller_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"fee_cents" integer NOT NULL,
	"status" "order_status" DEFAULT 'created' NOT NULL,
	"fund_tx" text,
	"release_tx" text,
	"refund_tx" text,
	"memo_tx" text,
	"handover_note" text,
	"release_due_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_amount_range" CHECK ("orders"."amount_cents" > 0 AND "orders"."amount_cents" <= 1000000),
	CONSTRAINT "orders_fee_range" CHECK ("orders"."fee_cents" >= 0 AND "orders"."fee_cents" < "orders"."amount_cents")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"category" "plan_category" NOT NULL,
	"title" text NOT NULL,
	"venue" text NOT NULL,
	"city" text NOT NULL,
	"time_zone" text DEFAULT 'America/Chicago' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"source" "plan_source" NOT NULL,
	"external_id" text,
	"face_value_cents" integer DEFAULT 0 NOT NULL,
	"transferability" "plan_transferability" DEFAULT 'transferable' NOT NULL,
	"status" "plan_status" DEFAULT 'active' NOT NULL,
	"image_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_face_value_range" CHECK ("plans"."face_value_cents" >= 0 AND "plans"."face_value_cents" <= 1000000),
	CONSTRAINT "plans_time_order" CHECK ("plans"."ends_at" > "plans"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "swaps" (
	"id" text PRIMARY KEY NOT NULL,
	"offer_plan_id" text NOT NULL,
	"want_listing_id" text NOT NULL,
	"proposer_id" text NOT NULL,
	"counterparty_id" text NOT NULL,
	"diff_cents" integer DEFAULT 0 NOT NULL,
	"status" "swap_status" DEFAULT 'proposed' NOT NULL,
	"settle_tx" text,
	"order_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "swipes" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"listing_id" text NOT NULL,
	"direction" "swipe_direction" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"image" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"wallet_pubkey" text NOT NULL,
	"wallet_secret_enc" text NOT NULL,
	"google_access_token" text,
	"google_refresh_token" text,
	"google_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swaps" ADD CONSTRAINT "swaps_offer_plan_id_plans_id_fk" FOREIGN KEY ("offer_plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swaps" ADD CONSTRAINT "swaps_want_listing_id_listings_id_fk" FOREIGN KEY ("want_listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swaps" ADD CONSTRAINT "swaps_proposer_id_users_id_fk" FOREIGN KEY ("proposer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swaps" ADD CONSTRAINT "swaps_counterparty_id_users_id_fk" FOREIGN KEY ("counterparty_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swipes" ADD CONSTRAINT "swipes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swipes" ADD CONSTRAINT "swipes_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_user_scope_key_uq" ON "idempotency_keys" USING btree ("user_id","scope","key");--> statement-breakpoint
CREATE UNIQUE INDEX "listings_one_open_per_plan" ON "listings" USING btree ("plan_id") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "listings_feed_idx" ON "listings" USING btree ("status","expires_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_one_live_per_listing" ON "orders" USING btree ("listing_id") WHERE status in ('created','funded','handed_over');--> statement-breakpoint
CREATE INDEX "orders_buyer_idx" ON "orders" USING btree ("buyer_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_seller_idx" ON "orders" USING btree ("seller_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_user_source_external_uq" ON "plans" USING btree ("user_id","source","external_id");--> statement-breakpoint
CREATE INDEX "plans_user_starts_idx" ON "plans" USING btree ("user_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "swipes_user_listing_uq" ON "swipes" USING btree ("user_id","listing_id");