CREATE TABLE "card_claims" (
	"card_id" text PRIMARY KEY NOT NULL,
	"owner_token" text NOT NULL,
	"owner_label" text,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "card_claims" ADD CONSTRAINT "card_claims_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;