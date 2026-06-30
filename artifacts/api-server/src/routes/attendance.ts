import { blockStudentJwt } from "../middlewares/auth";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import * as zod from "zod";
import { db, attendanceTable, bookingsTable, studentsTable, packageOrdersTable, creditTransactionsTable, schedulesTable } from "@workspace/db";
import { createStudentNotification } from "../lib/notifications";
import { requireAdminAuth, requireAdminPermission } from "./adminAuth";
import { performBookingCheckIn, makeCheckInError, isCheckInError } from "../lib/checkInService";
import {
  ListAttendanceResponse,
  GetAttendanceStatsQueryParams,
  CheckInBodyExtended,
} from "@workspace/api-zod";

const router: IRouter = Router();

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
const ListAttendanceQueryParams = zod.object({
  studentEmail: zod.coerce.string().optional(),
  status: zod.coerce.string().optional(),
  page: zod.coerce.number().int().min(1).optional(),
  pageSize: zod.coerce.number().int().min(1).max(500).optional(),
});

router.get("/attendance", async (req, res): Promise<void> => {
  const query = ListAttendanceQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const page = query.data.page ?? 1;
  const pageSize = query.data.pageSize ?? 50;
  const offset = (page - 1) * pageSize;
  const conditions = [];

  if (query.data.studentEmail) {
    conditions.push(eq(attendanceTable.studentEmail, query.data.studentEmail));
  }
  if (query.data.status) {
    conditions.push(eq(attendanceTable.status, query.data.status));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [countRow] = whereClause
    ? await db.select({ total: sql<number>`count(*)::int` }).from(attendanceTable).where(whereClause)
    : await db.select({ total: sql<number>`count(*)::int` }).from(attendanceTable);
  const total = Number(countRow?.total ?? 0);

  const rows = whereClause
    ? await db
        .select()
        .from(attendanceTable)
        .where(whereClause)
        .orderBy(desc(attendanceTable.checkedInAt))
        .limit(pageSize)
        .offset(offset)
    : await db
        .select()
        .from(attendanceTable)
        .orderBy(desc(attendanceTable.checkedInAt))
        .limit(pageSize)
        .offset(offset);

  res.setHeader("X-Total-Count", String(total));
  res.setHeader("X-Page", String(page));
  res.setHeader("X-Page-Size", String(pageSize));
  res.setHeader("X-Total-Pages", String(total === 0 ? 0 : Math.ceil(total / pageSize)));
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

  const performedBy = checkedInBy ?? "system";

  try {
    // ── Booking-based MANUAL check-in ──────────────────────────────────────
    // When a bookingId is supplied this is a manual entry point into the SAME
    // shared flow as QR check-in: it resolves the booking + account owner and
    // delegates to performBookingCheckIn(), which performs the one and only
    // attended-transition (attendance + credit + ledger + booking→attended +
    // notifications). No business logic is duplicated here.
    if (bookingId != null) {
      const result = await db.transaction(async (tx) => {
        const [booking] = await tx
          .select()
          .from(bookingsTable)
          .where(eq(bookingsTable.id, bookingId))
          .for("update");
        if (!booking) {
          throw makeCheckInError(404, "booking_not_found", "Booking not found.");
        }

        // Resolve the account-owner student (the package owner / QR identity).
        let owner: { id: number; name: string; email: string } | null = null;
        if (booking.accountOwnerStudentId != null) {
          const [s] = await tx
            .select({ id: studentsTable.id, name: studentsTable.name, email: studentsTable.email })
            .from(studentsTable)
            .where(eq(studentsTable.id, booking.accountOwnerStudentId))
            .limit(1);
          owner = s ?? null;
        }
        if (!owner) {
          const [s] = await tx
            .select({ id: studentsTable.id, name: studentsTable.name, email: studentsTable.email })
            .from(studentsTable)
            .where(sql`lower(trim(${studentsTable.email})) = ${booking.studentEmail.trim().toLowerCase()}`)
            .limit(1);
          owner = s ?? null;
        }
        if (!owner) {
          throw makeCheckInError(404, "booking_not_found", "The student for this booking could not be found.");
        }

        const resolvedPaymentMode =
          creditDeducted && packageOrderId != null ? "package_credit" : "pay_at_studio";

        return performBookingCheckIn(tx, {
          booking,
          student: owner,
          paymentMode: resolvedPaymentMode,
          packageOrderId: resolvedPaymentMode === "package_credit" ? packageOrderId : null,
          performedBy,
        });
      });

      res.status(201).json(result);
      return;
    }

    // ── WALK-IN check-in (no booking) — SEPARATE flow, behaviour unchanged ──
    // Records that an (un-booked) student attended. This mirrors the existing
    // walk-in behaviour exactly: optional same-day duplicate guard, optional
    // package-credit deduction + ledger, attendance row, and notifications.
    // (Booking-linked check-ins go through the shared performBookingCheckIn()
    // above; this path intentionally remains its own implementation.)
    const row = await db.transaction(async (tx) => {
      // Step 1 — Duplicate attendance check (only when a class/schedule is given)
      if (classId != null || scheduleId != null) {
        const dupConditions = [
          eq(attendanceTable.studentEmail, studentEmail),
          // Same-day comparison in Africa/Cairo (no UTC drift).
          sql`(${attendanceTable.checkedInAt} AT TIME ZONE 'Africa/Cairo')::date = (now() AT TIME ZONE 'Africa/Cairo')::date`,
        ];
        if (scheduleId != null) {
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

      // Step 2 — Credit deduction + ledger (with row-level lock), if requested
      let remainingCreditsAfterDeduction: number | null = null;
      if (creditDeducted && packageOrderId != null) {
        if (scheduleId != null) {
          const [schedule] = await tx
            .select({ packageEligible: schedulesTable.packageEligible })
            .from(schedulesTable)
            .where(eq(schedulesTable.id, scheduleId))
            .limit(1);
          if (schedule?.packageEligible === false) {
            throw makeCheckInError(400, "package_not_eligible", "This schedule is not eligible for package credits.");
          }
        }

        const [order] = await tx
          .select()
          .from(packageOrdersTable)
          .where(eq(packageOrdersTable.id, packageOrderId))
          .for("update"); // prevents concurrent deductions on the same package
        if (!order) {
          throw makeCheckInError(404, "package_not_found", "Package order not found.");
        }
        if (order.remainingCredits <= 0) {
          throw makeCheckInError(400, "no_credits", "This package has no remaining credits.");
        }

        const newRemaining = order.remainingCredits - 1;
        remainingCreditsAfterDeduction = newRemaining;
        await tx
          .update(packageOrdersTable)
          .set({ remainingCredits: newRemaining, status: newRemaining <= 0 ? "fullyUsed" : order.status })
          .where(eq(packageOrdersTable.id, packageOrderId));

        await tx.insert(creditTransactionsTable).values({
          packageOrderId,
          studentId: studentId ?? null,
          type: "attendance_deduction",
          delta: -1,
          balanceBefore: order.remainingCredits,
          balanceAfter: newRemaining,
          referenceId: null,
          referenceType: null,
          notes: `Check-in for "${classTitle ?? "class"}"`,
          createdBy: performedBy,
        });
      }

      // Step 3 — Insert attendance record
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
          bookingId: null,
          checkedInBy: performedBy,
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
        metadata: { className: classTitle, classId, scheduleId },
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
          metadata: { className: classTitle, packageOrderId, remainingCredits: remainingCreditsAfterDeduction },
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
            metadata: { className: classTitle, packageOrderId, remainingCredits: remainingCreditsAfterDeduction },
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
