CREATE UNIQUE INDEX "attendance_reversals_active_attendance_unique" ON "attendance_reversals" USING btree ("attendance_id") WHERE "status" in ('requested','approved');
--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_reversals_active_consumption_unique" ON "attendance_reversals" USING btree ("original_consumption_allocation_id") WHERE "status" in ('requested','approved');
--> statement-breakpoint
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_booking_status_check";
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_booking_status_check" CHECK ("booking_status" IN ('pending', 'confirmed', 'rejected', 'cancelled', 'attended', 'completed', 'attendance_reversed'));
