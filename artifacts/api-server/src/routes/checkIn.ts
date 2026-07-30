import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, studentsTable, bookingsTable } from "@workspace/db";
import { CheckInQrBody, CheckInQrResponse } from "@workspace/api-zod";
import { requireAdminAuth, requireAdminPermission } from "./adminAuth";
import { performBookingCheckIn, makeCheckInError, isCheckInError } from "../lib/checkInService";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// POST /check-in/qr — QR entry point into the shared check-in flow.
//
// This route ONLY does QR-specific work: resolve the student from the scanned
// qrToken, load + lock the selected booking, and verify the booking belongs to
// the scanned student. The actual attendance/credit/notification/booking
// transition is performed by performBookingCheckIn() — the SINGLE shared
// implementation also used by the manual booking-based check-in path. It
// verifies any booking-time deduction and never consumes credit at check-in.
// ---------------------------------------------------------------------------

router.post(
  "/check-in/qr",
  requireAdminAuth,
  requireAdminPermission("qr", "checkIn"),
  async (req, res): Promise<void> => {
    const parsed = CheckInQrBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { qrToken, bookingId, paymentMode, packageOrderId, checkedInBy } = parsed.data;
    const performedBy = checkedInBy ?? "system";

    try {
      const result = await db.transaction(async (tx) => {
        // Resolve student by QR token (never reveals email in error messages).
        const [student] = await tx
          .select()
          .from(studentsTable)
          .where(eq(studentsTable.qrToken, qrToken))
          .limit(1);
        if (!student) {
          throw makeCheckInError(404, "invalid_qr", "QR code is not recognised.");
        }

        // Load + lock the booking. FOR UPDATE serializes concurrent scans of the
        // same booking so attendance/credit can never be processed twice.
        const [booking] = await tx
          .select()
          .from(bookingsTable)
          .where(eq(bookingsTable.id, bookingId))
          .for("update");
        if (!booking) {
          throw makeCheckInError(404, "booking_not_found", "Booking not found.");
        }

        // The scanned student must own this booking.
        if (
          booking.accountOwnerStudentId !== student.id
          || booking.studentEmail.trim().toLowerCase() !== student.email.trim().toLowerCase()
        ) {
          throw makeCheckInError(403, "booking_mismatch", "This booking does not belong to the scanned student.");
        }

        return performBookingCheckIn(tx, {
          booking,
          student: { id: student.id, name: student.name, email: student.email },
          paymentMode,
          packageOrderId,
          performedBy,
        });
      });

      res.status(201).json(CheckInQrResponse.parse(result));
    } catch (err: unknown) {
      if (isCheckInError(err)) {
        res.status(err.status).json({ error: err.code, message: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
