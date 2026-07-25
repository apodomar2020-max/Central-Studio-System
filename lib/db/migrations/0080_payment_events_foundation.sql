-- Migration 0080: Finance Phase 2A DB foundation — dark append-only
-- payment_events ledger, plus the minimum supporting composite-FK target on
-- payment_refunds.
--
-- Creates only the ledger table itself, its append-only protection, and its
-- two idempotency indexes. No payment/refund routes, no live event writer,
-- no dual-write, and no backfill execution exist yet — this table is dark,
-- mirroring payment_records' and payment_refunds' own foundation-first
-- approach.
--
-- payment_events.payment_refund_id alone cannot guarantee it belongs to the
-- SAME payment_record_id the event itself references — a plain single-column
-- FK to payment_refunds(id) would happily accept a refund row belonging to a
-- different payment record entirely. The composite FK below closes that gap
-- by referencing (id, payment_record_id) together, which requires
-- payment_refunds to expose that exact pair as a UNIQUE target first (step 1).

-- 1. Supporting composite-FK target on payment_refunds. Logically redundant
--    with the existing `id` primary key alone, but PostgreSQL requires the
--    referenced column set of a composite FK to be covered by a UNIQUE (or
--    PRIMARY KEY) constraint on exactly that column list.
ALTER TABLE payment_refunds
  ADD CONSTRAINT payment_refunds_id_payment_record_unique
  UNIQUE (id, payment_record_id);

