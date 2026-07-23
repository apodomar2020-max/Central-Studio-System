/**
 * Admin Attendance gateway — unified account/candidate resolver plus a
 * program-dispatching confirm endpoint, sitting in front of the existing
 * Studio (checkInService.performBookingCheckIn) and Ballet
 * (balletAttendanceWrite.performBalletAttendanceWrite) write engines.
 *
 * GET-like discovery (resolve) never writes. Confirm ALWAYS re-fetches and
 * re-validates ownership + eligibility from the database — candidate ids
 * returned by resolve are treated as untrusted input, never as proof of
 * eligibility. It additionally recomputes the canonical candidateKey from
 * the server's own records (see attendanceResolver.ts's
 * computeStudioCandidateKey/computeBalletCandidateKey) and requires an exact
 * match before doing anything else — this is what prevents an admin
 * confirming Account A's candidateKey against Account B's ids, or replaying
 * a stale/yesterday's occurrence key.
 *
 * This is a LIVE operational check-in surface: the Ballet branch always
 * dispatches with source:"gateway", which forces status="checked_in" and a
 * server-computed (never client-supplied) currently addressable occurrence
 * date (including a next-day occurrence whose window opens before midnight)
 * inside performBalletAttendanceWrite — status/classDate/durationMinutes
 * are not read from the request body for Ballet at all.
 *
 * Permissions mirror the existing split rather than inventing a new model:
 *   - attendance:checkIn — required for every resolve/confirm call (base gate)
 *   - qr:scan            — additionally required to resolve via the QR source
 *   - qr:checkIn         — additionally required to confirm a Studio candidate
 *   - qr:packageDeduct   — additionally required when the Studio confirm uses
 *                          paymentMode=package_credit (mirrors checkIn.ts's
 *                          requirePackageDeductForQr exactly)
 */
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, studentsTable, bookingsTable, balletLevelAssignmentsTable, balletApplicationsTable, balletSchedulesTable } from "@workspace/db";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { logger } from "../lib/logger";
import { logActivity } from "../lib/activityLog";
import { computeBalletMonthlyAttendanceSummary } from "../lib/balletAttendance";
import { attendanceOccurrenceDateForWeeklySchedule, cairoNow } from "../lib/occurrence";
import { performBookingCheckIn, makeCheckInError, isCheckInError } from "../lib/checkInService";
import { performBalletAttendanceWrite, isBalletAttendanceError } from "../lib/balletAttendanceWrite";
import {
  resolveAttendanceCandidates,
  computeStudioCandidateKey,
  computeBalletCandidateKey,
  type ResolverSource,
} from "../lib/attendanceResolver";

const router: IRouter = Router();

const ResolveBody = z.object({
  source: z.enum(["qr", "phone", "childName"]),
  query: z.string().min(1, "query is required"),
});

function requireQrScanForQrSource(req: Request, res: Response, next: NextFunction): void {
  if (req.body?.source !== "qr") { next(); return; }
  requireAdminPermission("qr", "scan")(req, res, next);
}

router.post(
  "/admin/attendance/resolve",
  requireAdminAuth,
  requireAdminPermission("attendance", "checkIn"),
  requireQrScanForQrSource,
  async (req, res): Promise<void> => {
    const parsed = ResolveBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    const { source, query } = parsed.data as { source: ResolverSource; query: string };
    const result = await resolveAttendanceCandidates(source, query);
    res.json(result);
  },
);

// Ballet confirm intentionally accepts ONLY the ids needed to look up the
// candidate again — never status, classDate, or durationMinutes. Those are
// always derived/forced server-side inside performBalletAttendanceWrite
// (source:"gateway").
const ConfirmBody = z
  .object({
    candidateKey: z.string().min(1),
    program: z.enum(["studio", "ballet"]),
    accountId: z.number().int().positive(),
    source: z.enum(["qr", "phone", "childName"]),
    // Studio
    bookingId: z.number().int().positive().optional(),
    paymentMode: z.enum(["package_credit", "pay_at_studio"]).optional(),
    packageOrderId: z.number().int().positive().optional(),
    // Ballet — identity only, never business fields (status/date/duration).
    balletLevelAssignmentId: z.number().int().positive().optional(),
    balletScheduleId: z.number().int().positive().optional(),
    note: z.string().optional(),
  })
  .strict()
  .refine((b) => b.program !== "studio" || (b.bookingId != null && b.paymentMode != null), {
    message: "bookingId and paymentMode are required to confirm a Studio candidate",
  })
  .refine((b) => b.program !== "ballet" || (b.balletLevelAssignmentId != null && b.balletScheduleId != null), {
    message: "balletLevelAssignmentId and balletScheduleId are required to confirm a Ballet candidate",
  });

