DROP INDEX IF EXISTS "listings_one_open_per_plan";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "listings_one_live_per_plan" ON "listings" USING btree ("plan_id") WHERE status in ('open','pending');
