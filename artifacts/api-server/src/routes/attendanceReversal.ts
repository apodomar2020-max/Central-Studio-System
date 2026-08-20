/**
 * Wave 3: Admin route exposure for the Attendance Reversal service
 * (attendanceReversalService.ts). The service was already implemented and
 * integration-tested (eligibility rules, separation-of-duties, credit
 * restoration, expiration handling, integrity locks) but had no route
 * exposure anywhere in the repo prior to this wave. This file adds ONLY
 * the routes — it reuses every service guarantee unchanged and rewrites
 * none of its logic.
 *
 * Guards follow the existing "attendance" (view/edit) and
 * "finance"/"refundsManage" permission modules already used elsewhere
 * (e.g. ballet refunds, package refunds) — no new permission keys were
 * added. Approve/complete/fail additionally require finance.refundsManage
 * because the service's own separation-of-duties check
 * (REVERSAL_SEPARATION_OF_DUTIES_REQUIRED) is specifically about a
 * financial (cash-refund-implying) reversal, and this route cannot know in
 * advance whether a given reversal will turn out to require it — gating
 * conservatively on the stronger permission for those three actions is the
 * smallest safe choice instead of a per-request dynamic permission check.
 */
import { Router, type IRouter, type Response } from "express";
import { z } from "zod";
import {
  approveAttendanceReversal,
  AttendanceReversalServiceError,
  calculateAttendanceReversalEligibility,
  completeAttendanceReversal,
  failAttendanceReversal,
  rejectAttendanceReversal,
  requestAttendanceReversal,
} from "../lib/attendanceReversalService";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { logActivity } from "../lib/activityLog";

const router: IRouter = Router();
const idSchema = z.coerce.number().int().positive();
const noteSchema = z.string().trim().min(1).max(2_000);

const viewGuards = [requireAdminAuth, requireAdminPermission("attendance", "view")];
const requestGuards = [requireAdminAuth, requireAdminPermission("attendance", "edit")];
// Approve/complete/fail can move money (credit restoration / cash refund
// implication) — see file header for why this is the smallest safe static
// gate rather than a dynamic per-reversal check.
const financialGuards = [requireAdminAuth, requireAdminPermission("attendance", "edit"), requireAdminPermission("finance", "refundsManage")];

function parseId(req: AdminRequest, res: Response): number | null {
  const parsed = idSchema.safeParse(req.params.id);
  if (!parsed.success) { res.status(400).json({ error: "Invalid id" }); return null; }
  return parsed.data;
}

function actorId(req: AdminRequest): string {
  return `admin:${req.adminUser!.sub}`;
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof z.ZodError) { res.status(400).json({ error: "Validation failed", details: error.flatten() }); return; }
  if (error instanceof AttendanceReversalServiceError) {
    const status = error.code === "ATTENDANCE_REVERSAL_NOT_FOUND" ? 404
      : error.code === "ATTENDANCE_REVERSAL_NOT_ELIGIBLE" ? 422
      : error.code === "REVERSAL_SEPARATION_OF_DUTIES_REQUIRED" ? 403
      : 409;
    res.status(status).json({ error: error.code, message: error.message }); return;
  }
  res.status(500).json({ error: "INTERNAL_ERROR", message: "Attendance reversal operation failed." });
}

router.get("/admin/attendance/:id/reversal-eligibility", ...viewGuards, async (req: AdminRequest, res): Promise<void> => {
  const id = parseId(req, res); if (id == null) return;
  try { res.json(await calculateAttendanceReversalEligibility(id)); } catch (error) { sendError(res, error); }
});

const requestSchema = z.object({
  reasonCode: z.string().trim().min(1).max(100),
  reason: noteSchema,
  idempotencyKey: z.string().uuid(),
  notes: noteSchema.optional(),
}).strict();