function requireQrCheckInForStudio(req: Request, res: Response, next: NextFunction): void {
  if (req.body?.program !== "studio") { next(); return; }
  requireAdminPermission("qr", "checkIn")(req, res, next);
}

function requirePackageDeductForStudioCredit(req: Request, res: Response, next: NextFunction): void {
  if (req.body?.program !== "studio" || req.body?.paymentMode !== "package_credit") { next(); return; }
  requireAdminPermission("qr", "packageDeduct")(req, res, next);
}

const AUDIT_SOURCE_LABEL: Record<ResolverSource, string> = {
  qr: "qr",
  phone: "parentPhone",
  childName: "childName",
};

router.post(
  "/admin/attendance/confirm",
  requireAdminAuth,
  requireAdminPermission("attendance", "checkIn"),
  requireQrCheckInForStudio,
  requirePackageDeductForStudioCredit,
  async (req: AdminRequest, res): Promise<void> => {
    const parsed = ConfirmBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    const body = parsed.data;
    const performedBy = req.adminUser?.email ?? "unknown";
    const now = new Date();
    const todayCairo = cairoNow(now).date;

    if (body.program === "studio") {
      try {
        const result = await db.transaction(async (tx) => {
          // Never trust the resolver response's account/participant identity —
          // re-derive the account fresh by its canonical id.
          const [account] = await tx.select().from(studentsTable).where(eq(studentsTable.id, body.accountId)).limit(1);
          if (!account) throw makeCheckInError(404, "invalid_qr", "Account not found.");

          const [booking] = await tx.select().from(bookingsTable).where(eq(bookingsTable.id, body.bookingId!)).for("update");
          if (!booking) throw makeCheckInError(404, "booking_not_found", "Booking not found.");
          if (booking.studentEmail !== account.email) {
            throw makeCheckInError(403, "booking_mismatch", "This booking does not belong to the resolved account.");
          }

          // CandidateKey binding: recompute from the SERVER's own resolved
          // booking (never the client's submitted occurrenceDate) and
          // require an exact match. A key minted for a different account,
          // booking, or occurrence date is rejected before any write.
          const expectedKey = computeStudioCandidateKey(body.accountId, booking.id, booking.occurrenceDate ?? todayCairo);
          if (expectedKey !== body.candidateKey) {
            throw makeCheckInError(409, "candidate_key_mismatch", "This selection is stale or was not issued for this account — please search again.");
          }

          return performBookingCheckIn(tx, {
            booking,
            student: { id: account.id, name: account.name, email: account.email },
            paymentMode: body.paymentMode!,
            packageOrderId: body.packageOrderId ?? null,
            performedBy,
            now,
          });
        });

        await logActivity(req, {
          action: "checkIn",
          module: "attendance",
          entityType: "attendance",
          entityId: result.attendanceId,
          entityLabel: result.studentName,
          after: {
            bookingId: body.bookingId, source: AUDIT_SOURCE_LABEL[body.source], program: "studio", accountId: body.accountId,
          },
          summary: `Recorded Studio attendance for ${result.studentName} via ${AUDIT_SOURCE_LABEL[body.source]}`,
        });

        res.status(201).json({ program: "studio", attendance: result });
      } catch (err: unknown) {
        if (isCheckInError(err)) {
          res.status(err.status).json({ error: err.code, message: err.message });
          return;
        }
        logger.error({ err, bookingId: body.bookingId }, "POST /admin/attendance/confirm (studio) failed");
        res.status(500).json({ error: "Failed to record attendance" });
      }
      return;
    }

    // program === "ballet"
    try {
      // Re-fetch the assignment's canonical child identity to recompute the
      // expected candidateKey — mirrors attendanceResolver.ts's own
      // childId derivation exactly (assignment.childId ?? application.childId
      // ?? application.id) so the two computations can never drift apart.
      const [assignmentRow] = await db
        .select({
          childId: balletLevelAssignmentsTable.childId,
          applicationId: balletLevelAssignmentsTable.applicationId,
          applicationChildId: balletApplicationsTable.childId,
        })
        .from(balletLevelAssignmentsTable)
        .innerJoin(balletApplicationsTable, eq(balletApplicationsTable.id, balletLevelAssignmentsTable.applicationId))
        .where(eq(balletLevelAssignmentsTable.id, body.balletLevelAssignmentId!))
        .limit(1);
      if (!assignmentRow) {
        res.status(404).json({ error: "assignment_not_found", message: "Level assignment not found." });
        return;
      }
      const [scheduleRow] = await db
        .select({
          dayOfWeek: balletSchedulesTable.dayOfWeek,
          startTime: balletSchedulesTable.startTime,
          endTime: balletSchedulesTable.endTime,
        })
        .from(balletSchedulesTable)
        .where(eq(balletSchedulesTable.id, body.balletScheduleId!))
        .limit(1);
      if (!scheduleRow) {
        res.status(404).json({ error: "invalid_schedule", message: "Ballet schedule not found." });
        return;
      }
      const occurrenceDate = attendanceOccurrenceDateForWeeklySchedule(scheduleRow, now);
      if (!occurrenceDate) {
        res.status(409).json({ error: "candidate_key_mismatch", message: "This occurrence is not currently available — please search again." });
        return;
      }
      const childId = assignmentRow.childId ?? assignmentRow.applicationChildId ?? assignmentRow.applicationId;
      const expectedKey = computeBalletCandidateKey(body.accountId, childId, body.balletLevelAssignmentId!, body.balletScheduleId!, occurrenceDate);
      if (expectedKey !== body.candidateKey) {
        res.status(409).json({ error: "candidate_key_mismatch", message: "This selection is stale or was not issued for this account — please search again." });
        return;
      }

      const result = await performBalletAttendanceWrite({
        levelAssignmentId: body.balletLevelAssignmentId!,
        balletScheduleId: body.balletScheduleId!,
        // Always the server-derived occurrence date — never read from the
        // client — matching what the resolver used to compute this exact
        // candidateKey a moment ago (including pre-midnight openings).
        classDate: occurrenceDate,
        status: "checked_in",
        note: body.note,
        performedBy,
        source: "gateway",
        // Never trust the resolver's earlier eligibility — re-validate that
        // this assignment genuinely belongs to the resolved account.
        ownerStudentId: body.accountId,
        now,
      });

      await logActivity(req, {
        action: "checkIn",
        module: "attendance",
        entityType: "ballet_attendance",
        entityId: result.attendance.id,
        entityLabel: result.childName,
        after: {
          levelAssignmentId: body.balletLevelAssignmentId, balletScheduleId: body.balletScheduleId,
          classDate: occurrenceDate, status: "checked_in", durationMinutes: result.attendance.durationMinutes,
          source: AUDIT_SOURCE_LABEL[body.source], program: "ballet", accountId: body.accountId,
        },
        summary: `Recorded ballet attendance (checked_in) for ${result.childName} on ${occurrenceDate} via ${AUDIT_SOURCE_LABEL[body.source]}`,
      });

      const attendanceSummary = await computeBalletMonthlyAttendanceSummary(
        body.balletLevelAssignmentId!,
        result.applicationId,
        occurrenceDate.slice(0, 7),
      );
      res.status(201).json({ program: "ballet", attendance: result.attendance, attendanceSummary });
    } catch (err: unknown) {
      if (isBalletAttendanceError(err)) {
        res.status(err.status).json({
          error: err.message,
          code: err.code,
          ...(err.existingAttendanceId != null ? { existingAttendanceId: err.existingAttendanceId } : {}),
        });
        return;
      }
      logger.error({ err, body }, "POST /admin/attendance/confirm (ballet) failed");
      res.status(500).json({ error: "Failed to record attendance" });
    }
  },
);

export default router;
