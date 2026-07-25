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
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, studentsTable, bookingsTable, balletLevelAssignmentsTable, balletApplicationsTable, balletSchedulesTable, schedulesTable, childrenTable, attendanceTable } from "@workspace/db";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { logger } from "../lib/logger";
import { logActivity } from "../lib/activityLog";
import { computeBalletMonthlyAttendanceSummary } from "../lib/balletAttendance";
import { attendanceOccurrenceDateForWeeklySchedule, cairoNow, checkInWindowState } from "../lib/occurrence";
import { performBookingCheckIn, performStudioWalkIn, dispatchStudioWalkInPush, makeCheckInError, isCheckInError } from "../lib/checkInService";
import { performBalletAttendanceWrite, isBalletAttendanceError } from "../lib/balletAttendanceWrite";
import {
  resolveAttendanceCandidates,
  computeStudioCandidateKey,
  computeStudioWalkInCandidateKey,
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
    // Studio — existing-booking check-in.
    bookingId: z.number().int().positive().optional(),
    paymentMode: z.enum(["package_credit", "pay_at_studio"]).optional(),
    packageOrderId: z.number().int().positive().optional(),
    // Studio WALK-IN (Finance Phase 2B-4, full flow) — no pre-existing
    // booking. scheduleId identifies the occurrence the Admin selected;
    // `paid` is the mandatory Paid/Not Paid confirmation, required only
    // when paymentMode is pay_at_studio (a package_credit walk-in reuses
    // the existing credit flow and never needs it). childId identifies a
    // child walk-in (validated server-side against childrenTable.parentId
    // — never trusted blindly). expectedPriceEgp is the price the resolve()
    // response displayed to the Admin; confirm() re-resolves the real price
    // and rejects with 409 walkin_price_changed if it no longer matches.
    scheduleId: z.number().int().positive().optional(),
    paid: z.boolean().optional(),
    childId: z.number().int().positive().optional(),
    expectedPriceEgp: z.number().nonnegative().optional(),
    // Ballet — identity only, never business fields (status/date/duration).
    balletLevelAssignmentId: z.number().int().positive().optional(),
    balletScheduleId: z.number().int().positive().optional(),
    note: z.string().optional(),
  })
  .strict()
  .refine((b) => b.program !== "studio" || b.paymentMode != null, {
    message: "paymentMode is required to confirm a Studio candidate",
  })
  .refine((b) => b.program !== "studio" || (b.bookingId != null) !== (b.scheduleId != null), {
    message: "Exactly one of bookingId (existing booking) or scheduleId (walk-in) is required to confirm a Studio candidate",
  })
  .refine((b) => b.program !== "studio" || b.scheduleId == null || b.paymentMode !== "pay_at_studio" || b.paid != null, {
    message: "A Paid/Not Paid confirmation (paid:true|false) is required for a pay-at-studio walk-in",
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

    if (body.program === "studio" && body.bookingId != null) {
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

    // ── Studio WALK-IN confirm (Finance Phase 2B-4, full flow) ─────────────
    // No pre-existing booking: the Admin selected a live schedule occurrence
    // through the SAME gateway resolve() step (walk-in candidates —
    // attendanceResolver.ts's buildStudioWalkInCandidates). Package Credit
    // reuses the existing performBookingCheckIn credit/ledger path exactly,
    // after creating the synthetic booking it operates on. A pay-at-studio
    // walk-in with paid:false aborts before any write. paid:true delegates
    // to performStudioWalkIn, which performs the entire atomic capture.
    if (body.program === "studio" && body.scheduleId != null) {
      try {
        const walkInResult = await db.transaction(async (tx) => {
          const [account] = await tx.select().from(studentsTable).where(eq(studentsTable.id, body.accountId)).limit(1);
          if (!account) throw makeCheckInError(404, "invalid_qr", "Account not found.");

          // Child identity, when this walk-in is for a child — validated
          // against the existing parent/child ownership model, never
          // trusted blindly from the request body. An unrelated/foreign
          // child id is rejected before any write.
          let participantName = account.name;
          let childId: number | null = null;
          if (body.childId != null) {
            const [child] = await tx
              .select({ id: childrenTable.id, fullName: childrenTable.fullName })
              .from(childrenTable)
              .where(and(eq(childrenTable.id, body.childId), eq(childrenTable.parentId, account.id)))
              .limit(1);
            if (!child) throw makeCheckInError(403, "booking_mismatch", "This child does not belong to the resolved account.");
            childId = child.id;
            participantName = child.fullName;
          }

          const [schedule] = await tx
            .select({
              id: schedulesTable.id,
              classId: schedulesTable.classId,
              status: schedulesTable.status,
              type: schedulesTable.type,
              date: schedulesTable.date,
              dayOfWeek: schedulesTable.dayOfWeek,
              startTime: schedulesTable.startTime,
              endTime: schedulesTable.endTime,
            })
            .from(schedulesTable)
            .where(eq(schedulesTable.id, body.scheduleId!))
            .for("update");
          if (!schedule) throw makeCheckInError(404, "booking_not_found", "Schedule not found.");
          if (schedule.status !== "active") throw makeCheckInError(400, "booking_not_actionable", "This schedule is not currently active.");

          const occurrenceDate = schedule.type === "one_time"
            ? schedule.date
            : schedule.dayOfWeek != null
              ? attendanceOccurrenceDateForWeeklySchedule({ dayOfWeek: schedule.dayOfWeek, startTime: schedule.startTime, endTime: schedule.endTime }, now)
              : null;
          if (!occurrenceDate) throw makeCheckInError(400, "not_todays_occurrence", "This schedule has no valid occurrence available right now.");

          const windowState = checkInWindowState({ startTime: schedule.startTime, endTime: schedule.endTime }, occurrenceDate, now);
          if (windowState === "too_early") throw makeCheckInError(400, "check_in_too_early", "Check-in for this class opens 2 hours before it starts.");
          if (windowState !== "open") throw makeCheckInError(400, "check_in_closed", "Check-in for this class is not currently open.");

          // CandidateKey binding — the walk-in equivalent of the
          // existing-booking check above: recomputed from the server's own
          // resolved schedule/occurrence/child, never the client's.
          const expectedKey = computeStudioWalkInCandidateKey(body.accountId, childId, schedule.id, occurrenceDate);
          if (expectedKey !== body.candidateKey) {
            throw makeCheckInError(409, "candidate_key_mismatch", "This selection is stale or was not issued for this account — please search again.");
          }

          // Serialize concurrent/replayed confirmations for the SAME
          // account+child+schedule+day — mirrors the identical fix already
          // applied to the direct POST /attendance walk-in path (see
          // attendance.ts). Without this, two near-simultaneous confirms
          // (or a naive client retry after a slow response) could both pass
          // the duplicate check below before either commits.
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`walkin:${account.email}:${schedule.id}:${childId ?? "self"}:${occurrenceDate}`}))`);

          const [existingAttendance] = await tx
            .select({ id: attendanceTable.id })
            .from(attendanceTable)
            .where(and(
              eq(attendanceTable.studentEmail, account.email),
              eq(attendanceTable.scheduleId, schedule.id),
              sql`(${attendanceTable.checkedInAt} AT TIME ZONE 'Africa/Cairo')::date = (now() AT TIME ZONE 'Africa/Cairo')::date`,
            ))
            .limit(1);
          if (existingAttendance) {
            throw makeCheckInError(409, "duplicate_attendance", "This participant has already been checked in for this class today.");
          }

          if (body.paymentMode === "package_credit") {
            // Reuse the EXISTING package lock + credit-ledger flow exactly:
            // create the required synthetic booking first (status
            // "confirmed", matching what performBookingCheckIn requires of
            // any booking it processes), then hand off to the same shared
            // function existing-booking check-ins use. No credit logic is
            // duplicated here.
            const [syntheticBooking] = await tx
              .insert(bookingsTable)
              .values({
                studentName: participantName,
                studentEmail: account.email,
                accountOwnerStudentId: account.id,
                participantChildId: childId,
                bookingScope: childId != null ? "child" : "self",
                scheduleId: schedule.id,
                classId: schedule.classId,
                occurrenceDate,
                paymentMode: "package_credit",
                bookingStatus: "confirmed",
                paymentStatus: "not_required",
                status: "confirmed",
                notes: "Studio walk-in (package credit)",
              })
              .returning();

            const creditResult = await performBookingCheckIn(tx, {
              booking: syntheticBooking,
              student: { id: account.id, name: account.name, email: account.email },
              paymentMode: "package_credit",
              packageOrderId: body.packageOrderId ?? null,
              performedBy,
              now,
            });
            return { kind: "credit" as const, result: creditResult, bookingId: syntheticBooking.id };
          }

          // pay_at_studio — the mandatory Paid/Not Paid confirmation.
          if (body.paid !== true) {
            throw makeCheckInError(400, "walkin_not_paid", "This walk-in was not marked as paid — no records were created.");
          }
          const paidResult = await performStudioWalkIn(tx, {
            studentName: participantName,
            studentEmail: account.email,
            studentId: account.id,
            childId,
            classId: schedule.classId,
            scheduleId: schedule.id,
            adminId: req.adminUser!.id,
            performedBy,
            expectedPriceEgp: body.expectedPriceEgp ?? null,
            now,
          });
          return { kind: "paid" as const, result: paidResult };
        });

        if (walkInResult.kind === "paid") {
          dispatchStudioWalkInPush(walkInResult.result.pendingPush);
          await logActivity(req, {
            action: "checkIn",
            module: "attendance",
            entityType: "attendance",
            entityId: walkInResult.result.attendanceId,
            entityLabel: walkInResult.result.studentName,
            after: {
              scheduleId: body.scheduleId, source: AUDIT_SOURCE_LABEL[body.source], program: "studio", accountId: body.accountId,
              bookingId: walkInResult.result.bookingId, paymentRecordId: walkInResult.result.paymentRecordId,
              finalPayableAmountMinor: walkInResult.result.finalPayableAmountMinor,
            },
            summary: `Recorded paid Studio walk-in for ${walkInResult.result.studentName} (EGP ${(walkInResult.result.finalPayableAmountMinor / 100).toFixed(2)}) via ${AUDIT_SOURCE_LABEL[body.source]}`,
          });
          res.status(201).json({
            program: "studio",
            attendance: {
              attendanceId: walkInResult.result.attendanceId,
              bookingId: walkInResult.result.bookingId,
              studentName: walkInResult.result.studentName,
              studentEmail: walkInResult.result.studentEmail,
              creditDeducted: false,
              remainingCredits: null,
              checkedInAt: walkInResult.result.checkedInAt,
              paid: true,
              finalPayableAmountMinor: walkInResult.result.finalPayableAmountMinor,
            },
          });
          return;
        }

        // kind === "credit"
        await logActivity(req, {
          action: "checkIn",
          module: "attendance",
          entityType: "attendance",
          entityId: walkInResult.result.attendanceId,
          entityLabel: walkInResult.result.studentName,
          after: {
            scheduleId: body.scheduleId, source: AUDIT_SOURCE_LABEL[body.source], program: "studio", accountId: body.accountId,
            bookingId: walkInResult.bookingId, packageOrderId: body.packageOrderId ?? null,
          },
          summary: `Recorded Studio walk-in attendance (package credit) for ${walkInResult.result.studentName} via ${AUDIT_SOURCE_LABEL[body.source]}`,
        });
        res.status(201).json({ program: "studio", attendance: walkInResult.result });
      } catch (err: unknown) {
        if (isCheckInError(err)) {
          res.status(err.status).json({ error: err.code, message: err.message });
          return;
        }
        logger.error({ err, scheduleId: body.scheduleId }, "POST /admin/attendance/confirm (studio walk-in) failed");
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
