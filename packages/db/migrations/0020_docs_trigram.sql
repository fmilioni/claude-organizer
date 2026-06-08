-- pg_trgm extension is created in 0019; this migration only adds the indexes.
CREATE INDEX "docs_title_trgm_idx" ON "docs" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "docs_summary_trgm_idx" ON "docs" USING gin ("summary" gin_trgm_ops);
