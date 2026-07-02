-- Promotion Engine Phase 1: additive promotion foundation.
-- Legacy offers remain untouched.

CREATE TABLE IF NOT EXISTS "promotions" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "type" text DEFAULT 'automatic' NOT NULL,
  "discount_type" text DEFAULT 'percentage' NOT NULL,
  "discount_value" double precision DEFAULT 0 NOT NULL,
  "priority" integer DEFAULT 0 NOT NULL,
  "is_exclusive" boolean DEFAULT false NOT NULL,
  "is_stackable" boolean DEFAULT false NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "start_date" timestamp with time zone,
  "end_date" timestamp with time zone,
  "rules_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "promotions_type_idx" ON "promotions" ("type");
CREATE INDEX IF NOT EXISTS "promotions_is_active_idx" ON "promotions" ("is_active");
CREATE INDEX IF NOT EXISTS "promotions_priority_idx" ON "promotions" ("priority");

CREATE TABLE IF NOT EXISTS "promotion_codes" (
  "id" serial PRIMARY KEY NOT NULL,
  "promotion_id" integer NOT NULL REFERENCES "promotions"("id") ON DELETE CASCADE,
  "code" text NOT NULL,
  "max_uses" integer,
  "uses_per_user" integer,
  "current_uses" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "promotion_codes_code_unique" ON "promotion_codes" ("code");
CREATE INDEX IF NOT EXISTS "promotion_codes_promotion_id_idx" ON "promotion_codes" ("promotion_id");

CREATE TABLE IF NOT EXISTS "promotion_redemptions" (
  "id" serial PRIMARY KEY NOT NULL,
  "promotion_id" integer NOT NULL REFERENCES "promotions"("id") ON DELETE RESTRICT,
  "promotion_code_id" integer REFERENCES "promotion_codes"("id") ON DELETE SET NULL,
  "student_id" integer NOT NULL REFERENCES "students"("id") ON DELETE RESTRICT,
  "booking_id" integer REFERENCES "bookings"("id") ON DELETE SET NULL,
  "package_order_id" integer REFERENCES "package_orders"("id") ON DELETE SET NULL,
  "discount_amount" double precision DEFAULT 0 NOT NULL,
  "original_subtotal" double precision DEFAULT 0 NOT NULL,
  "final_subtotal" double precision DEFAULT 0 NOT NULL,
  "redeemed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "metadata" jsonb
);

CREATE INDEX IF NOT EXISTS "promotion_redemptions_student_id_idx" ON "promotion_redemptions" ("student_id");
CREATE INDEX IF NOT EXISTS "promotion_redemptions_promotion_id_idx" ON "promotion_redemptions" ("promotion_id");
CREATE INDEX IF NOT EXISTS "promotion_redemptions_promotion_code_id_idx" ON "promotion_redemptions" ("promotion_code_id");
CREATE INDEX IF NOT EXISTS "promotion_redemptions_package_order_id_idx" ON "promotion_redemptions" ("package_order_id");
CREATE INDEX IF NOT EXISTS "promotion_redemptions_booking_id_idx" ON "promotion_redemptions" ("booking_id");

CREATE TABLE IF NOT EXISTS "promotion_audit_logs" (
  "id" serial PRIMARY KEY NOT NULL,
  "promotion_id" integer REFERENCES "promotions"("id") ON DELETE SET NULL,
  "actor_admin_id" integer,
  "action" text NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "promotion_audit_logs_promotion_id_idx" ON "promotion_audit_logs" ("promotion_id");
CREATE INDEX IF NOT EXISTS "promotion_audit_logs_action_idx" ON "promotion_audit_logs" ("action");
