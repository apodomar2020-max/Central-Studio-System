-- Migration 0065: Ballet FAQs
-- Admin-managed FAQs for the mobile Ballet FAQ page.

CREATE TABLE IF NOT EXISTS "ballet_faqs" (
  "id" serial PRIMARY KEY NOT NULL,
  "question" text NOT NULL,
  "answer" text NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ballet_faqs_order_idx"
  ON "ballet_faqs" ("is_active", "sort_order", "id");
