CREATE TYPE "public"."repo_provider" AS ENUM('github', 'gitlab');--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "repo_provider" "repo_provider";--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "repo_web_url" text;