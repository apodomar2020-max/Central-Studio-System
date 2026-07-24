import { blockStudentJwt } from "../middlewares/auth";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import * as zod from "zod";
import { db, attendanceTable, bookingsTable, studentsTable, schedulesTable, balletClassesTable } from "@workspace/db";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { performBookingCheckIn, makeCheckInError, isCheckInError } from "../lib/checkInService";
import { listStudioWalkInOptions, performStudioWalkInCheckIn, type StudioWalkInPaymentDecision } from "../lib/studioWalkIn";
import { flushPushQueue } from "../lib/notifications";
import { logActivity, adminActivityActor } from "../lib/activityLog";
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

  // classTitle falls back to the linked Ballet Class's title when the raw
  // stored column is null — Ballet writes (balletAttendanceWrite.ts) only
  // ever populate balletClassId, never this denormalized text column
  // directly, so every Ballet row used to render "—" here. program is
  // derived from balletLevelAssignmentId, the same discriminator
  // balletAttendance.ts's own monthly-hours computation uses.
  const projection = {
    id: attendanceTable.id,
    studentName: attendanceTable.studentName,
    studentEmail: attendanceTable.studentEmail,
    packageOrderId: attendanceTable.packageOrderId,
    classTitle: sql<string | null>`coalesce(${attendanceTable.classTitle}, ${balletClassesTable.title})`,
    creditDeducted: attendanceTable.creditDeducted,
    notes: attendanceTable.notes,
    studentId: attendanceTable.studentId,
    classId: attendanceTable.classId,
    scheduleId: attendanceTable.scheduleId,
    bookingId: attendanceTable.bookingId,
    checkedInBy: attendanceTable.checkedInBy,
    status: attendanceTable.status,
    checkedInAt: attendanceTable.checkedInAt,
    createdAt: attendanceTable.createdAt,
    updatedAt: attendanceTable.updatedAt,
    program: sql<"studio" | "ballet">`case when ${attendanceTable.balletLevelAssignmentId} is not null then 'ballet' else 'studio' end`,
    durationMinutes: attendanceTable.durationMinutes,
  };

  const rows = whereClause
    ? await db
        .select(projection)
        .from(attendanceTable)
        .leftJoin(balletClassesTable, eq(attendanceTable.balletClassId, balletClassesTable.id))
        .where(whereClause)
        .orderBy(desc(attendanceTable.checkedInAt))
        .limit(pageSize)
        .offset(offset)
    : await db
        .select(projection)
        .from(attendanceTable)
        .leftJoin(balletClassesTable, eq(attendanceTable.balletClassId, balletClassesTable.id))
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
// Two entry points, both delegating to a shared engine rather than
// reimplementing business logic:
//   - bookingId supplied  → performBookingCheckIn() (checkInService.ts) —
//     identical to QR / the Unified Attendance gateway's booked-candidate path.
//   - no bookingId        → performStudioWalkInCheckIn() (studioWalkIn.ts) —
//     identical to the Unified Attendance gateway's Walk-in path. Requires a
//     canonical scheduleId AND a resolved studentId; a free-text-only legacy
//     payload (no scheduleId, e.g. a client's "manual schedule" fallback) or
//     an unregistered walk-in (no studentId) is rejected with
//     {error:"deprecated_contract"} rather than written as untracked text.
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

      // Post-commit only — a rolled-back check-in never reaches this line.
      const { pendingPushJobs, ...responseBody } = result;
      await flushPushQueue(pendingPushJobs);
      res.status(201).json(responseBody);
      return;
    }

    // ── WALK-IN check-in (no booking) — delegates to the canonical Studio
    // Walk-in engine (lib/studioWalkIn.ts), the SAME one the Unified
    // Attendance gateway's /admin/attendance/walk-in/confirm uses. This route
    // is kept only for backward compatibility with existing callers
    // (scan-check-in-dialog.tsx's Path B) — it is no longer a second,
    // divergent business engine. A payload that cannot be mapped to a real
    // canonical Schedule occurrence AND a real, resolved Account is rejected
    // outright: free-text Class entry (no scheduleId) and unregistered
    // walk-ins (no studentId) are no longer accepted here.
    if (scheduleId == null || studentId == null) {
      res.status(422).json({
        error: "deprecated_contract",
        message: "Walk-in check-in now requires a real Schedule and a resolved Account — free-text class entry is no longer supported. Use the Check In Student → Record Walk-in flow instead.",
      });
      return;
    }

    const [scheduleRow] = await db
      .select({ classId: schedulesTable.classId })
      .from(schedulesTable)
      .where(eq(schedulesTable.id, scheduleId))
      .limit(1);
    if (!scheduleRow) {
      res.status(422).json({ error: "deprecated_contract", message: "The selected Schedule could not be found." });
      return;
    }

    // occurrenceDate has no field on this legacy payload — re-derived
    // canonically the same way the Walk-in options list does, and rejected
    // if this Schedule isn't a currently-eligible Walk-in occurrence for
    // this account (covers window state, active Class/Schedule, and an
    // already-existing Booking or Attendance for the same occurrence).
    const nowForWalkIn = new Date();
    const walkInOptions = await listStudioWalkInOptions(studentId, null, nowForWalkIn);
    const matchingOption = walkInOptions.find((o) => o.scheduleId === scheduleId);
    if (!matchingOption) {
      res.status(422).json({
        error: "deprecated_contract",
        message: "This Schedule is not currently an eligible Walk-in occurrence for this Account.",
      });
      return;
    }

    const paymentDecision: StudioWalkInPaymentDecision =
      creditDeducted && packageOrderId != null
        ? { type: "package_credit", packageOrderId }
        : { type: "paid_at_studio" };

    const result = await performStudioWalkInCheckIn({
      accountId: studentId,
      participantChildId: null,
      classId: scheduleRow.classId,
      scheduleId,
      occurrenceDate: matchingOption.occurrenceDate,
      payment: paymentDecision,
      actor: adminActivityActor(req),
      now: nowForWalkIn,
    });

    res.status(201).json(result);
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

  // Status/program breakdown — computed once, alongside the existing
  // time-bucketed trend below, not instead of it. checked_in/late are the
  // only statuses that represent actual attendance; absent is its opposite,
  // and cancelled represents neither Studio Credit nor Ballet-hours
  // consumption (matches balletAttendance.ts's own exclusion rule).
  let checkedInCount = 0;
  let lateCount = 0;
  let absentCount = 0;
  let cancelledCount = 0;
  let studioCreditsConsumed = 0;
  let balletMinutesConsumed = 0;
  for (const row of rows) {
    const isBallet = row.balletLevelAssignmentId != null;
    if (row.status === "checked_in") checkedInCount += 1;
    else if (row.status === "late") lateCount += 1;
    else if (row.status === "absent") absentCount += 1;
    else if (row.status === "cancelled") cancelledCount += 1;

    if (row.status === "cancelled") continue;
    if (isBallet) {
      if (row.status === "checked_in" || row.status === "late" || row.status === "absent") {
        balletMinutesConsumed += row.durationMinutes ?? 0;
      }
    } else if (row.creditDeducted) {
      studioCreditsConsumed += 1;
    }
  }

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
  res.json({
    period,
    total,
    data,
    checkedInCount,
    lateCount,
    absentCount,
    cancelledCount,
    studioCreditsConsumed,
    balletMinutesConsumed,
  });
});

export default router;
