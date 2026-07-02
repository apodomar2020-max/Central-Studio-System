-- Phase A infrastructure hardening: additive indexes for high-traffic
-- ownership, booking, attendance, credit, and marketing lookup paths.

CREATE INDEX IF NOT EXISTS "bookings_schedule_id_idx"
  ON "bookings" ("schedule_id");

CREATE INDEX IF NOT EXISTS "bookings_account_owner_student_id_idx"
  ON "bookings" ("account_owner_student_id");

CREATE INDEX IF NOT EXISTS "bookings_package_order_id_idx"
  ON "bookings" ("package_order_id");

CREATE INDEX IF NOT EXISTS "attendance_student_id_idx"
  ON "attendance" ("student_id");

CREATE INDEX IF NOT EXISTS "attendance_schedule_id_idx"
  ON "attendance" ("schedule_id");

CREATE INDEX IF NOT EXISTS "attendance_booking_id_lookup_idx"
  ON "attendance" ("booking_id");

CREATE INDEX IF NOT EXISTS "credit_transactions_package_order_id_idx"
  ON "credit_transactions" ("package_order_id");

CREATE INDEX IF NOT EXISTS "credit_transactions_student_id_idx"
  ON "credit_transactions" ("student_id");

CREATE INDEX IF NOT EXISTS "marketing_campaign_recipients_campaign_id_idx"
  ON "marketing_campaign_recipients" ("campaign_id");

CREATE INDEX IF NOT EXISTS "marketing_campaign_recipients_status_idx"
  ON "marketing_campaign_recipients" ("status");

CREATE INDEX IF NOT EXISTS "marketing_delivery_logs_recipient_id_idx"
  ON "marketing_delivery_logs" ("recipient_id");

CREATE INDEX IF NOT EXISTS "marketing_delivery_logs_campaign_id_idx"
  ON "marketing_delivery_logs" ("campaign_id");
