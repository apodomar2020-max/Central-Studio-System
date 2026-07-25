-- Migration 0078: Finance Phase 2A DB foundation — dark payment_records
-- register and controlled booking-delete source-tombstone protection.
--
-- Creates only the payment_records table itself, its source-integrity guard
-- trigger, and the constraints locking its full status/provenance/amount
-- matrix. Nothing in this repository writes to this table yet — no route,
-- no dual-write, no backfill script. It exists dark so its shape is locked
-- before any writer is built.
--
-- Both source FKs (package_order_id, booking_id) use ON DELETE RESTRICT, not
-- SET NULL: a plain FK cascade cannot be distinguished from an unauthorized
-- direct write once it has already happened, so this schema instead requires
-- every source-clearing UPDATE to go through the guard trigger below, which
-- only permits the one specific transition the controlled booking-delete
-- transaction performs (see bookings.ts's DELETE /bookings/:id handler).

CREATE TABLE payment_records (
  id                         serial PRIMARY KEY,

  flow_type                  text NOT NULL,
  package_order_id           integer REFERENCES package_orders(id) ON DELETE RESTRICT,
  booking_id                 integer REFERENCES bookings(id) ON DELETE RESTRICT,
  source_deleted_at          timestamptz,

  capture_origin              text NOT NULL,
  backfill_batch_id           uuid REFERENCES payment_backfill_batches(id) ON DELETE RESTRICT,
  captured_at                  timestamptz NOT NULL DEFAULT now(),
  occurred_at                  timestamptz NOT NULL,

  evidence_class               text NOT NULL,
  amount_availability           text NOT NULL,
  amount_source                 text NOT NULL,

  gross_amount_minor           integer,
  discount_amount_minor        integer,
  final_payable_amount_minor   integer,
  paid_amount_minor            integer NOT NULL DEFAULT 0,
  refunded_amount_minor        integer NOT NULL DEFAULT 0,
  currency                     text NOT NULL DEFAULT 'EGP',

  requested_payment_channel     text,
  raw_requested_channel         text,
  confirmed_payment_method      text,
  raw_confirmed_method          text,

  status                        text NOT NULL DEFAULT 'unpaid',
  paid_at                       timestamptz,
  confirming_admin_id           integer REFERENCES system_users(id) ON DELETE SET NULL,

  provider_reference            text,
  internal_receipt_ref          text,

  student_id                    integer REFERENCES students(id) ON DELETE SET NULL,
  child_id                      integer REFERENCES children(id) ON DELETE SET NULL,

  creation_idempotency_key      text,

  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),

  -- ── Enum vocabularies ────────────────────────────────────────────────
  CONSTRAINT payment_records_flow_type_check
    CHECK (flow_type IN ('package_purchase', 'single_class_booking', 'studio_walkin')),
  CONSTRAINT payment_records_capture_origin_check
    CHECK (capture_origin IN ('live_capture', 'historical_backfill')),
  CONSTRAINT payment_records_evidence_class_check
    CHECK (evidence_class IN ('confirmed', 'legacy_operational_status', 'unknown')),
  CONSTRAINT payment_records_amount_availability_check
    CHECK (amount_availability IN ('exact', 'estimated_backfill', 'unknown')),
  CONSTRAINT payment_records_amount_source_check
    CHECK (amount_source IN ('creation_snapshot', 'catalog_price_at_backfill_time', 'unresolvable')),
  CONSTRAINT payment_records_requested_channel_check
    CHECK (requested_payment_channel IS NULL OR requested_payment_channel IN
      ('pay_at_studio', 'online', 'internal_credit', 'complimentary', 'unknown')),
  CONSTRAINT payment_records_confirmed_method_check
    CHECK (confirmed_payment_method IS NULL OR confirmed_payment_method IN
      ('cash', 'card', 'kashier', 'bank_transfer', 'unknown')),
  CONSTRAINT payment_records_status_check
    CHECK (status IN (
      'unpaid', 'pending_confirmation', 'paid', 'partially_refunded', 'refunded',
      'waived', 'failed', 'cancelled', 'legacy_unverified'
    )),
  CONSTRAINT payment_records_currency_check
    CHECK (currency = 'EGP'),

  -- ── Source-to-flow-type binding, including the tombstone shape ────────
  CONSTRAINT payment_records_source_fk_matches_flow_type_check
    CHECK (
      (flow_type = 'package_purchase'
        AND package_order_id IS NOT NULL AND booking_id IS NULL AND source_deleted_at IS NULL)
      OR (flow_type IN ('single_class_booking', 'studio_walkin')
        AND booking_id IS NOT NULL AND package_order_id IS NULL AND source_deleted_at IS NULL)
      OR (flow_type IN ('single_class_booking', 'studio_walkin')
        AND package_order_id IS NULL AND booking_id IS NULL AND source_deleted_at IS NOT NULL)
    ),

  -- ── Provenance ─────────────────────────────────────────────────────────
  CONSTRAINT payment_records_live_capture_confirmed_evidence_check
    CHECK (capture_origin <> 'live_capture' OR evidence_class = 'confirmed'),
  CONSTRAINT payment_records_backfill_not_confirmed_check
    CHECK (capture_origin <> 'historical_backfill' OR evidence_class <> 'confirmed'),
  CONSTRAINT payment_records_live_capture_no_batch_check
    CHECK (capture_origin <> 'live_capture' OR backfill_batch_id IS NULL),
  CONSTRAINT payment_records_backfill_requires_batch_check
    CHECK (capture_origin <> 'historical_backfill' OR backfill_batch_id IS NOT NULL),
  CONSTRAINT payment_records_live_capture_exact_check
    CHECK (capture_origin <> 'live_capture' OR amount_availability = 'exact'),
  CONSTRAINT payment_records_live_capture_snapshot_source_check
    CHECK (capture_origin <> 'live_capture' OR amount_source = 'creation_snapshot'),

  -- ── Amount provenance pairing ───────────────────────────────────────────
  CONSTRAINT payment_records_amount_provenance_pairing_check
    CHECK (
      (amount_availability = 'exact' AND amount_source = 'creation_snapshot')
      OR (amount_availability = 'estimated_backfill' AND amount_source = 'catalog_price_at_backfill_time')
      OR (amount_availability = 'unknown' AND amount_source = 'unresolvable')
    ),

  -- ── Amount presence ──────────────────────────────────────────────────────
  CONSTRAINT payment_records_amounts_present_when_known_check
    CHECK (
      amount_availability NOT IN ('exact', 'estimated_backfill')
      OR (gross_amount_minor IS NOT NULL AND discount_amount_minor IS NOT NULL AND final_payable_amount_minor IS NOT NULL)
    ),
  CONSTRAINT payment_records_amounts_null_when_unknown_check
    CHECK (
      amount_availability <> 'unknown'
      OR (gross_amount_minor IS NULL AND discount_amount_minor IS NULL AND final_payable_amount_minor IS NULL)
    ),

  -- ── Arithmetic ─────────────────────────────────────────────────────────
  CONSTRAINT payment_records_gross_non_negative_check
    CHECK (gross_amount_minor IS NULL OR gross_amount_minor >= 0),
  CONSTRAINT payment_records_discount_non_negative_check
    CHECK (discount_amount_minor IS NULL OR discount_amount_minor >= 0),
  CONSTRAINT payment_records_discount_lte_gross_check
    CHECK (discount_amount_minor IS NULL OR gross_amount_minor IS NULL OR discount_amount_minor <= gross_amount_minor),
  CONSTRAINT payment_records_final_payable_arithmetic_check
    CHECK (
      final_payable_amount_minor IS NULL
      OR (gross_amount_minor IS NOT NULL AND discount_amount_minor IS NOT NULL
          AND final_payable_amount_minor = gross_amount_minor - discount_amount_minor)
    ),
  CONSTRAINT payment_records_paid_non_negative_check
    CHECK (paid_amount_minor >= 0),
  CONSTRAINT payment_records_refunded_non_negative_check
    CHECK (refunded_amount_minor >= 0),
  CONSTRAINT payment_records_paid_lte_final_payable_check
    CHECK (final_payable_amount_minor IS NULL OR paid_amount_minor <= final_payable_amount_minor),
  CONSTRAINT payment_records_refunded_lte_paid_check
    CHECK (refunded_amount_minor <= paid_amount_minor),

  -- ── Payment status matrix ────────────────────────────────────────────
  CONSTRAINT payment_records_status_inert_group_check
    CHECK (status NOT IN ('unpaid', 'pending_confirmation', 'failed', 'cancelled') OR (
      paid_amount_minor = 0 AND refunded_amount_minor = 0
      AND paid_at IS NULL AND confirming_admin_id IS NULL AND confirmed_payment_method IS NULL
    )),
  CONSTRAINT payment_records_status_paid_check
    CHECK (status <> 'paid' OR (
      capture_origin = 'live_capture' AND evidence_class = 'confirmed' AND amount_availability = 'exact'
      AND final_payable_amount_minor > 0 AND paid_amount_minor = final_payable_amount_minor
      AND refunded_amount_minor = 0 AND paid_at IS NOT NULL AND confirmed_payment_method IS NOT NULL
    )),
  CONSTRAINT payment_records_status_partially_refunded_check
    CHECK (status <> 'partially_refunded' OR (
      capture_origin = 'live_capture' AND evidence_class = 'confirmed' AND amount_availability = 'exact'
      AND paid_at IS NOT NULL AND confirmed_payment_method IS NOT NULL
      AND paid_amount_minor = final_payable_amount_minor
      AND refunded_amount_minor > 0 AND refunded_amount_minor < paid_amount_minor
    )),
  CONSTRAINT payment_records_status_refunded_check
    CHECK (status <> 'refunded' OR (
      capture_origin = 'live_capture' AND evidence_class = 'confirmed' AND amount_availability = 'exact'
      AND paid_at IS NOT NULL AND confirmed_payment_method IS NOT NULL
      AND paid_amount_minor = final_payable_amount_minor
      AND paid_amount_minor > 0 AND refunded_amount_minor = paid_amount_minor
    )),
  CONSTRAINT payment_records_status_waived_check
    CHECK (status <> 'waived' OR (
      capture_origin = 'live_capture' AND evidence_class = 'confirmed' AND amount_availability = 'exact'
      AND requested_payment_channel = 'complimentary'
      AND gross_amount_minor = discount_amount_minor AND final_payable_amount_minor = 0
      AND paid_amount_minor = 0 AND refunded_amount_minor = 0
      AND paid_at IS NULL AND confirming_admin_id IS NULL AND confirmed_payment_method IS NULL
    )),
  CONSTRAINT payment_records_status_legacy_unverified_check
    CHECK (status <> 'legacy_unverified' OR (
      capture_origin = 'historical_backfill' AND evidence_class = 'legacy_operational_status'
      AND paid_amount_minor = 0 AND refunded_amount_minor = 0
      AND paid_at IS NULL AND confirming_admin_id IS NULL AND confirmed_payment_method IS NULL
      AND amount_availability IN ('estimated_backfill', 'unknown')
    )),
  CONSTRAINT payment_records_backfill_excludes_paid_waived_check
    CHECK (capture_origin <> 'historical_backfill' OR status NOT IN ('paid', 'waived')),
  CONSTRAINT payment_records_paid_waived_require_live_capture_check
    CHECK (status NOT IN ('paid', 'waived') OR capture_origin = 'live_capture'),

  -- ── Unique constraints ────────────────────────────────────────────────
  CONSTRAINT payment_records_flow_package_order_unique
    UNIQUE (flow_type, package_order_id),
  CONSTRAINT payment_records_flow_booking_unique
    UNIQUE (flow_type, booking_id),
  CONSTRAINT payment_records_creation_idempotency_key_unique
    UNIQUE (creation_idempotency_key)
);

