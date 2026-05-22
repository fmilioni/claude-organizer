CREATE TABLE "card_commits" (
	"id" text PRIMARY KEY NOT NULL,
	"card_id" text NOT NULL,
	"sha" text NOT NULL,
	"message" text NOT NULL,
	"stat" text,
	"diff" text,
	"committed_at" timestamp with time zone,
	"author_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "card_commits" ADD CONSTRAINT "card_commits_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "card_commits_card_sha_uk" ON "card_commits" USING btree ("card_id","sha");--> statement-breakpoint
CREATE INDEX "card_commits_committed_idx" ON "card_commits" USING btree ("committed_at");