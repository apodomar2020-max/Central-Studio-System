-- Infrastructure Hardening Phase B: async job status foundation.
-- Existing sync report endpoints remain unchanged.

CREATE TABLE IF NOT EXISTS "report_jobs" (
  "id" serial PRIMARY KEY NOT NULL,
  "entity" text NOT NULL,
  "format" text DEFAULT 'json' NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "filters" jsonb,
  "result_url" text,
  "error_message" text,
  "requested_by_admin_id" integer REFERENCES "system_users"("id") ON DELETE SET NULL,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "report_jobs_status_idx" ON "report_jobs" ("status");
CREATE INDEX IF NOT EXISTS "report_jobs_entity_idx" ON "report_jobs" ("entity");
CREATE INDEX IF NOT EXISTS "report_jobs_requested_by_admin_id_idx" ON "report_jobs" ("requested_by_admin_id");
