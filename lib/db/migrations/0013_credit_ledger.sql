-- Migration 0013: Credit Ledger Foundation
-- Adds three things:
--   1. New columns on `attendance` (bookingId, checkedInBy, status)
--   2. New column on `bookings` (packageOrderId — explicit FK to package_orders)
--   3. New table `credit_transactions` — immutable audit ledger

-- ─── 1. attendance additions ─────────────────────────────────────────────────
-- All nullable / defaulted so existing rows remain valid.

ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS booking_id       INTEGER,
  ADD COLUMN IF NOT EXISTS checked_in_by   TEXT,
  ADD COLUMN IF NOT EXISTS status          TEXT NOT NULL DEFAULT 'checked_in';

-- ─── 2. bookings addition ────────────────────────────────────────────────────
-- Explicit FK to package_orders.id. The legacy `package_id` column is kept
-- unchanged (some rows store pricePackages.id, others packageOrders.id — it
-- was ambiguous). Going forward `package_order_id` is authoritative.

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS package_order_id INTEGER;

-- ─── 3. credit_transactions table ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS credit_transactions (
  id               SERIAL PRIMARY KEY,
  package_order_id INTEGER NOT NULL,
  student_id       INTEGER,
  type             TEXT    NOT NULL,
  delta            INTEGER NOT NULL,
  balance_before   INTEGER NOT NULL,
  balance_after    INTEGER NOT NULL,
  reference_id     INTEGER,
  reference_type   TEXT,
  notes            TEXT,
  created_by       TEXT    NOT NULL DEFAULT 'system',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index to support the two most common query patterns:
--   GET ledger for a package order
--   GET ledger for a student
CREATE INDEX IF NOT EXISTS idx_credit_tx_package_order ON credit_transactions (package_order_id);
CREATE INDEX IF NOT EXISTS idx_credit_tx_student       ON credit_transactions (student_id);
