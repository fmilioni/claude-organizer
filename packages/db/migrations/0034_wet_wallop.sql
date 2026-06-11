CREATE TABLE "card_chunks" (
	"card_id" text NOT NULL,
	"idx" integer NOT NULL,
	"embedding" vector(384) NOT NULL,
	CONSTRAINT "card_chunks_card_id_idx_pk" PRIMARY KEY("card_id","idx")
);
--> statement-breakpoint
CREATE TABLE "comment_chunks" (
	"comment_id" text NOT NULL,
	"idx" integer NOT NULL,
	"embedding" vector(384) NOT NULL,
	CONSTRAINT "comment_chunks_comment_id_idx_pk" PRIMARY KEY("comment_id","idx")
);
--> statement-breakpoint
CREATE TABLE "doc_chunks" (
	"doc_id" text NOT NULL,
	"idx" integer NOT NULL,
	"embedding" vector(384) NOT NULL,
	CONSTRAINT "doc_chunks_doc_id_idx_pk" PRIMARY KEY("doc_id","idx")
);
--> statement-breakpoint
ALTER TABLE "card_chunks" ADD CONSTRAINT "card_chunks_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_chunks" ADD CONSTRAINT "comment_chunks_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_chunks" ADD CONSTRAINT "doc_chunks_doc_id_docs_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."docs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_chunks_card_idx" ON "card_chunks" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX "comment_chunks_comment_idx" ON "comment_chunks" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX "doc_chunks_doc_idx" ON "doc_chunks" USING btree ("doc_id");--> statement-breakpoint
-- Per-chunk semantic search (CO-317): HNSW cosine indexes on the chunk vectors.
-- Hand-added (drizzle doesn't emit them), so they stay out of the snapshot and
-- never show as drift on `db:generate` — same pattern as the base columns (0022).
-- The vector(384) is the baseline (default model); `reconcileEmbeddingDim`
-- reconciles to the configured model's dimension at migrate.
CREATE INDEX "doc_chunks_embedding_idx" ON "doc_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "card_chunks_embedding_idx" ON "card_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "comment_chunks_embedding_idx" ON "comment_chunks" USING hnsw ("embedding" vector_cosine_ops);