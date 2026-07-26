-- Migration 0082: Finance Phase 2D-2 — batch lifecycle, evidence binding, and
-- per-source progress identity.
--
-- payment_backfill_batches (Phase 2A, migration 0077) only ever anticipated a
-- single "running -> completed|failed|rolled_back" execution lifecycle, with
-- no representation for the dry-run/approval/pause workflow this phase adds,
-- and no columns to bind an approval to the exact dry-run evidence it was
-- granted against. payment_backfill_progress's grain (one row per
-- (batch, source_family) pair, aggregate counters only) cannot represent a
-- per-source-record status — a genuinely different shape, not an enum
-- widening — so a new table is added for it instead of repurposing the
-- existing aggregate-progress table, which is left untouched and reserved
-- for whatever the eventual Phase 2D-3 writer wants from it.
--
-- No code in this repository may yet set a payment_backfill_progress_items
-- row to 'succeeded' for a Finance write — no writer exists. This migration
-- adds only control/state-tracking columns and constraints; it creates no
-- Finance rows and runs no data backfill.

-- 1. Widen payment_backfill_batches.status to the full Phase 2D-2 lifecycle.
ALTER TABLE payment_backfill_batches
  DROP CONSTRAINT payment_backfill_batches_status_check;

ALTER TABLE payment_backfill_batches
  ADD CONSTRAINT payment_backfill_batches_status_check
  CHECK (status IN (
    'created', 'dry_run_completed', 'approved', 'running', 'paused',
    'cancelled', 'completed', 'failed', 'rolled_back'
  ));

ALTER TABLE payment_backfill_batches
  ALTER COLUMN status SET DEFAULT 'created';

-- 2. Evidence-binding and scope columns. Nullable at the DB layer (populated
--    progressively through the lifecycle); the service layer enforces which
--    fields must be present at each transition, mirroring how
--    financeBackfillDryRun.ts's own filters are validated in application code
--    rather than only in SQL.
ALTER TABLE payment_backfill_batches
  ADD COLUMN classifier_version text,
  ADD COLUMN report_schema_version text,
  ADD COLUMN filters jsonb,
  ADD COLUMN max_rows integer,
  ADD COLUMN batch_size integer,
  ADD COLUMN evidence_fingerprint text,
  ADD COLUMN evidence_aggregate jsonb,
  ADD COLUMN expected_eligible_count integer,
  ADD COLUMN max_execution_count integer,
  ADD COLUMN approved_by text,
  ADD COLUMN approved_at timestamptz,
  ADD COLUMN paused_at timestamptz,
  ADD COLUMN cancelled_by text,
  ADD COLUMN cancelled_at timestamptz;

ALTER TABLE payment_backfill_batches
  ADD CONSTRAINT payment_backfill_batches_max_rows_positive_check
    CHECK (max_rows IS NULL OR max_rows > 0),
  ADD CONSTRAINT payment_backfill_batches_batch_size_positive_check
    CHECK (batch_size IS NULL OR batch_size > 0),
  ADD CONSTRAINT payment_backfill_batches_expected_eligible_count_non_negative_check
    CHECK (expected_eligible_count IS NULL OR expected_eligible_count >= 0),
  ADD CONSTRAINT payment_backfill_batches_max_execution_count_non_negative_check
    CHECK (max_execution_count IS NULL OR max_execution_count >= 0),
  -- dry_run_completed onward must carry the evidence that was bound.
  -- 'cancelled' is also exempt: a batch may be cancelled before evidence was
  -- ever attached (created -> cancelled), so cancellation cannot require
  -- evidence that was never produced.
  ADD CONSTRAINT payment_backfill_batches_evidence_bound_check
    CHECK (
      status IN ('created', 'cancelled')
      OR (
        classifier_version IS NOT NULL
        AND report_schema_version IS NOT NULL
        AND filters IS NOT NULL
        AND max_rows IS NOT NULL
        AND batch_size IS NOT NULL
        AND evidence_fingerprint IS NOT NULL
      )
    ),
  -- approved onward must carry approval attribution and the explicit counts
  -- the operator approved against. 'cancelled' is also exempt for the same
  -- reason as above — a batch may be cancelled before it was ever approved.
  ADD CONSTRAINT payment_backfill_batches_approval_bound_check
    CHECK (
      status IN ('created', 'dry_run_completed', 'cancelled')
      OR (
        approved_by IS NOT NULL
        AND approved_at IS NOT NULL
        AND expected_eligible_count IS NOT NULL
        AND max_execution_count IS NOT NULL
      )
    ),
  ADD CONSTRAINT payment_backfill_batches_paused_shape_check
    CHECK (status <> 'paused' OR paused_at IS NOT NULL),
  ADD CONSTRAINT payment_backfill_batches_cancelled_shape_check
    CHECK (status <> 'cancelled' OR (cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL));

-- 3. Only one non-terminal batch per equivalent scope (source families +
--    filters + expected classifier/commit). Enforced as a partial unique
--    index over a stable hash of the scope, so "equivalent scope" doesn't
--    require comparing raw jsonb for equality in every query.
ALTER TABLE payment_backfill_batches
  ADD COLUMN scope_key text;

CREATE UNIQUE INDEX payment_backfill_batches_active_scope_unique
  ON payment_backfill_batches (scope_key)
  WHERE status IN ('created', 'dry_run_completed', 'approved', 'running', 'paused');

-- 4. Per-source progress identity. A genuinely different grain from
--    payment_backfill_progress (Phase 2A) — one row per individual source
--    record, not per (batch, source_family) aggregate — so it is a new
--    table, not an alteration of the existing one.
CREATE TABLE payment_backfill_progress_items (
  id serial PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES payment_backfill_batches(id) ON DELETE RESTRICT,

  source_family text NOT NULL,
  source_id integer NOT NULL,

  classifier_version text NOT NULL,
  code_commit text NOT NULL,

  classification_code text NOT NULL,
  eligibility text NOT NULL,

  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error_code text,
  last_safe_cursor integer,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT payment_backfill_progress_items_unique
    UNIQUE (batch_id, source_family, source_id),

  CONSTRAINT payment_backfill_progress_items_source_family_check
    CHECK (source_family IN ('package_orders', 'bookings', 'studio_walkins')),

  CONSTRAINT payment_backfill_progress_items_status_check
    CHECK (status IN (
      'pending', 'already_canonical', 'manual_review', 'excluded', 'corrupt',
      'eligible_not_executed', 'processing', 'succeeded', 'failed', 'cancelled'
    )),

  CONSTRAINT payment_backfill_progress_items_attempts_non_negative_check
    CHECK (attempts >= 0),
  CONSTRAINT payment_backfill_progress_items_source_id_non_negative_check
    CHECK (source_id >= 0),

  -- No writer exists in Phase 2D-2 — a row can never legitimately reach
  -- 'succeeded' or 'processing' yet.
  CONSTRAINT payment_backfill_progress_items_no_writer_yet_check
    CHECK (status NOT IN ('succeeded', 'processing')),

  CONSTRAINT payment_backfill_progress_items_failed_shape_check
    CHECK (status <> 'failed' OR last_error_code IS NOT NULL)
);

CREATE INDEX payment_backfill_progress_items_batch_id_idx
  ON payment_backfill_progress_items (batch_id);
