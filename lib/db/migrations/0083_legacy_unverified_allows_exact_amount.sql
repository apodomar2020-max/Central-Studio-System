-- Migration 0083: Finance Phase 2D-3 — allow `legacy_unverified` rows to
-- carry `amount_availability = 'exact'`.
--
-- Schema gap this closes: `payment_records_status_legacy_unverified_check`
-- (migration 0078) requires `amount_availability IN ('estimated_backfill',
-- 'unknown')` — it explicitly FORBIDS 'exact'. That made sense under Phase
-- 2A's original assumption (no writer existed yet, so the exact shape a
-- future writer would need was unconstrained). The Phase 2D-1 classifier's
-- `automatic_exact` eligibility class is specifically about an EXACT
-- source-time amount snapshot (`isExactEvidenceEligible`, amount tier
-- `exact_source_snapshot`/`exact_order_snapshot`/`exact_schedule_snapshot`)
-- — and the Phase 2D-3 writer is only ever authorized to insert a row for
-- an `automatic_exact` classification. Without this migration, the writer
-- could never insert ANY row at all, even one it is explicitly authorized
-- to write, because the DB itself would reject `amount_availability =
-- 'exact'` on a `legacy_unverified` row.
--
-- This does NOT relax any other guarantee:
--   - `payment_records_backfill_excludes_paid_waived_check` still forbids
--     `status IN ('paid','waived')` for `capture_origin = 'historical_backfill'`
--     — a backfilled row can never become 'paid', exact evidence or not.
--   - `payment_records_amount_provenance_pairing_check` still requires
--     amount_availability='exact' to pair with amount_source=
--     'creation_snapshot' — an exact-evidence backfill row must still carry
--     a genuine source-time snapshot, not an estimate presented as exact.
--   - `payment_records_amounts_present_when_known_check` still requires
--     gross/discount/final amounts to be present whenever amount_availability
--     is 'exact' or 'estimated_backfill'.
ALTER TABLE payment_records
  DROP CONSTRAINT payment_records_status_legacy_unverified_check;

ALTER TABLE payment_records
  ADD CONSTRAINT payment_records_status_legacy_unverified_check
  CHECK (
    status <> 'legacy_unverified' OR (
      capture_origin = 'historical_backfill' AND evidence_class = 'legacy_operational_status'
      AND paid_amount_minor = 0 AND refunded_amount_minor = 0
      AND paid_at IS NULL AND confirming_admin_id IS NULL AND confirmed_payment_method IS NULL
      AND amount_availability IN ('exact', 'estimated_backfill', 'unknown')
    )
  );
