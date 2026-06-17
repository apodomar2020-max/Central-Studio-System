import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  studentsTable,
  bookingsTable,
  packageOrdersTable,
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
//   { qrToken: UUID, bookingId: number, checkedInBy?: string }
//
// Flow (all inside one DB transaction):
//   1. Resolve student by qrToken (never reveals email in error messages)
//   2. Resolve booking by bookingId, verify it belongs to the student
//   3. Verify booking has not already been attended
//   4. Prevent duplicate attendance for the same class/schedule today
//   5. Create attendance record (status: checked_in)
//   6. If booking has a packageOrderId with credits: deduct 1 credit (SELECT FOR UPDATE)
//   7. Insert credit_transactions ledger row for the deduction
//
// Credits are deducted at check-in time (NOT at booking time). A booking
// without a packageOrderId checks in successfully without credit deduction.
// ---------------------------------------------------------------------------

type CheckInErrorCode =
  | "invalid_qr"
  | "booking_not_found"
  | "booking_mismatch"
  | "already_attended"
  | "duplicate_attendance"
  | "package_not_found"
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

  const { qrToken, bookingId, checkedInBy } = parsed.data;
  const performedBy = checkedInBy ?? "system";

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
      if (booking.status === "attended") {
        throw makeError(
          409,
          "already_attended",
          "This booking has already been marked as attended.",
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
      // Step 5 — Create attendance record
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
          packageOrderId: booking.packageOrderId ?? null,
          creditDeducted: booking.packageOrderId != null,
          checkedInBy: performedBy,
          status: "checked_in",
          classTitle: null, // populated below if we find the package name
          notes: null,
          checkedInAt: new Date().toISOString(),
        })
        .returning();

      // ------------------------------------------------------------------
      // Step 6 & 7 — Credit deduction + ledger row (if package linked)
      // ------------------------------------------------------------------
      let remainingCredits: number | null = null;

      if (booking.packageOrderId != null) {
        const [order] = await tx
          .select()
          .from(packageOrdersTable)
          .where(eq(packageOrdersTable.id, booking.packageOrderId))
          .for("update"); // row-level lock prevents concurrent double-deduction

        if (!order) {
          throw makeError(
            404,
            "package_not_found",
            "The linked package order could not be found.",
          );
        }

        if (order.remainingCredits <= 0) {
          throw makeError(
            400,
            "no_credits",
            "This package has no remaining credits.",
          );
        }

        const newRemaining = order.remainingCredits - 1;

        await tx
          .update(packageOrdersTable)
          .set({
            remainingCredits: newRemaining,
            status: newRemaining <= 0 ? "fullyUsed" : order.status,
          })
          .where(eq(packageOrdersTable.id, booking.packageOrderId));

        await tx.insert(creditTransactionsTable).values({
          packageOrderId: order.id,
          studentId: student.id,
          type: "attendance_deduction",
          delta: -1,
          balanceBefore: order.remainingCredits,
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
        creditDeducted: booking.packageOrderId != null,
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
