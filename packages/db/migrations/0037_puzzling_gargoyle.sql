ALTER TABLE "cards" ADD COLUMN "done_at" timestamp with time zone;--> statement-breakpoint
-- Backfill historical done cards: updated_at is the best available approximation
-- of when they completed (there was no transition timestamp before this column).
UPDATE "cards" SET "done_at" = "updated_at" WHERE "status" = 'done';
