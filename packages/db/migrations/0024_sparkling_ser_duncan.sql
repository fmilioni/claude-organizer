CREATE TABLE "embedding_runtime" (
	"service" text PRIMARY KEY NOT NULL,
	"model" text,
	"dim" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
