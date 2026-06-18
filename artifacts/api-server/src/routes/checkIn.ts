import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  studentsTable,
  bookingsTable,
  packageOrdersTable,
  schedulesTable,
  attendanceTable,
  creditTransactionsTable,
} from "@workspace/db";
import { CheckInQrBody, CheckInQrResponse } from "@workspace/api-zod";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// POST /check-in/qr
//
// Atomic QR-code check-in for the credit ledger system (migration 0013).
//
// Accepts:
//   { qrToken: UUID, bookingId: number, paymentMode, packageOrderId?, checkedInBy? }
//
// Flow (all inside one DB transaction):
//   1. Resolve student by qrToken (never reveals email in error messages)
//   2. Resolve booking by bookingId, verify it belongs to the student
//   3. Verify booking has not already been attended
//   4. Prevent duplicate attendance for the same class/schedule today
//   5. Create attendance record (status: checked_in)
//   6. If admin selected package credit: deduct 1 credit (SELECT FOR UPDATE)
//   7. Insert credit_transactions ledger row for the deduction
//
// Credits are deducted at check-in time (NOT at booking time). A booking
// Pay-at-studio checks in successfully without credit deduction.
// ---------------------------------------------------------------------------

type CheckInErrorCode =
  | "invalid_qr"
  | "booking_not_found"
  | "booking_mismatch"
  | "already_attended"
  | "duplicate_attendance"
  | "booking_not_actionable"
  | "package_required"
  | "package_not_found"
  | "invalid_package"
  | "package_not_eligible"
  | "no_credits";

interface CheckInError {
  isCheckInError: true;
  status: number;
  code: CheckInErrorCode;
  message: string;
}

function makeError(
  status: number,
  code: CheckInErrorCode,
  message: string,
): CheckInError {
  return { isCheckInError: true, status, code, message };
}

function isCheckInError(e: unknown): e is CheckInError {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as CheckInError).isCheckInError === true
  );
}

