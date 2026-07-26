-- Migration 0084: Finance Phase 2D-3 — allow payment_backfill_progress_items
-- to reach 'succeeded'/'processing' now that the exact-evidence-only writer
-- exists.
--
-- payment_backfill_progress_items's own module doc (migration 0082) states:
-- "No writer exists in Phase 2D-2 — 'succeeded' and 'processing' are
-- rejected by this table's own CHECK constraint... until the Phase 2D-3
-- writer exists and this constraint is deliberately relaxed alongside it."
-- This migration is exactly that anticipated relaxation, and nothing else:
-- the writer itself (financeBackfillWriter.ts) still enforces every other
-- eligibility/evidence/scope rule before ever reaching an insert.
ALTER TABLE payment_backfill_progress_items
  DROP CONSTRAINT payment_backfill_progress_items_no_writer_yet_check;

-- 'processing' remains excluded: this writer is synchronous per-source-row
-- (an insert either completes within its own transaction or the whole
-- transaction rolls back) — there is no intermediate state a row can be
-- observed in from outside that transaction, so 'processing' would only
-- ever be a stale/crashed marker, never a real in-flight state. Excluding
-- it keeps failure/crash-recovery logic simple: a row is either not yet
-- attempted, terminal, or absent — never ambiguously "in progress".
ALTER TABLE payment_backfill_progress_items
  ADD CONSTRAINT payment_backfill_progress_items_no_intermediate_processing_check
  CHECK (status <> 'processing');