-- 2. The append-only ledger.
CREATE TABLE payment_events (
  id                    serial PRIMARY KEY,

  payment_record_id     integer NOT NULL REFERENCES payment_records(id) ON DELETE RESTRICT,

  payment_refund_id     integer,

  event_type             text NOT NULL,
  amount_minor            integer,
  previous_status          text,
  new_status                text NOT NULL,

  credit_transaction_id     integer REFERENCES credit_transactions(id) ON DELETE RESTRICT,

  actor_admin_id             integer REFERENCES system_users(id) ON DELETE SET NULL,
  actor_type                   text NOT NULL DEFAULT 'admin',
  reason                        text,
  provider_reference            text,
  ip_address                     text,
  user_agent                      text,

  idempotency_key                  text,

  created_at                        timestamptz NOT NULL DEFAULT now(),

  -- ── Composite refund/payment integrity ──────────────────────────────────
  -- Guarantees payment_refund_id, when non-null, belongs to THIS row's own
  -- payment_record_id, not merely to some payment_records row. A null
  -- payment_refund_id trivially satisfies any FK (NULL never violates a FK
  -- in PostgreSQL), so this constraint imposes no requirement on non-refund
  -- events — it only ever constrains rows where payment_refund_id is set.
  CONSTRAINT payment_events_refund_payment_fk
    FOREIGN KEY (payment_refund_id, payment_record_id)
    REFERENCES payment_refunds (id, payment_record_id)
    ON DELETE RESTRICT,

  -- ── Vocabularies ─────────────────────────────────────────────────────
  CONSTRAINT payment_events_event_type_check
    CHECK (event_type IN (
      'created', 'created_and_confirmed', 'confirmed', 'method_changed',
      'activation_credits_issued', 'waived', 'failed', 'cancelled', 'voided',
      'refund_payout_completed'
    )),
  CONSTRAINT payment_events_actor_type_check
    CHECK (actor_type IN ('admin', 'system', 'student')),
  CONSTRAINT payment_events_previous_status_check
    CHECK (previous_status IS NULL OR previous_status IN (
      'unpaid', 'pending_confirmation', 'paid', 'partially_refunded', 'refunded',
      'waived', 'failed', 'cancelled', 'legacy_unverified'
    )),
  CONSTRAINT payment_events_new_status_check
    CHECK (new_status IN (
      'unpaid', 'pending_confirmation', 'paid', 'partially_refunded', 'refunded',
      'waived', 'failed', 'cancelled', 'legacy_unverified'
    )),
  CONSTRAINT payment_events_amount_non_negative_check
    CHECK (amount_minor IS NULL OR amount_minor >= 0),

  -- ── Reference exclusivity ────────────────────────────────────────────
  CONSTRAINT payment_events_credit_transaction_exclusive_check
    CHECK (
      (event_type = 'activation_credits_issued' AND credit_transaction_id IS NOT NULL)
      OR (event_type <> 'activation_credits_issued' AND credit_transaction_id IS NULL)
    ),
  CONSTRAINT payment_events_refund_reference_exclusive_check
    CHECK (
      (event_type = 'refund_payout_completed' AND payment_refund_id IS NOT NULL)
      OR (event_type <> 'refund_payout_completed' AND payment_refund_id IS NULL)
    ),

  -- ── Full event-shape matrix ──────────────────────────────────────────
  CONSTRAINT payment_events_created_shape_check
    CHECK (event_type <> 'created' OR (
      previous_status IS NULL AND amount_minor IS NULL
      AND new_status IN ('unpaid', 'pending_confirmation')
    )),
  CONSTRAINT payment_events_created_and_confirmed_shape_check
    CHECK (event_type <> 'created_and_confirmed' OR (
      previous_status IS NULL AND amount_minor IS NOT NULL AND amount_minor > 0 AND new_status = 'paid'
    )),
  CONSTRAINT payment_events_confirmed_shape_check
    CHECK (event_type <> 'confirmed' OR (
      previous_status IN ('unpaid', 'pending_confirmation', 'failed')
      AND amount_minor IS NOT NULL AND amount_minor > 0 AND new_status = 'paid'
    )),
  CONSTRAINT payment_events_method_changed_shape_check
    CHECK (event_type <> 'method_changed' OR (
      previous_status IS NOT NULL AND previous_status = new_status
      AND amount_minor IS NULL
    )),
  CONSTRAINT payment_events_activation_credits_issued_shape_check
    CHECK (event_type <> 'activation_credits_issued' OR (
      previous_status = 'paid' AND new_status = 'paid' AND amount_minor IS NULL
    )),
  CONSTRAINT payment_events_waived_shape_check
    CHECK (event_type <> 'waived' OR (
      previous_status IS NULL AND amount_minor IS NOT NULL AND amount_minor = 0 AND new_status = 'waived'
    )),
  CONSTRAINT payment_events_failed_shape_check
    CHECK (event_type <> 'failed' OR (
      previous_status IN ('unpaid', 'pending_confirmation')
      AND amount_minor IS NULL AND new_status = 'failed'
    )),
  CONSTRAINT payment_events_cancelled_shape_check
    CHECK (event_type <> 'cancelled' OR (
      previous_status IN ('unpaid', 'pending_confirmation', 'failed')
      AND amount_minor IS NULL AND new_status = 'cancelled'
    )),
  CONSTRAINT payment_events_voided_shape_check
    CHECK (event_type <> 'voided' OR (
      previous_status IN ('unpaid', 'pending_confirmation', 'failed', 'waived')
      AND amount_minor IS NULL AND new_status = 'cancelled'
    )),
  CONSTRAINT payment_events_refund_payout_completed_shape_check
    CHECK (event_type <> 'refund_payout_completed' OR (
      previous_status IN ('paid', 'partially_refunded')
      AND amount_minor IS NOT NULL AND amount_minor > 0 AND new_status IN ('partially_refunded', 'refunded')
    ))
);

-- 3. Append-only enforcement function.
CREATE OR REPLACE FUNCTION reject_payment_events_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'payment_events is append-only: % is not permitted (row id=%)', TG_OP, OLD.id
    USING ERRCODE = 'raise_exception';
END;
$$ LANGUAGE plpgsql;

-- 4. Append-only trigger.
CREATE TRIGGER payment_events_append_only
  BEFORE UPDATE OR DELETE ON payment_events
  FOR EACH ROW
  EXECUTE FUNCTION reject_payment_events_mutation();

-- 5. Event-idempotency partial index.
CREATE UNIQUE INDEX payment_events_idempotency_key_idx
  ON payment_events (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 6. Provider-reference partial index (a replayed webhook attempting to
--    insert a second event of the SAME type with the SAME provider
--    reference collides here; the same provider reference may legitimately
--    appear under a different event type, e.g. `confirmed` and a later
--    `refund_payout_completed` sharing one payment-processor transaction id).
CREATE UNIQUE INDEX payment_events_provider_reference_idx
  ON payment_events (event_type, provider_reference)
  WHERE provider_reference IS NOT NULL;