router.post("/check-in/qr", async (req, res): Promise<void> => {
  const parsed = CheckInQrBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { qrToken, bookingId, paymentMode, packageOrderId, checkedInBy } = parsed.data;
  const performedBy = checkedInBy ?? "system";

  if (paymentMode === "package_credit" && packageOrderId == null) {
    res.status(400).json({
      error: "package_required",
      message: "Package credit check-in requires a packageOrderId.",
    });
    return;
  }

  try {
    const result = await db.transaction(async (tx) => {
      // ------------------------------------------------------------------
      // Step 1 — Resolve student by QR token
      // ------------------------------------------------------------------
      const [student] = await tx
        .select()
        .from(studentsTable)
        .where(eq(studentsTable.qrToken, qrToken))
        .limit(1);

      if (!student) {
        throw makeError(404, "invalid_qr", "QR code is not recognised.");
      }

      // ------------------------------------------------------------------
      // Step 2 — Resolve and validate booking
      // ------------------------------------------------------------------
      const [booking] = await tx
        .select()
        .from(bookingsTable)
        .where(eq(bookingsTable.id, bookingId))
        .limit(1);

      if (!booking) {
        throw makeError(404, "booking_not_found", "Booking not found.");
      }

      // Verify the booking belongs to the student who presented this QR code.
      if (booking.studentEmail !== student.email) {
        throw makeError(
          403,
          "booking_mismatch",
          "This booking does not belong to the scanned student.",
        );
      }

      // ------------------------------------------------------------------
      // Step 3 — Prevent double check-in on the same booking
      // ------------------------------------------------------------------
      if (booking.status === "attended" || booking.status === "completed") {
        throw makeError(
          409,
          "already_attended",
          "This booking has already been marked as attended.",
        );
      }

      if (booking.status === "cancelled") {
        throw makeError(
          400,
          "booking_not_actionable",
          "Cancelled bookings cannot be checked in.",
        );
      }

      const [existingForBooking] = await tx
        .select({ id: attendanceTable.id })
        .from(attendanceTable)
        .where(eq(attendanceTable.bookingId, booking.id))
        .limit(1);

      if (existingForBooking) {
        throw makeError(
          409,
          "already_attended",
          "This booking already has an attendance record.",
        );
      }

      // ------------------------------------------------------------------
      // Step 4 — Prevent duplicate attendance for same class/schedule today
      // ------------------------------------------------------------------
      if (booking.classId != null || booking.scheduleId != null) {
        const dupConditions = [
          eq(attendanceTable.studentEmail, student.email),
          sql`${attendanceTable.checkedInAt}::date = CURRENT_DATE`,
        ];

        if (booking.scheduleId != null) {
          dupConditions.push(eq(attendanceTable.scheduleId, booking.scheduleId));
        } else {
          dupConditions.push(eq(attendanceTable.classId, booking.classId!));
        }

        const [existing] = await tx
          .select({ id: attendanceTable.id })
          .from(attendanceTable)
          .where(and(...dupConditions))
          .limit(1);

        if (existing) {
          throw makeError(
            409,
            "duplicate_attendance",
            "Student is already checked in for this class today.",
          );
        }
      }

      // ------------------------------------------------------------------
      // Step 5 — Validate selected package credit, if requested
      // ------------------------------------------------------------------
      let selectedOrder:
        | {
            id: number;
            studentEmail: string;
            remainingCredits: number;
            status: string;
          }
        | null = null;

      if (paymentMode === "package_credit") {
        if (booking.scheduleId != null) {
          const [schedule] = await tx
            .select({ packageEligible: schedulesTable.packageEligible })
            .from(schedulesTable)
            .where(eq(schedulesTable.id, booking.scheduleId))
            .limit(1);

          if (schedule?.packageEligible === false) {
            throw makeError(
              400,
              "package_not_eligible",
              "This schedule is not eligible for package credits.",
            );
          }
        }

        const [order] = await tx
          .select({
            id: packageOrdersTable.id,
            studentEmail: packageOrdersTable.studentEmail,
            remainingCredits: packageOrdersTable.remainingCredits,
            status: packageOrdersTable.status,
          })
          .from(packageOrdersTable)
          .where(eq(packageOrdersTable.id, packageOrderId!))
          .for("update");

        if (!order) {
          throw makeError(404, "package_not_found", "The selected package order could not be found.");
        }

        if (order.studentEmail !== student.email || order.status !== "active") {
          throw makeError(403, "invalid_package", "The selected package is not active for this student.");
        }

        if (order.remainingCredits <= 0) {
          throw makeError(400, "no_credits", "This package has no remaining credits.");
        }

        selectedOrder = order;
      }

      // ------------------------------------------------------------------
      // Step 6 — Create attendance record
      // ------------------------------------------------------------------
      const [attendance] = await tx
        .insert(attendanceTable)
        .values({
          studentName: student.name,
          studentEmail: student.email,
          studentId: student.id,
          classId: booking.classId ?? null,
          scheduleId: booking.scheduleId ?? null,
          bookingId: booking.id,
          packageOrderId: selectedOrder?.id ?? null,
          creditDeducted: paymentMode === "package_credit",
          checkedInBy: performedBy,
          status: "checked_in",
          classTitle: null,
          notes: paymentMode === "pay_at_studio" ? "Payment mode: pay at studio" : null,
          checkedInAt: new Date().toISOString(),
        })
        .returning();

      // ------------------------------------------------------------------
      // Step 7 — Credit deduction + ledger row (if package credit selected)
      // ------------------------------------------------------------------
      let remainingCredits: number | null = null;

      if (selectedOrder) {
        const newRemaining = selectedOrder.remainingCredits - 1;

        await tx
          .update(packageOrdersTable)
          .set({
            remainingCredits: newRemaining,
            status: newRemaining <= 0 ? "fullyUsed" : selectedOrder.status,
          })
          .where(eq(packageOrdersTable.id, selectedOrder.id));

        await tx.insert(creditTransactionsTable).values({
          packageOrderId: selectedOrder.id,
          studentId: student.id,
          type: "attendance_deduction",
          delta: -1,
          balanceBefore: selectedOrder.remainingCredits,
          balanceAfter: newRemaining,
          referenceId: attendance.id,
          referenceType: "attendance",
          notes: `QR check-in for booking #${booking.id}`,
          createdBy: performedBy,
        });

        remainingCredits = newRemaining;
      }

      // ------------------------------------------------------------------
      // Step 8 — Mark booking as attended
      // ------------------------------------------------------------------
      await tx
        .update(bookingsTable)
        .set({ status: "attended" })
        .where(eq(bookingsTable.id, booking.id));

      return {
        attendanceId: attendance.id,
        studentName: student.name,
        studentEmail: student.email,
        classTitle: null as string | null,
        creditDeducted: paymentMode === "package_credit",
        remainingCredits,
        checkedInAt: attendance.checkedInAt,
      };
    });

    res.status(201).json(CheckInQrResponse.parse(result));
  } catch (err: unknown) {
    if (isCheckInError(err)) {
      res.status(err.status).json({ error: err.code, message: err.message });
      return;
    }
    throw err;
  }
});

export default router;
