-- Feedback Phase 1: attendance-linked internal QA feedback.
-- Offline queueing is mobile-only; this table stores only feedback received by
-- the backend.

CREATE TABLE IF NOT EXISTS "feedback" (
  "id" serial PRIMARY KEY,
  "attendance_id" integer NOT NULL,
  "student_id" integer,
  "student_email_snapshot" text NOT NULL,
  "student_name_snapshot" text NOT NULL,
  "child_id" integer,
  "child_name_snapshot" text,
  "booking_id" integer,
  "class_id" integer,
  "class_title_snapshot" text,
  "schedule_id" integer,
  "schedule_snapshot" jsonb,
  "instructor_id" integer,
  "instructor_name_snapshot" text,
  "dance_type_name_snapshot" text,
  "rating" integer NOT NULL,
  "comment" text,
  "tags" text[] NOT NULL DEFAULT '{}',
  "review_status" text NOT NULL DEFAULT 'pending',
  "reviewed_by" integer,
  "reviewed_at" timestamp with time zone,
  "client_submission_id" text NOT NULL,
  "submitted_at" timestamp with time zone,
  "received_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "feedback_attendance_id_attendance_id_fk"
    FOREIGN KEY ("attendance_id") REFERENCES "attendance"("id") ON DELETE RESTRICT,
  CONSTRAINT "feedback_reviewed_by_system_users_id_fk"
    FOREIGN KEY ("reviewed_by") REFERENCES "system_users"("id") ON DELETE SET NULL,
  CONSTRAINT "feedback_rating_check"
    CHECK ("rating" >= 1 AND "rating" <= 5),
  CONSTRAINT "feedback_review_status_check"
    CHECK ("review_status" IN ('pending', 'in_review', 'resolved', 'dismissed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "feedback_attendance_id_unique"
  ON "feedback" ("attendance_id");

CREATE UNIQUE INDEX IF NOT EXISTS "feedback_client_submission_id_unique"
  ON "feedback" ("client_submission_id");

CREATE INDEX IF NOT EXISTS "feedback_student_id_received_at_idx"
  ON "feedback" ("student_id", "received_at" DESC);

CREATE INDEX IF NOT EXISTS "feedback_review_status_received_at_idx"
  ON "feedback" ("review_status", "received_at" DESC);

CREATE INDEX IF NOT EXISTS "feedback_rating_received_at_idx"
  ON "feedback" ("rating", "received_at" DESC);

CREATE INDEX IF NOT EXISTS "feedback_instructor_id_received_at_idx"
  ON "feedback" ("instructor_id", "received_at" DESC);

CREATE INDEX IF NOT EXISTS "feedback_class_id_received_at_idx"
  ON "feedback" ("class_id", "received_at" DESC);
