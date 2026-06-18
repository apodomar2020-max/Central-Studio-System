ALTER TABLE "schedules" ADD COLUMN IF NOT EXISTS "type" text NOT NULL DEFAULT 'weekly';
ALTER TABLE "schedules" ADD COLUMN IF NOT EXISTS "date" date;
ALTER TABLE "schedules" ADD COLUMN IF NOT EXISTS "price_egp" integer;
ALTER TABLE "schedules" ADD COLUMN IF NOT EXISTS "package_eligible" boolean NOT NULL DEFAULT true;

ALTER TABLE "schedules" ALTER COLUMN "day_of_week" DROP NOT NULL;

UPDATE "schedules"
SET
  "type" = COALESCE(NULLIF("type", ''), 'weekly'),
  "package_eligible" = COALESCE("package_eligible", true),
  "is_recurring" = CASE
    WHEN COALESCE(NULLIF("type", ''), 'weekly') = 'one_time' THEN false
    ELSE "is_recurring"
  END;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'schedules_type_check'
  ) THEN
    ALTER TABLE "schedules"
      ADD CONSTRAINT "schedules_type_check"
      CHECK ("type" IN ('weekly', 'one_time'));
  END IF;
END $$;
