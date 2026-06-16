-- Migration 0009: Ballet Assessment System + Children Profiles
--
-- Creates 7 new tables for the ballet program and parent-child account model.
-- Zero changes to any existing table.
-- All statements are idempotent (IF NOT EXISTS / ON CONFLICT DO NOTHING).
-- FKs use ON DELETE CASCADE/SET NULL as documented per-column.

-- ---------------------------------------------------------------------------
-- 1. children — child profiles owned by a parent student account
-- ---------------------------------------------------------------------------
-- ON DELETE CASCADE: if the parent account is deleted, their children are also
-- removed. A child has no independent identity outside a parent account.

CREATE TABLE IF NOT EXISTS "children" (
  "id"              serial PRIMARY KEY,
  "parent_id"       integer NOT NULL REFERENCES "students"("id") ON DELETE CASCADE,
  "full_name"       text NOT NULL,
  "birthday"        text,
  "age"             integer,
  "gender"          text NOT NULL DEFAULT 'female',
  "medical_notes"   text,
  "emergency_name"  text,
  "emergency_phone" text,
  "qr_token"        uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  "created_at"      timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"      timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "children_parent_id_idx"
  ON "children" ("parent_id");

-- ---------------------------------------------------------------------------
-- 2. ballet_settings — single-row config managed by admin
-- ---------------------------------------------------------------------------
-- Holds pricing, hours, instructions, and UI copy for the ballet programme.
-- Mobile reads this via GET /api/ballet/settings (no auth required).

CREATE TABLE IF NOT EXISTS "ballet_settings" (
  "id"                          serial PRIMARY KEY,
  "pre_ballet_price_egp"        integer NOT NULL DEFAULT 1950,
  "pre_ballet_hours_monthly"    integer NOT NULL DEFAULT 8,
  "levels_price_egp"            integer NOT NULL DEFAULT 2650,
  "levels_hours_monthly"        integer NOT NULL DEFAULT 12,
  "few_seats_threshold"         integer NOT NULL DEFAULT 3,
  "assessment_instructions"     text,
  "requirements"                text,
  "acceptance_message_template" text,
  "updated_at"                  timestamp with time zone DEFAULT now() NOT NULL
);

-- Seed the single default settings row. ON CONFLICT ensures re-running the
-- migration does not create duplicate rows.
INSERT INTO "ballet_settings" (
  "id",
  "pre_ballet_price_egp",
  "pre_ballet_hours_monthly",
  "levels_price_egp",
  "levels_hours_monthly",
  "few_seats_threshold"
) VALUES (
  1, 1950, 8, 2650, 12, 3
)
ON CONFLICT ("id") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. ballet_levels — ordered list of levels (admin-managed)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "ballet_levels" (
  "id"         serial PRIMARY KEY,
  "name"       text NOT NULL UNIQUE,
  "sort_order" integer NOT NULL DEFAULT 0,
  "is_active"  boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Seed default 10 levels. ON CONFLICT on the UNIQUE name column ensures
-- re-running the migration does not duplicate rows.
INSERT INTO "ballet_levels" ("name", "sort_order") VALUES
  ('Pre-Ballet',     0),
  ('Ballet Level 1', 1),
  ('Ballet Level 2', 2),
  ('Ballet Level 3', 3),
  ('Ballet Level 4', 4),
  ('Ballet Level 5', 5),
  ('Ballet Level 6', 6),
  ('Ballet Level 7', 7),
  ('Ballet Level 8', 8),
  ('Ballet Level 9', 9)
ON CONFLICT ("name") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. ballet_assessment_slots — appointment slots created by admin
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "ballet_assessment_slots" (
  "id"         serial PRIMARY KEY,
  "date"       text NOT NULL,       -- ISO date, e.g. "2026-07-05"
  "start_time" text NOT NULL,       -- e.g. "10:00 AM"
  "end_time"   text NOT NULL,       -- e.g. "10:30 AM"
  "capacity"   integer NOT NULL DEFAULT 10,
  "notes"      text,
  "is_active"  boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- ---------------------------------------------------------------------------
-- 5. ballet_applications — form submission from mobile
-- ---------------------------------------------------------------------------
-- parent_student_id is nullable: walk-in or phone submissions may not have
-- an app account. The slot_label denormalises the slot's display string so
-- historical records remain legible if the slot is later edited or disabled.

CREATE TABLE IF NOT EXISTS "ballet_applications" (
  "id"                      serial PRIMARY KEY,
  "parent_student_id"       integer REFERENCES "students"("id") ON DELETE SET NULL,
  "parent_name"             text NOT NULL,
  "parent_phone"            text NOT NULL,
  "parent_email"            text NOT NULL,
  "child_name"              text NOT NULL,
  "child_birthday"          text,
  "child_age"               integer,
  "child_gender"            text,
  "emergency_contact_name"  text,
  "emergency_contact_phone" text,
  "previous_experience"     boolean NOT NULL DEFAULT false,
  "experience_details"      text,
  "medical_notes"           text,
  "notes"                   text,
  "slot_id"                 integer REFERENCES "ballet_assessment_slots"("id") ON DELETE SET NULL,
  "slot_label"              text,
  -- Status values: submitted | pendingAssessment | accepted | rejected
  --                needsFollowUp | assignedToLevel | activeBallet
  "status"                  text NOT NULL DEFAULT 'submitted',
  "admin_notes"             text,
  "assigned_level_id"       integer REFERENCES "ballet_levels"("id") ON DELETE SET NULL,
  "assigned_at"             timestamp with time zone,
  "child_id"                integer REFERENCES "children"("id") ON DELETE SET NULL,
  "created_at"              timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"              timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "ballet_applications_status_idx"
  ON "ballet_applications" ("status");
CREATE INDEX IF NOT EXISTS "ballet_applications_email_idx"
  ON "ballet_applications" ("parent_email");
CREATE INDEX IF NOT EXISTS "ballet_applications_slot_idx"
  ON "ballet_applications" ("slot_id");

-- ---------------------------------------------------------------------------
-- 6. ballet_application_events — status change audit trail
-- ---------------------------------------------------------------------------
-- Every status transition writes a row here. from_status is NULL for the
-- initial "submitted" event. changed_by_id links to the admin user who made
-- the change (SET NULL if that admin account is later deleted).

CREATE TABLE IF NOT EXISTS "ballet_application_events" (
  "id"             serial PRIMARY KEY,
  "application_id" integer NOT NULL REFERENCES "ballet_applications"("id") ON DELETE CASCADE,
  "from_status"    text,
  "to_status"      text NOT NULL,
  "changed_by_id"  integer REFERENCES "system_users"("id") ON DELETE SET NULL,
  "note"           text,
  "created_at"     timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "ballet_application_events_app_idx"
  ON "ballet_application_events" ("application_id");

-- ---------------------------------------------------------------------------
-- 7. ballet_level_assignments — active enrollment records
-- ---------------------------------------------------------------------------
-- ON DELETE RESTRICT on level_id: you must first move enrolled children off a
-- level before you can delete the level. This prevents silent data loss.
-- ON DELETE CASCADE on application_id: removing an application removes its
-- enrollment (appropriate since the application is the authoritative record).

CREATE TABLE IF NOT EXISTS "ballet_level_assignments" (
  "id"             serial PRIMARY KEY,
  "application_id" integer NOT NULL REFERENCES "ballet_applications"("id") ON DELETE CASCADE,
  "child_id"       integer REFERENCES "children"("id") ON DELETE SET NULL,
  "level_id"       integer NOT NULL REFERENCES "ballet_levels"("id") ON DELETE RESTRICT,
  "enrolled_at"    timestamp with time zone DEFAULT now() NOT NULL,
  "billing_start"  text,    -- billing month, e.g. "2026-08"
  "status"         text NOT NULL DEFAULT 'active',
  "notes"          text,
  "created_at"     timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"     timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "ballet_level_assignments_child_idx"
  ON "ballet_level_assignments" ("child_id");
CREATE INDEX IF NOT EXISTS "ballet_level_assignments_level_idx"
  ON "ballet_level_assignments" ("level_id");