CREATE OR REPLACE FUNCTION guard_payment_record_source_integrity()
RETURNS TRIGGER AS $$
DECLARE
  tombstone_authorized boolean;
BEGIN
  tombstone_authorized := COALESCE(
    current_setting('app.allow_payment_source_tombstone', true) = 'on',
    false
  );

  IF TG_OP = 'INSERT' THEN
    -- Exactly one source FK, matching the row's own flow_type — the table
    -- CHECK already enforces this shape declaratively, but the trigger
    -- restates it with a specific error message rather than relying solely
    -- on the CHECK's generic violation text.
    IF NOT (
      (NEW.flow_type = 'package_purchase' AND NEW.package_order_id IS NOT NULL AND NEW.booking_id IS NULL)
      OR (NEW.flow_type IN ('single_class_booking', 'studio_walkin') AND NEW.booking_id IS NOT NULL AND NEW.package_order_id IS NULL)
    ) THEN
      RAISE EXCEPTION 'payment_records insert must set exactly one source FK, matching flow_type (package_purchase -> package_order_id, single_class_booking/studio_walkin -> booking_id)';
    END IF;
    IF NEW.source_deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'payment_records insert must not set source_deleted_at directly';
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.package_order_id IS DISTINCT FROM OLD.package_order_id
       OR NEW.booking_id IS DISTINCT FROM OLD.booking_id
       OR NEW.source_deleted_at IS DISTINCT FROM OLD.source_deleted_at
    THEN
      IF NOT tombstone_authorized THEN
        RAISE EXCEPTION 'payment_records source FK / source_deleted_at may not be changed directly; use the authorized booking-delete tombstone transaction';
      END IF;

      IF NOT (
        OLD.flow_type IN ('single_class_booking', 'studio_walkin')
        AND OLD.package_order_id IS NULL AND NEW.package_order_id IS NULL
        AND OLD.booking_id IS NOT NULL AND NEW.booking_id IS NULL
        AND OLD.source_deleted_at IS NULL AND NEW.source_deleted_at IS NOT NULL
      ) THEN
        RAISE EXCEPTION 'authorized tombstone transition attempted an unsupported shape (expected a booking-sourced flow with booking_id NOT NULL -> NULL, paired with source_deleted_at NULL -> NOT NULL, package_order_id untouched)';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payment_records_a_guard_source_integrity
  BEFORE INSERT OR UPDATE ON payment_records
  FOR EACH ROW
  EXECUTE FUNCTION guard_payment_record_source_integrity();
