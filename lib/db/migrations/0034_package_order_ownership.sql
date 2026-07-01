-- Membership Engine (Phase 3): give package_orders a real owner FK.
--
-- Schema-only migration — deliberately does NOT backfill existing rows here.
-- Unlike 0023 (booking ownership), Phase 3 requires the backfill to be a
-- separate, explicitly-run, idempotent step — see
-- scripts/src/backfillMembershipIds.ts. Run it manually after this migration:
--
--   DATABASE_URL=... pnpm --filter @workspace/scripts run backfill-membership-ids
--
-- Until backfilled, read paths must match on
-- "student_id = X OR lower(trim(student_email)) = Y", never student_id alone.
ALTER TABLE "package_orders" ADD COLUMN IF NOT EXISTS "student_id" integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'package_orders_student_id_students_id_fk'
  ) THEN
    ALTER TABLE "package_orders"
      ADD CONSTRAINT "package_orders_student_id_students_id_fk"
      FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "package_orders_student_id_created_at_idx"
  ON "package_orders" ("student_id", "created_at" DESC);
