/**
 * Hand-written Zod schemas for QR Attendance (Step 2) and Credit Ledger (Step N).
 *
 * Not auto-generated — these live alongside the generated schemas and are
 * re-exported from the package index.
 */
import * as zod from "zod";

// ---------------------------------------------------------------------------
// GET /api/students/by-token/:token
// ---------------------------------------------------------------------------

export const GetStudentByTokenParams = zod.object({
  token: zod.string().uuid("QR token must be a valid UUID"),
});

/** One active package returned alongside the student profile. */
export const StudentActivePackage = zod.object({
  id: zod.number(),
  packageName: zod.string(),
  totalCredits: zod.number(),
  remainingCredits: zod.number(),
  expiresAt: zod.string().nullish(),
});

export const GetStudentByTokenResponse = zod.object({
  id: zod.number(),
  name: zod.string(),
  email: zod.string(),
  phone: zod.string().nullish(),
  joinedAt: zod.string(),
  activePackages: zod.array(StudentActivePackage),
});

// ---------------------------------------------------------------------------
// GET /api/schedules/today
// ---------------------------------------------------------------------------

export const GetSchedulesTodayResponseItem = zod.object({
  scheduleId: zod.number(),
  classId: zod.number(),
  classTitle: zod.string(),
  startTime: zod.string(),
  endTime: zod.string(),
  location: zod.string().nullish(),
  instructorName: zod.string().nullish(),
});

export const GetSchedulesTodayResponse = zod.array(GetSchedulesTodayResponseItem);

// ---------------------------------------------------------------------------
// POST /api/attendance  (extended — backwards compatible)
// ---------------------------------------------------------------------------

/**
 * Superset of the generated CheckInBody.
 *
 * The three new optional fields (studentId, classId, scheduleId) are used
 * by the updated QR scanner flow.  Requests that omit them (existing mobile
 * and admin flows) continue to work without any changes.
 */
export const CheckInBodyExtended = zod.object({
  studentEmail: zod.string(),
  studentName: zod.string(),
  packageOrderId: zod.number().nullish(),
  classTitle: zod.string().nullish(),
  creditDeducted: zod.boolean().optional(),
  notes: zod.string().nullish(),
  // QR attendance additions (all optional)
  studentId: zod.number().nullish(),
  participantType: zod.enum(["self", "child"]).optional(),
  participantChildId: zod.number().int().positive().nullish(),
  classId: zod.number().nullish(),
  scheduleId: zod.number().nullish(),
  // Credit ledger additions (all optional — backward-compat with existing callers)
  bookingId: zod.number().nullish(),
  checkedInBy: zod.string().nullish(),
  status: zod.enum(["checked_in", "late", "absent", "cancelled"]).optional(),
  // Finance Phase 2B-4 (Studio Walk-in Atomic Monetary Capture) — retained
  // for the booking-based (bookingId != null) path only. On the walk-in
  // path this is superseded by `settlementMode` below; the route no longer
  // reads `paid` on the walk-in branch.
  paid: zod.boolean().optional(),
  // Explicit Walk-in settlement discriminator (mandatory for walk-in
  // requests — i.e. whenever bookingId is omitted). There is NO default:
  // the mere existence of a valid package credit must never select
  // "package_credit" on its own, and the server must never infer this
  // value from payment status, package availability, or participant
  // state — it must come from an explicit Admin choice. See
  // STUDIO_WALKIN_EXPLICIT_SETTLEMENT_POLICY.md.
  settlementMode: zod.enum(["package_credit", "pay_at_studio", "not_paid"]).optional(),
}).superRefine((body, ctx) => {
  // "absent" is a no-show status record, not an arrival — it is not a
  // Studio Walk-in in the payment-settlement sense (no attendance-linked
  // arrival is happening), so it is exempt from the mandatory settlement
  // choice. Every other no-booking submission (an actual arrival — the
  // default "checked_in", or "late") is a genuine Walk-in and requires it.
  if (body.bookingId == null && body.status !== "absent" && body.settlementMode == null) {
    ctx.addIssue({
      code: zod.ZodIssueCode.custom,
      path: ["settlementMode"],
      message:
        "settlementMode is required for a Studio Walk-in check-in (\"package_credit\" | \"pay_at_studio\" | \"not_paid\") — there is no default.",
    });
  }
  if (
    body.bookingId == null &&
    body.settlementMode === "package_credit" &&
    body.packageOrderId == null
  ) {
    ctx.addIssue({
      code: zod.ZodIssueCode.custom,
      path: ["packageOrderId"],
      message: "packageOrderId is required when settlementMode is \"package_credit\".",
    });
  }
  if (body.bookingId == null && body.participantType === "self" && body.participantChildId != null) {
    ctx.addIssue({
      code: zod.ZodIssueCode.custom,
      path: ["participantChildId"],
      message: "Self attendance cannot include a child ID.",
    });
  }
  if (body.bookingId == null && body.participantType === "child" && body.participantChildId == null) {
    ctx.addIssue({
      code: zod.ZodIssueCode.custom,
      path: ["participantChildId"],
      message: "Child attendance requires participantChildId.",
    });
  }
});

export const CreditTransactionRecord = zod.object({
  id: zod.number(),
  packageOrderId: zod.number(),
  studentId: zod.number().nullish(),
  type: zod.string(),
  delta: zod.number(),
  balanceBefore: zod.number(),
  balanceAfter: zod.number(),
  referenceId: zod.number().nullish(),
  referenceType: zod.string().nullish(),
  notes: zod.string().nullish(),
  createdBy: zod.string(),
  createdAt: zod.string(),
});

// ---------------------------------------------------------------------------
// GET /api/admin/attendance/history  (paginated attendance history)
// ---------------------------------------------------------------------------

export const ListAttendanceHistoryQueryParams = zod.object({
  studentEmail: zod.string().optional(),
  dateFrom: zod.string().optional(),
  dateTo: zod.string().optional(),
  page: zod.coerce.number().int().min(1).optional(),
  limit: zod.coerce.number().int().min(1).max(100).optional(),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CheckInBodyExtendedType = zod.infer<typeof CheckInBodyExtended>;
export type CreditTransactionRecordType = zod.infer<typeof CreditTransactionRecord>;
export type GetStudentByTokenResponseType = zod.infer<typeof GetStudentByTokenResponse>;
export type GetSchedulesTodayResponseItemType = zod.infer<typeof GetSchedulesTodayResponseItem>;
