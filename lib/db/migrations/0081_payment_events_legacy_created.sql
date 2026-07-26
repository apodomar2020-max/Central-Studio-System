-- Migration 0081: add `legacy_created` payment_events event type for
-- historical backfill reconstruction (Finance Phase 2D).
--
-- Schema gap this closes: the existing `created` event's shape check only
-- permits new_status IN ('unpaid','pending_confirmation'). Backfilled
-- payment_records rows land directly as `legacy_unverified` (never
-- unpaid/pending_confirmation), so no existing event type can represent
-- "a payment_records row came into existence via backfill." `legacy_created`
-- is added as a fully separate event type with its own shape check so the
-- backfill writer has an event to append without touching `created` at all.
--
-- The existing `created` event type, its column, its shape check, and its
-- semantics are completely untouched by this migration — verified by the
-- payment_events foundation test suite continuing to pass unmodified.

-- 1. Widen the event_type vocabulary check to also allow 'legacy_created'.
ALTER TABLE payment_events
  DROP CONSTRAINT payment_events_event_type_check;

ALTER TABLE payment_events
  ADD CONSTRAINT payment_events_event_type_check
  CHECK (event_type IN (
    'created', 'created_and_confirmed', 'confirmed', 'method_changed',
    'activation_credits_issued', 'waived', 'failed', 'cancelled', 'voided',
    'refund_payout_completed', 'legacy_created'
  ));

-- 2. legacy_created shape check. Mirrors the `created` shape check's
--    structure but requires new_status = 'legacy_unverified' exclusively
--    (never 'unpaid'/'pending_confirmation') and forbids an amount, since
--    the backfill writer never asserts a monetary amount via this event —
--    the associated payment_records row's own paid_amount_minor = 0 and
--    amount_availability columns carry that signal instead.
--
--    payment_events has no dedicated columns for batch id, classifier
--    version, code commit, classification reason, or source family — only
--    the generic `reason` (text) and no jsonb metadata column at all. This
--    shape check therefore cannot constrain those values structurally; the
--    backfill writer is expected to record what it can in `reason` and rely
--    on the payment_backfill_batches/payment_backfill_progress rows (joined
--    via the payment_records row this event references) for the rest. This
--    is a documented limitation, not an oversight.
ALTER TABLE payment_events
  ADD CONSTRAINT payment_events_legacy_created_shape_check
  CHECK (event_type <> 'legacy_created' OR (
    previous_status IS NULL AND amount_minor IS NULL
    AND new_status = 'legacy_unverified'
  ));
