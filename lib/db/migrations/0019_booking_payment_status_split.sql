ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "booking_status" text NOT NULL DEFAULT 'confirmed';
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "payment_status" text NOT NULL DEFAULT 'not_required';
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "payment_mode" text;

UPDATE "bookings"
SET
  "booking_status" = CASE
    WHEN "status" = 'pendingPayment' THEN 'pending'
    WHEN "status" IN ('pending', 'confirmed', 'rejected', 'cancelled', 'attended', 'completed') THEN "status"
    ELSE 'confirmed'
  END,
  "payment_status" = CASE
    WHEN "status" = 'pendingPayment' THEN 'pending_payment'
    WHEN "status" = 'refunded' THEN 'refunded'
    WHEN "status" IN ('attended', 'completed') AND "package_order_id" IS NULL THEN 'paid'
    ELSE 'not_required'
  END,
  "payment_mode" = CASE
    WHEN "status" = 'pendingPayment' THEN 'pay_at_studio'
    WHEN "package_order_id" IS NOT NULL THEN 'package_credit'
    WHEN "status" IN ('confirmed', 'attended', 'completed') AND "package_order_id" IS NULL THEN 'free'
    ELSE "payment_mode"
  END;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_booking_status_check'
  ) THEN
    ALTER TABLE "bookings"
      ADD CONSTRAINT "bookings_booking_status_check"
      CHECK ("booking_status" IN ('pending', 'confirmed', 'rejected', 'cancelled', 'attended', 'completed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_payment_status_check'
  ) THEN
    ALTER TABLE "bookings"
      ADD CONSTRAINT "bookings_payment_status_check"
      CHECK ("payment_status" IN ('not_required', 'pending_payment', 'paid', 'refunded', 'failed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_payment_mode_check'
  ) THEN
    ALTER TABLE "bookings"
      ADD CONSTRAINT "bookings_payment_mode_check"
      CHECK ("payment_mode" IS NULL OR "payment_mode" IN ('package_credit', 'pay_at_studio', 'online_payment', 'free'));
  END IF;
END $$;
