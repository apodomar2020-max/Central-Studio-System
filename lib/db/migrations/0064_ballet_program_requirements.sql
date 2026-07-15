-- Migration 0064: Ballet Program Requirements
-- Admin-managed sections and ordered items for the mobile Ballet Requirements page.

CREATE TABLE IF NOT EXISTS "ballet_program_requirement_sections" (
  "id" serial PRIMARY KEY NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ballet_program_requirement_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "section_id" integer NOT NULL,
  "text" text NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ballet_program_requirement_items_section_id_ballet_program_requirement_sections_id_fk"
    FOREIGN KEY ("section_id") REFERENCES "public"."ballet_program_requirement_sections"("id")
    ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ballet_program_requirement_sections_order_idx"
  ON "ballet_program_requirement_sections" ("is_active", "sort_order", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ballet_program_requirement_items_section_order_idx"
  ON "ballet_program_requirement_items" ("section_id", "is_active", "sort_order", "id");
