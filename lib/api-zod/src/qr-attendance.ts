/**
 * Zod schemas for the QR Attendance feature (Step 2).
 *
 * These are hand-written (not generated) because the new endpoints are not yet
 * described in the OpenAPI spec. They live alongside the generated schemas and
 * are re-exported from the package index.
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
  classId: zod.number().nullish(),
  scheduleId: zod.number().nullish(),
});

export type CheckInBodyExtendedType = zod.infer<typeof CheckInBodyExtended>;
export type GetStudentByTokenResponseType = zod.infer<typeof GetStudentByTokenResponse>;
export type GetSchedulesTodayResponseItemType = zod.infer<typeof GetSchedulesTodayResponseItem>;
