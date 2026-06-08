CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "search_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(key, '') || ' ' || coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(description_md, ''))) STORED;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "body_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(body_md, ''))) STORED;--> statement-breakpoint
CREATE INDEX "cards_search_tsv_idx" ON "cards" USING gin ("search_tsv");--> statement-breakpoint
CREATE INDEX "comments_body_tsv_idx" ON "comments" USING gin ("body_tsv");--> statement-breakpoint
CREATE INDEX "cards_title_trgm_idx" ON "cards" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "cards_summary_trgm_idx" ON "cards" USING gin ("summary" gin_trgm_ops);
