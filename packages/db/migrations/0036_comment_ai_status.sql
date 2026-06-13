-- Replace the boolean comments.read_by_ai with a three-state comment_ai_status
-- enum (unread | read | handled). Data-preserving: the old boolean is backfilled
-- (true → 'handled', false → 'unread') before the column is dropped, so no rows
-- lose their AI-read state. The whole enum type is created here, so using its
-- values in the same transaction is allowed (the same-tx restriction only bites
-- ALTER TYPE ... ADD VALUE on a pre-existing enum, not a fresh CREATE TYPE).
CREATE TYPE "public"."comment_ai_status" AS ENUM('unread', 'read', 'handled');--> statement-breakpoint
DROP INDEX "comments_unread_idx";--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "ai_status" "comment_ai_status" DEFAULT 'unread' NOT NULL;--> statement-breakpoint
UPDATE "comments" SET "ai_status" = CASE WHEN "read_by_ai" THEN 'handled'::"public"."comment_ai_status" ELSE 'unread'::"public"."comment_ai_status" END;--> statement-breakpoint
ALTER TABLE "comments" DROP COLUMN "read_by_ai";--> statement-breakpoint
CREATE INDEX "comments_unread_idx" ON "comments" USING btree ("ai_status","author");