router.post("/admin/attendance/:id/reversal-requests", ...requestGuards, async (req: AdminRequest, res): Promise<void> => {
  const id = parseId(req, res); if (id == null) return;
  try {
    const body = requestSchema.parse(req.body);
    const result = await requestAttendanceReversal({
      attendanceId: id,
      requestIdempotencyKey: body.idempotencyKey,
      reasonCode: body.reasonCode,
      reason: body.reason,
      requestedBy: actorId(req),
      notes: body.notes,
    });
    await logActivity(req, {
      action: "create",
      module: "attendance",
      entityType: "attendance_reversal",
      entityId: result.reversal.id,
      entityLabel: `Attendance reversal for attendance ${id}`,
      before: {},
      after: { status: result.reversal.status, attendanceId: id },
      summary: `Requested Attendance reversal for attendance ${id}`,
    });
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) { sendError(res, error); }
});

const reviewSchema = z.object({ notes: noteSchema.optional() }).strict();

router.post("/admin/attendance-reversals/:id/approve", ...financialGuards, async (req: AdminRequest, res): Promise<void> => {
  const id = parseId(req, res); if (id == null) return;
  try {
    const body = reviewSchema.parse(req.body);
    const result = await approveAttendanceReversal({ reversalId: id, approvedBy: actorId(req), notes: body.notes });
    await logActivity(req, {
      action: "approve", module: "attendance", entityType: "attendance_reversal", entityId: id,
      entityLabel: `Attendance reversal ${id}`, before: {}, after: { status: result.reversal.status },
      summary: `Approved Attendance reversal ${id}`,
    });
    res.json(result);
  } catch (error) { sendError(res, error); }
});

router.post("/admin/attendance-reversals/:id/reject", ...requestGuards, async (req: AdminRequest, res): Promise<void> => {
  const id = parseId(req, res); if (id == null) return;
  try {
    const body = reviewSchema.parse(req.body);
    const result = await rejectAttendanceReversal({ reversalId: id, rejectedBy: actorId(req), notes: body.notes });
    await logActivity(req, {
      action: "reject", module: "attendance", entityType: "attendance_reversal", entityId: id,
      entityLabel: `Attendance reversal ${id}`, before: {}, after: { status: result.reversal.status },
      summary: `Rejected Attendance reversal ${id}`,
    });
    res.json(result);
  } catch (error) { sendError(res, error); }
});

router.post("/admin/attendance-reversals/:id/complete", ...financialGuards, async (req: AdminRequest, res): Promise<void> => {
  const id = parseId(req, res); if (id == null) return;
  try {
    const result = await completeAttendanceReversal({ reversalId: id, completedBy: actorId(req) });
    await logActivity(req, {
      action: "complete", module: "attendance", entityType: "attendance_reversal", entityId: id,
      entityLabel: `Attendance reversal ${id}`, before: {},
      after: { restoredCreditTransactionId: result.restoredCreditTransactionId, restoredCreditUsable: result.restoredCreditUsable },
      summary: `Completed Attendance reversal ${id}`,
    });
    res.json(result);
  } catch (error) { sendError(res, error); }
});

const failSchema = z.object({ failedReason: noteSchema }).strict();

router.post("/admin/attendance-reversals/:id/fail", ...financialGuards, async (req: AdminRequest, res): Promise<void> => {
  const id = parseId(req, res); if (id == null) return;
  try {
    const body = failSchema.parse(req.body);
    // The service's AttendanceReversal shape has no dedicated failedReason
    // column (unlike payment_refunds) — it records failure detail in notes.
    const result = await failAttendanceReversal({ reversalId: id, failedBy: actorId(req), notes: body.failedReason });
    await logActivity(req, {
      action: "fail", module: "attendance", entityType: "attendance_reversal", entityId: id,
      entityLabel: `Attendance reversal ${id}`, before: {}, after: { status: result.reversal.status, failedReason: body.failedReason },
      summary: `Failed Attendance reversal ${id}`,
    });
    res.json(result);
  } catch (error) { sendError(res, error); }
});

export default router;
