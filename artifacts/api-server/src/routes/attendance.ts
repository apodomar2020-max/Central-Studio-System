import { blockStudentJwt } from "../middlewares/auth";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import * as zod from "zod";
import { db, attendanceTable, bookingsTable, studentsTable, packageOrdersTable, creditTransactionsTable, schedulesTable } from "@workspace/db";
import { createStudentNotification } from "../lib/notifications";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { performBookingCheckIn, makeCheckInError, isCheckInError, performStudioWalkIn, dispatchStudioWalkInPush } from "../lib/checkInService";
import { logActivity } from "../lib/activityLog";
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

// Admin-only: lists attendance records across all students (queryable by
// student email). Students read their own history via GET /my/attendance
// (Security Assessment H-01).
router.get("/attendance", requireAdminAuth, requireAdminPermission("attendance", "view"), async (req, res): Promise<void> => {
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
  async (req: AdminRequest, res): Promise<void> => {
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
    settlementMode,
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

      await logActivity(req, {
        action: "checkIn",
        module: "attendance",
        entityType: "attendance",
        entityId: result.attendanceId,
        entityLabel: result.studentName,
        after: {
          studentId: studentId ?? null,
          studentEmail: result.studentEmail,
          studentName: result.studentName,
          bookingId,
          packageOrderId: packageOrderId ?? null,
          classTitle: result.classTitle,
          creditDeducted: result.creditDeducted,
          remainingCredits: result.remainingCredits,
          checkedInAt: result.checkedInAt,
        },
        summary: `Checked in ${result.studentName}${result.classTitle ? ` for ${result.classTitle}` : ""}`,
      });

      res.status(201).json(result);
      return;
    }

    // ── WALK-IN check-in (no booking) ───────────────────────────────────────
    // Records that an (un-booked) student attended. The Admin's explicit
    // `settlementMode` choice ("package_credit" | "pay_at_studio" |
    // "not_paid") is the ONLY thing that decides which write path runs below
    // — it is mandatory (enforced by the CheckInBodyExtended schema) and the
    // server never infers it from package availability, payment status, or
    // participant state. See STUDIO_WALKIN_EXPLICIT_SETTLEMENT_POLICY.md.
    // (Booking-linked check-ins go through the shared performBookingCheckIn()
    // above; this path intentionally remains its own implementation.)

    const walkInResult = await db.transaction(async (tx) => {
      // ── Not Paid — cancel the whole operation up front. Zero writes: no
      // booking, no attendance, no payment, no credit deduction, no ledger
      // entry. Nothing below this point in the transaction runs.
      if (settlementMode === "not_paid") {
        throw makeCheckInError(400, "walkin_not_paid", "This walk-in was not marked as paid — no records were created.");
      }

      // Step 1 — Duplicate attendance check (only when a class/schedule is given)
      if (classId != null || scheduleId != null) {
        // Serialize concurrent walk-in attempts for the SAME
        // student+class/schedule+day: the duplicate check below is a plain
        // SELECT (no row to lock — the very thing it's checking for may not
        // exist yet), so without this, two simultaneous requests can both
        // pass the check before either commits, producing double revenue
        // for a paid walk-in. A transaction-scoped advisory lock, released
        // automatically at commit/rollback, closes that window: the second
        // concurrent request blocks here until the first's transaction
        // resolves, then sees its committed attendance row and is correctly
        // rejected as a duplicate.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`walkin:${studentEmail}:${scheduleId ?? "c" + classId}:today`}))`);

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

      // ── Pay at Studio — explicit Admin choice. Package credits are never
      // queried or touched on this branch, even if the participant has one
      // or more valid packages: package availability must never influence
      // this path. performStudioWalkIn resolves the exact server-side price
      // and creates the canonical payment record + event atomically.
      if (settlementMode === "pay_at_studio") {
        const adminId = req.adminUser?.id;
        if (adminId == null) {
          throw makeCheckInError(401, "invalid_qr", "Authenticated admin identity is required to confirm a paid walk-in.");
        }
        const result = await performStudioWalkIn(tx, {
          studentName,
          studentEmail,
          studentId: studentId ?? null,
          classId: classId ?? null,
          scheduleId: scheduleId ?? null,
          adminId,
          performedBy,
        });
        return { kind: "paidWalkIn" as const, result };
      }

      // Step 2 — Credit deduction + ledger (with row-level lock). Only
      // reachable when the Admin explicitly chose "package_credit".
      let remainingCreditsAfterDeduction: number | null = null;
      if (settlementMode === "package_credit") {
        // Enforced by CheckInBodyExtended's superRefine, re-checked here so
        // the compiler (and runtime) never treats packageOrderId as present
        // just because settlementMode is "package_credit".
        if (packageOrderId == null) {
          throw makeCheckInError(400, "package_not_found", "packageOrderId is required when settlementMode is \"package_credit\".");
        }
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
          creditDeducted: settlementMode === "package_credit",
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

      if (settlementMode === "package_credit") {
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

      return { kind: "legacy" as const, row: inserted };
    });

    if (walkInResult.kind === "paidWalkIn") {
      const result = walkInResult.result;
      // Post-commit push dispatch — the transaction above has already
      // resolved successfully at this point, so this can only ever run
      // after the booking/payment_records/payment_events/attendance/
      // notification rows have actually committed. Mirrors the exact
      // boundary established in Phase 2B-1/2B-2.
      dispatchStudioWalkInPush(result.pendingPush);

      await logActivity(req, {
        action: "checkIn",
        module: "attendance",
        entityType: "attendance",
        entityId: result.attendanceId,
        entityLabel: result.studentName,
        after: {
          studentId: studentId ?? null,
          studentEmail: result.studentEmail,
          studentName: result.studentName,
          bookingId: result.bookingId,
          classId: classId ?? null,
          scheduleId: scheduleId ?? null,
          paymentRecordId: result.paymentRecordId,
          grossAmountMinor: result.grossAmountMinor,
          finalPayableAmountMinor: result.finalPayableAmountMinor,
          checkedInAt: result.checkedInAt,
        },
        summary: `Recorded paid Studio walk-in for ${result.studentName} (EGP ${(result.finalPayableAmountMinor / 100).toFixed(2)})`,
      });

      res.status(201).json({
        attendanceId: result.attendanceId,
        bookingId: result.bookingId,
        studentName: result.studentName,
        studentEmail: result.studentEmail,
        classTitle: classTitle ?? null,
        creditDeducted: false,
        remainingCredits: null,
        checkedInAt: result.checkedInAt,
        paid: true,
        finalPayableAmountMinor: result.finalPayableAmountMinor,
      });
      return;
    }

    const row = walkInResult.row;

    await logActivity(req, {
      action: "checkIn",
      module: "attendance",
      entityType: "attendance",
      entityId: row.id,
      entityLabel: row.studentName,
      after: {
        studentId: row.studentId,
        studentEmail: row.studentEmail,
        studentName: row.studentName,
        packageOrderId: row.packageOrderId,
        classId: row.classId,
        scheduleId: row.scheduleId,
        classTitle: row.classTitle,
        creditDeducted: row.creditDeducted,
        status: row.status,
        checkedInAt: row.checkedInAt,
      },
      summary: `Checked in ${row.studentName}${row.classTitle ? ` for ${row.classTitle}` : ""}`,
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
// Admin-only: studio-wide attendance aggregates (Security Assessment H-01).
router.get("/attendance/stats", requireAdminAuth, requireAdminPermission("attendance", "view"), async (req, res): Promise<void> => {
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
