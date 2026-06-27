ALTER TABLE schedules
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

UPDATE schedules
SET status = 'active'
WHERE status IS NULL OR status = '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'schedules_status_check'
  ) THEN
    ALTER TABLE schedules
      ADD CONSTRAINT schedules_status_check
      CHECK (status IN ('active', 'completed', 'expired', 'cancelled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS schedules_status_idx ON schedules(status);
