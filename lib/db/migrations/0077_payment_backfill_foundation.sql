-- Migration 0077: Finance Phase 2A DB foundation — payment backfill batch
-- manifest and per-source-family progress tracking.
--
-- Creates only the backfill execution foundation (batch manifest + progress
-- cursor tables). No payment register tables (payment_records, payment_events,
-- payment_refunds), no dual-write routes, and no execution script exist yet.
-- No code in this repository may mark a payment_backfill_batches row
-- 'completed'/'failed' until the future Phase 2D backfill script exists —
-- see paymentBackfillProgress.ts's module doc for the full reasoning.

CREATE TABLE payment_backfill_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'running',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  rolled_back_at timestamptz,
  created_by text NOT NULL,
  dry_run_summary jsonb,
  source_main_commit text NOT NULL,
  notes text,
  CONSTRAINT payment_backfill_batches_status_check CHECK (status IN ('running','completed','failed','rolled_back')),
  CONSTRAINT payment_backfill_batches_running_shape_check CHECK (status <> 'running' OR (finished_at IS NULL AND rolled_back_at IS NULL)),
  CONSTRAINT payment_backfill_batches_completed_shape_check CHECK (status <> 'completed' OR (finished_at IS NOT NULL AND rolled_back_at IS NULL)),
  CONSTRAINT payment_backfill_batches_failed_shape_check CHECK (status <> 'failed' OR (finished_at IS NOT NULL AND rolled_back_at IS NULL)),
  CONSTRAINT payment_backfill_batches_rolled_back_shape_check CHECK (status <> 'rolled_back' OR (finished_at IS NOT NULL AND rolled_back_at IS NOT NULL AND rolled_back_at >= finished_at)),
  CONSTRAINT payment_backfill_batches_finished_after_started_check CHECK (finished_at IS NULL OR finished_at >= started_at),
  CONSTRAINT payment_backfill_batches_rolled_back_after_started_check CHECK (rolled_back_at IS NULL OR rolled_back_at >= started_at)
);

CREATE TABLE payment_backfill_progress (
  id serial PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES payment_backfill_batches(id) ON DELETE RESTRICT,
  source_family text NOT NULL,
  last_source_id integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running',
  processed_count integer NOT NULL DEFAULT 0,
  inserted_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT payment_backfill_progress_batch_id_source_family_unique UNIQUE (batch_id, source_family),
  CONSTRAINT payment_backfill_progress_source_family_check CHECK (source_family IN ('package_orders','bookings')),
  CONSTRAINT payment_backfill_progress_status_check CHECK (status IN ('running','completed','failed')),
  CONSTRAINT payment_backfill_progress_last_source_id_check CHECK (last_source_id >= 0),
  CONSTRAINT payment_backfill_progress_counts_non_negative_check CHECK (processed_count >= 0 AND inserted_count >= 0 AND skipped_count >= 0 AND failed_count >= 0),
  CONSTRAINT payment_backfill_progress_count_reconciliation_check CHECK (processed_count = inserted_count + skipped_count + failed_count),
  CONSTRAINT payment_backfill_progress_running_shape_check CHECK (status <> 'running' OR finished_at IS NULL),
  CONSTRAINT payment_backfill_progress_completed_shape_check CHECK (status <> 'completed' OR (finished_at IS NOT NULL AND failed_count = 0)),
  CONSTRAINT payment_backfill_progress_failed_shape_check CHECK (status <> 'failed' OR (finished_at IS NOT NULL AND failed_count > 0)),
  CONSTRAINT payment_backfill_progress_finished_after_started_check CHECK (finished_at IS NULL OR finished_at >= started_at)
);
