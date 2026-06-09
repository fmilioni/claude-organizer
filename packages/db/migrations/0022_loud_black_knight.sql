-- Semantic search foundation (CO-241): pgvector extension + embedding columns +
-- HNSW cosine indexes. The CREATE EXTENSION and CREATE INDEX statements are
-- hand-added (drizzle doesn't emit them), so they stay out of the drizzle
-- snapshot and never show as drift on `db:generate`. The vector(384) columns are
-- the baseline (default model `intfloat/multilingual-e5-small`); a different
-- configured model's dimension is reconciled at migrate by `reconcileEmbeddingDim`.
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "embedding" vector(384);--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "embedding" vector(384);--> statement-breakpoint
ALTER TABLE "docs" ADD COLUMN "embedding" vector(384);--> statement-breakpoint
CREATE INDEX "cards_embedding_idx" ON "cards" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "comments_embedding_idx" ON "comments" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "docs_embedding_idx" ON "docs" USING hnsw ("embedding" vector_cosine_ops);
