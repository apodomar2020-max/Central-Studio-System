-- Migration 0079: Finance Phase 2A DB foundation — dark payment_refunds
-- register.
--
-- Creates only the payment_refunds table and its open-refund partial unique
-- index. No payment_events, no refund routes, no refund UI, no payout logic,
-- and no writer exist yet — this table is dark, mirroring payment_records'
-- own foundation-first approach (0078_payment_records_foundation.sql).
--
-- payment_record_id uses ON DELETE RESTRICT, matching payment_records'
-- own RESTRICT convention for referenced financial rows: a payment_records
-- row that has ever had a refund attached can never be deleted out from
-- under its refund history (and, per 0078, payment_records itself has no
-- delete path today regardless).

CREATE TABLE payment_refunds (
  id                       serial PRIMARY KEY,

  payment_record_id        integer NOT NULL REFERENCES payment_records(id) ON DELETE RESTRICT,

  status                   text NOT NULL DEFAULT 'underReview',

  requested_amount_minor   integer NOT NULL,
  approved_amount_minor    integer,
  refunded_amount_minor    integer,

  refund_method             text NOT NULL,
  requested_reason          text NOT NULL,

  requested_by_admin_id     integer REFERENCES system_users(id) ON DELETE SET NULL,
  reviewed_by_admin_id      integer REFERENCES system_users(id) ON DELETE SET NULL,
  processed_by_admin_id     integer REFERENCES system_users(id) ON DELETE SET NULL,

  transaction_reference     text,
  admin_notes                text,
  failed_reason               text,

  reviewed_at                 timestamptz,
  processed_at                 timestamptz,

  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),

  -- ── Vocabularies ─────────────────────────────────────────────────────
  CONSTRAINT payment_refunds_status_check
    CHECK (status IN ('underReview', 'approved', 'rejected', 'processing', 'refunded', 'failed')),
  CONSTRAINT payment_refunds_refund_method_check
    CHECK (refund_method IN ('cash', 'original_payment_method')),

  -- ── Amount rules ─────────────────────────────────────────────────────
  CONSTRAINT payment_refunds_requested_positive_check
    CHECK (requested_amount_minor > 0),
  CONSTRAINT payment_refunds_approved_positive_check
    CHECK (approved_amount_minor IS NULL OR approved_amount_minor > 0),
  CONSTRAINT payment_refunds_approved_lte_requested_check
    CHECK (approved_amount_minor IS NULL OR approved_amount_minor <= requested_amount_minor),
  CONSTRAINT payment_refunds_refunded_positive_check
    CHECK (refunded_amount_minor IS NULL OR refunded_amount_minor > 0),
  CONSTRAINT payment_refunds_refunded_requires_approved_check
    CHECK (refunded_amount_minor IS NULL OR approved_amount_minor IS NOT NULL),
  CONSTRAINT payment_refunds_refunded_lte_approved_check
    CHECK (refunded_amount_minor IS NULL OR refunded_amount_minor <= approved_amount_minor),

  -- ── Full status matrix ───────────────────────────────────────────────
  -- requested_amount_minor / requested_reason are NOT NULL columns, so they
  -- are already preserved unconditionally in every status — no per-status
  -- CHECK is needed to restate that.
  CONSTRAINT payment_refunds_status_under_review_check
    CHECK (status <> 'underReview' OR (
      approved_amount_minor IS NULL AND refunded_amount_minor IS NULL
      AND reviewed_by_admin_id IS NULL AND processed_by_admin_id IS NULL
      AND reviewed_at IS NULL AND processed_at IS NULL
      AND failed_reason IS NULL
    )),
  CONSTRAINT payment_refunds_status_approved_check
    CHECK (status <> 'approved' OR (
      approved_amount_minor IS NOT NULL
      AND reviewed_by_admin_id IS NOT NULL AND reviewed_at IS NOT NULL
      AND refunded_amount_minor IS NULL
      AND processed_by_admin_id IS NULL AND processed_at IS NULL
      AND failed_reason IS NULL
    )),
  CONSTRAINT payment_refunds_status_rejected_check
    CHECK (status <> 'rejected' OR (
      reviewed_by_admin_id IS NOT NULL AND reviewed_at IS NOT NULL
      AND approved_amount_minor IS NULL AND refunded_amount_minor IS NULL
      AND processed_by_admin_id IS NULL AND processed_at IS NULL
      AND failed_reason IS NULL
    )),
  CONSTRAINT payment_refunds_status_processing_check
    CHECK (status <> 'processing' OR (
      approved_amount_minor IS NOT NULL
      AND reviewed_by_admin_id IS NOT NULL AND reviewed_at IS NOT NULL
      AND refunded_amount_minor IS NULL
      AND processed_by_admin_id IS NULL AND processed_at IS NULL
      AND failed_reason IS NULL
    )),
  CONSTRAINT payment_refunds_status_refunded_check
    CHECK (status <> 'refunded' OR (
      approved_amount_minor IS NOT NULL AND refunded_amount_minor IS NOT NULL
      AND reviewed_by_admin_id IS NOT NULL AND reviewed_at IS NOT NULL
      AND processed_by_admin_id IS NOT NULL AND processed_at IS NOT NULL
      AND failed_reason IS NULL
      AND refunded_amount_minor <= approved_amount_minor
    )),
  CONSTRAINT payment_refunds_status_failed_check
    CHECK (status <> 'failed' OR (
      approved_amount_minor IS NOT NULL
      AND reviewed_by_admin_id IS NOT NULL AND reviewed_at IS NOT NULL
      AND processed_by_admin_id IS NOT NULL AND processed_at IS NOT NULL
      AND failed_reason IS NOT NULL AND failed_reason !~ '^\s*$'
      AND refunded_amount_minor IS NULL
    ))
);

-- One open refund lifecycle per payment record. Terminal statuses
-- (rejected, refunded, failed) are excluded from the predicate, so a later
-- new refund request against the same payment record is never blocked by a
-- resolved prior one.
CREATE UNIQUE INDEX payment_refunds_open_idx
  ON payment_refunds (payment_record_id)
  WHERE status IN ('underReview', 'approved', 'processing');
