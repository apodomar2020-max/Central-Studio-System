import { blockStudentJwt } from "../middlewares/auth";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, attendanceTable, packageOrdersTable, creditTransactionsTable, schedulesTable } from "@workspace/db";
import { createStudentNotification } from "../lib/notifications";
import { requireAdminAuth, requireAdminPermission } from "./adminAuth";
import {
  ListAttendanceQueryParams,
  ListAttendanceResponse,
  GetAttendanceStatsQueryParams,
  CheckInBodyExtended,
} from "@workspace/api-zod";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Helpers for structured business-logic errors thrown inside transactions.
// Throwing causes Drizzle to automatically roll back the transaction before
// the error propagates to the outer catch block.
// ---------------------------------------------------------------------------
type CheckInErrorCode =
  | "duplicate_attendance"
  | "package_not_eligible"
  | "package_not_found"
  | "no_credits";

interface CheckInError {
  isCheckInError: true;
  status: number;
  code: CheckInErrorCode;
  message: string;
}

function makeCheckInError(
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

function requirePackageDeductForManualCheckIn(req: Request, res: Response, next: NextFunction): void {
  if (req.body?.creditDeducted !== true || req.body?.packageOrderId == null) {
    next();
    return;
  }
  requireAdminPermission("qr", "packageDeduct")(req, res, next);
}

// ---------------------------------------------------------------------------
// GET /attendance
// ---------------------------------------------------------------------------
router.get("/attendance", async (req, res): Promise<void> => {
  const query = ListAttendanceQueryParams.safeParse(req.query);
  let rows = await db
    .select()
    .from(attendanceTable)
    .orderBy(desc(attendanceTable.checkedInAt));
  if (query.success && query.data.studentEmail) {
    rows = rows.filter((r) => r.studentEmail === query.data.studentEmail);
  }
  res.json(ListAttendanceResponse.parse(rows));
});

// ---------------------------------------------------------------------------
// POST /attendance
//
// Accepts both the original body shape AND the extended shape (with optional
// studentId / classId / scheduleId).  Clients that don't send the new fields
// continue to work unchanged.
//
// Guarantees (enforced inside a single DB transaction):
//   1. Duplicate prevention — if classId or scheduleId is supplied, we block
//      a second check-in for the same student + class/schedule on the same day.
//   2. Package integrity — credit is only deducted if the package exists and
//      has credits remaining; the package is locked for the duration of the
//      transaction to prevent double-deduction under concurrent requests.
//   3. Atomic write — attendance record and credit deduction either both
//      commit or both roll back.
// ---------------------------------------------------------------------------
router.post(
  "/attendance",
  blockStudentJwt,
  requireAdminAuth,
  requireAdminPermission("attendance", "checkIn"),
  requirePackageDeductForManualCheckIn,
  async (req, res): Promise<void> => {
  const parsed = CheckInBodyExtended.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const {
    studentEmail,
    studentName,
    packageOrderId,
    classTitle,
    creditDeducted,
    notes,
    studentId,
    classId,
    scheduleId,
    bookingId,
    checkedInBy,
    status,
  } = parsed.data;

  try {
    const row = await db.transaction(async (tx) => {
      // ------------------------------------------------------------------
      // Step 1 — Duplicate attendance check
      // Only runs when classId or scheduleId is provided (new QR flow).
      // Legacy check-ins (free-text class title only) skip this check so
      // existing admin behaviour is not broken.
      // ------------------------------------------------------------------
      if (classId != null || scheduleId != null) {
        const dupConditions = [
          eq(attendanceTable.studentEmail, studentEmail),
          // Compare the date portion of checkedInAt (stored as timestamptz)
          // against today's date in the DB server timezone (UTC on Railway).
          // Classes do not run past midnight so UTC date is safe here.
          sql`${attendanceTable.checkedInAt}::date = CURRENT_DATE`,
        ];

        if (scheduleId != null) {
          // Prefer scheduleId — it's the most specific identifier
          dupConditions.push(eq(attendanceTable.scheduleId, scheduleId));
        } else {
          dupConditions.push(eq(attendanceTable.classId, classId!));
        }

        const [existing] = await tx
          .select({ id: attendanceTable.id })
          .from(attendanceTable)
          .where(and(...dupConditions))
          .limit(1);

        if (existing) {
          throw makeCheckInError(
            409,
            "duplicate_attendance",
            "This student has already been checked in for this class today.",
          );
        }
      }

      // ------------------------------------------------------------------
      // Step 2 — Credit deduction (with row-level lock for concurrency safety)
      // ------------------------------------------------------------------
      let remainingCreditsAfterDeduction: number | null = null;

      if (creditDeducted && packageOrderId != null) {
        if (scheduleId != null) {
          const [schedule] = await tx
            .select({ packageEligible: schedulesTable.packageEligible })
            .from(schedulesTable)
            .where(eq(schedulesTable.id, scheduleId))
            .limit(1);

          if (schedule?.packageEligible === false) {
            throw makeCheckInError(
              400,
              "package_not_eligible",
              "This schedule is not eligible for package credits.",
            );
          }
        }

        const [order] = await tx
          .select()
          .from(packageOrdersTable)
          .where(eq(packageOrdersTable.id, packageOrderId))
          .for("update"); // prevents concurrent deductions on the same package

        if (!order) {
          throw makeCheckInError(
            404,
            "package_not_found",
            "Package order not found.",
          );
        }

        if (order.remainingCredits <= 0) {
          throw makeCheckInError(
            400,
            "no_credits",
            "This package has no remaining credits.",
          );
        }

        const newRemaining = order.remainingCredits - 1;
        remainingCreditsAfterDeduction = newRemaining;
        await tx
          .update(packageOrdersTable)
          .set({
            remainingCredits: newRemaining,
            status: newRemaining <= 0 ? "fullyUsed" : order.status,
          })
          .where(eq(packageOrdersTable.id, packageOrderId));

        // ------------------------------------------------------------------
        // Step 2b — Append immutable ledger row for this credit deduction
        // ------------------------------------------------------------------
        await tx.insert(creditTransactionsTable).values({
          packageOrderId,
          studentId: studentId ?? null,
          type: "attendance_deduction",
          delta: -1,
          balanceBefore: order.remainingCredits,
          balanceAfter: newRemaining,
          referenceId: bookingId ?? null,
          referenceType: bookingId != null ? "booking" : null,
          notes: `Check-in for "${classTitle ?? "class"}"`,
          createdBy: checkedInBy ?? "system",
        });
      }

      // ------------------------------------------------------------------
      // Step 3 — Insert attendance record
      // ------------------------------------------------------------------
      const [inserted] = await tx
        .insert(attendanceTable)
        .values({
          studentName,
          studentEmail,
          packageOrderId: packageOrderId ?? null,
          classTitle: classTitle ?? null,
          creditDeducted: creditDeducted ?? false,
          notes: notes ?? null,
          studentId: studentId ?? null,
          classId: classId ?? null,
          scheduleId: scheduleId ?? null,
          bookingId: bookingId ?? null,
          checkedInBy: checkedInBy ?? null,
          status: status ?? "checked_in",
          checkedInAt: new Date().toISOString(),
        })
        .returning();

      await createStudentNotification(tx, {
        studentId: studentId ?? null,
        studentEmail,
        title: "Checked in",
        body: `You have been checked in${classTitle ? ` for ${classTitle}` : ""}.`,
        type: "attendance_checked_in",
        relatedEntityType: "attendance",
        relatedEntityId: inserted.id,
        metadata: {
          bookingId,
          className: classTitle,
          classId,
          scheduleId,
        },
      });

      if (creditDeducted && packageOrderId != null) {
        await createStudentNotification(tx, {
          studentId: studentId ?? null,
          studentEmail,
          title: "Credit used",
          body: `1 credit was used${classTitle ? ` for ${classTitle}` : ""}.`,
          type: "credits_exhausted",
          relatedEntityType: "attendance",
          relatedEntityId: inserted.id,
          metadata: {
            bookingId,
            className: classTitle,
            packageOrderId,
            remainingCredits: remainingCreditsAfterDeduction,
          },
        });

        if (remainingCreditsAfterDeduction === 0) {
          await createStudentNotification(tx, {
            studentId: studentId ?? null,
            studentEmail,
            title: "Package credits used",
            body: "Your package credits have been used.",
            type: "credits_exhausted",
            relatedEntityType: "package_order",
            relatedEntityId: packageOrderId,
            metadata: {
              bookingId,
              className: classTitle,
              packageOrderId,
              remainingCredits: remainingCreditsAfterDeduction,
            },
          });
        }
      }

      return inserted;
    });

    res.status(201).json(row);
  } catch (err: unknown) {
    if (isCheckInError(err)) {
      res.status(err.status).json({ error: err.code, message: err.message });
      return;
    }
    // Re-throw unexpected DB or runtime errors — Express error handler picks
    // these up and returns a 500 (without leaking stack traces in production).
    throw err;
  }
  },
);

// ---------------------------------------------------------------------------
// GET /attendance/stats
// ---------------------------------------------------------------------------
router.get("/attendance/stats", async (req, res): Promise<void> => {
  const query = GetAttendanceStatsQueryParams.safeParse(req.query);
  const period =
    query.success && query.data.period ? query.data.period : "monthly";

  const rows = await db
    .select()
    .from(attendanceTable)
    .orderBy(desc(attendanceTable.checkedInAt));

  const now = new Date();
  let data: { label: string; count: number }[] = [];

  if (period === "daily") {
    const buckets: Record<string, number> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const label = d.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
      });
      buckets[label] = 0;
    }
    for (const row of rows) {
      const d = new Date(row.checkedInAt);
      const label = d.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
      });
      if (label in buckets) buckets[label]++;
    }
    data = Object.entries(buckets).map(([label, count]) => ({ label, count }));
  } else if (period === "monthly") {
    const buckets: Record<string, number> = {};
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = d.toLocaleDateString("en-GB", {
        month: "short",
        year: "2-digit",
      });
      buckets[label] = 0;
    }
    for (const row of rows) {
      const d = new Date(row.checkedInAt);
      const label = d.toLocaleDateString("en-GB", {
        month: "short",
        year: "2-digit",
      });
      if (label in buckets) buckets[label]++;
    }
    data = Object.entries(buckets).map(([label, count]) => ({ label, count }));
  } else {
    const buckets: Record<string, number> = {};
    for (let i = 2; i >= 0; i--) {
      const label = String(now.getFullYear() - i);
      buckets[label] = 0;
    }
    for (const row of rows) {
      const label = String(new Date(row.checkedInAt).getFullYear());
      if (label in buckets) buckets[label]++;
    }
    data = Object.entries(buckets).map(([label, count]) => ({ label, count }));
  }

  const total = data.reduce((sum, d) => sum + d.count, 0);
  res.json({ period, total, data });
});

export default router;
