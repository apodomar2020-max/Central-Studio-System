ALTER TABLE notification_delivery_logs
  ADD COLUMN attempted_token_hash text,
  ADD COLUMN attempted_at timestamptz,
  ADD COLUMN receipt_status text,
  ADD COLUMN receipt_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN receipt_next_check_at timestamptz,
  ADD COLUMN receipt_checked_at timestamptz;
CREATE INDEX notification_delivery_receipt_pending_idx ON notification_delivery_logs(receipt_status,receipt_next_check_at);
-- Historical logs remain NULL: they lack a trustworthy attempted-token snapshot.
