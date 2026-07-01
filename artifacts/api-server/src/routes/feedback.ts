import { blockStudentJwt } from "../middlewares/auth";
import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  attendanceTable,
  bookingsTable,
  childrenTable,
  classesTable,
  danceTypesTable,
  db,
  feedbackTable,
  instructorsTable,
  schedulesTable,
  studentsTable,
} from "@workspace/db";
import { hasRolePermission } from "@workspace/api-zod";
import { requireStudentAuth, requireVerifiedStudent } from "../middlewares/studentAuth";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";

const router: IRouter = Router();

const FEEDBACK_ELIGIBLE_ATTENDANCE_STATUSES = ["checked_in", "late"] as const;
const REVIEW_STATUSES = ["pending", "in_review", "resolved", "dismissed"] as const;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function ownsAttendance(studentId: number, studentEmail: string) {
  return or(
    eq(attendanceTable.studentId, studentId),
    sql`lower(trim(${attendanceTable.studentEmail})) = ${normalizeEmail(studentEmail)}`,
  );
}

function isFeedbackDue() {
  return sql`${attendanceTable.checkedInAt} <= now() - interval '3 hours'`;
}

function isEligibleAttendanceStatus() {
  return inArray(attendanceTable.status, [...FEEDBACK_ELIGIBLE_ATTENDANCE_STATUSES]);
}

function parseDbTimestamp(value: string): Date | null {
  const raw = value.trim();
  const normalized = raw
    .replace(/^(\d{4}-\d{2}-\d{2})\s+/, "$1T")
    .replace(/([+-]\d{2})$/, "$1:00")
    .replace(/\+00:00$/, "Z");
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? date : null;
}

function toIsoTimestamp(value: string): string {
  return parseDbTimestamp(value)?.toISOString() ?? value;
}

function addHoursIso(value: string, hours: number): string {
  const date = parseDbTimestamp(value);
  if (!date) return value;
  return new Date(date.getTime() + hours * 60 * 60 * 1000).toISOString();
}

function scheduleLabel(row: {
  scheduleType: string | null;
  scheduleDayOfWeek: number | null;
  scheduleDate: string | null;
  scheduleStartTime: string | null;
  scheduleEndTime: string | null;
}): string | null {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const day =
    row.scheduleType === "one_time"
      ? row.scheduleDate
      : row.scheduleDayOfWeek == null
        ? null
        : days[row.scheduleDayOfWeek] ?? null;
  if (!day && !row.scheduleStartTime) return null;
  return [day, [row.scheduleStartTime, row.scheduleEndTime].filter(Boolean).join(" - ")]
    .filter(Boolean)
    .join(" • ");
}

function adminCanViewComments(req: AdminRequest): boolean {
  const admin = req.adminUser;
  return Boolean(admin?.isSuperAdmin || hasRolePermission(admin?.permissions, "feedback", "viewComments"));
}

const RequiredFeedbackQuery = z.object({
  limit: z.coerce.number().int().min(1).max(20).optional(),
});

router.get("/my/feedback/required", requireStudentAuth, requireVerifiedStudent, async (req, res): Promise<void> => {
  const query = RequiredFeedbackQuery.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const studentId = req.studentId!;
  const studentEmail = req.studentEmail ?? "";
  const limit = query.data.limit ?? 10;

  const rows = await db
    .select({
      attendanceId: attendanceTable.id,
      checkedInAt: attendanceTable.checkedInAt,
      studentName: attendanceTable.studentName,
      classId: sql<number | null>`coalesce(${attendanceTable.classId}, ${bookingsTable.classId})`,
      scheduleId: sql<number | null>`coalesce(${attendanceTable.scheduleId}, ${bookingsTable.scheduleId})`,
      bookingId: attendanceTable.bookingId,
      classTitle: sql<string | null>`coalesce(${attendanceTable.classTitle}, ${classesTable.title})`,
      instructorName: instructorsTable.name,
      instructorPhotoUrl: instructorsTable.photoUrl,
      danceTypeName: sql<string | null>`coalesce(${danceTypesTable.name}, ${classesTable.category})`,
      scheduleType: schedulesTable.type,
      scheduleDayOfWeek: schedulesTable.dayOfWeek,
      scheduleDate: schedulesTable.date,
      scheduleStartTime: schedulesTable.startTime,
      scheduleEndTime: schedulesTable.endTime,
      scheduleLocation: schedulesTable.location,
      childName: childrenTable.fullName,
    })
    .from(attendanceTable)
    .leftJoin(feedbackTable, eq(feedbackTable.attendanceId, attendanceTable.id))
    .leftJoin(bookingsTable, eq(attendanceTable.bookingId, bookingsTable.id))
    .leftJoin(childrenTable, eq(bookingsTable.participantChildId, childrenTable.id))
    .leftJoin(classesTable, sql`${classesTable.id} = coalesce(${attendanceTable.classId}, ${bookingsTable.classId})`)
    .leftJoin(instructorsTable, eq(classesTable.instructorId, instructorsTable.id))
    .leftJoin(danceTypesTable, eq(classesTable.danceTypeId, danceTypesTable.id))
    .leftJoin(schedulesTable, sql`${schedulesTable.id} = coalesce(${attendanceTable.scheduleId}, ${bookingsTable.scheduleId})`)
    .where(and(
      ownsAttendance(studentId, studentEmail),
      isEligibleAttendanceStatus(),
      isFeedbackDue(),
      isNull(feedbackTable.id),
    ))
    .orderBy(desc(attendanceTable.checkedInAt))
    .limit(limit);

  res.json({
    data: rows.map((row) => ({
      attendanceId: row.attendanceId,
      checkedInAt: toIsoTimestamp(row.checkedInAt),
      dueAt: addHoursIso(row.checkedInAt, 3),
      studentName: row.studentName,
      childName: row.childName,
      classId: row.classId,
      scheduleId: row.scheduleId,
      bookingId: row.bookingId,
      classTitle: row.classTitle ?? "Class",
      instructorName: row.instructorName ?? "Trainer",
      instructorPhotoUrl: row.instructorPhotoUrl,
      danceTypeName: row.danceTypeName ?? null,
      scheduleLabel: scheduleLabel(row),
      location: row.scheduleLocation,
      alreadySubmitted: false,
    })),
  });
});

const SubmitFeedbackBody = z.object({
  attendanceId: z.coerce.number().int().positive(),
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().trim().max(3000).optional().nullable(),
  tags: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
  clientSubmissionId: z.string().trim().min(8).max(160),
  submittedAt: z.string().datetime().optional().nullable(),
});

function publicFeedback(row: typeof feedbackTable.$inferSelect) {
  return {
    id: row.id,
    attendanceId: row.attendanceId,
    rating: row.rating,
    reviewStatus: row.reviewStatus,
    submittedAt: row.submittedAt,
    receivedAt: row.receivedAt,
  };
}

function feedbackBelongsToStudent(row: typeof feedbackTable.$inferSelect, studentId: number, studentEmail: string): boolean {
  return row.studentId === studentId || normalizeEmail(row.studentEmailSnapshot) === normalizeEmail(studentEmail);
}

router.post("/my/feedback", requireStudentAuth, requireVerifiedStudent, async (req, res): Promise<void> => {
  const parsed = SubmitFeedbackBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { attendanceId, rating, clientSubmissionId } = parsed.data;
  const comment = parsed.data.comment?.trim() ?? "";
  if (rating <= 2 && comment.length === 0) {
    res.status(400).json({ error: "Comment is required for 1-2 star ratings." });
    return;
  }

  const studentId = req.studentId!;
  const studentEmail = req.studentEmail ?? "";

  const existingByClient = await db
    .select()
    .from(feedbackTable)
    .where(eq(feedbackTable.clientSubmissionId, clientSubmissionId))
    .limit(1);
  if (existingByClient[0]) {
    const row = existingByClient[0];
    if (!feedbackBelongsToStudent(row, studentId, studentEmail)) {
      res.status(403).json({ error: "Feedback submission does not belong to this student." });
      return;
    }
    res.json(publicFeedback(row));
    return;
  }

  try {
    const inserted = await db.transaction(async (tx) => {
      const [existingForAttendance] = await tx
        .select()
        .from(feedbackTable)
        .where(eq(feedbackTable.attendanceId, attendanceId))
        .limit(1);
      if (existingForAttendance) {
        if (!feedbackBelongsToStudent(existingForAttendance, studentId, studentEmail)) {
          throw Object.assign(new Error("Feedback submission does not belong to this student."), { status: 403 });
        }
        return existingForAttendance;
      }

      const [lockedAttendance] = await tx
        .select({
          id: attendanceTable.id,
          checkedInAt: attendanceTable.checkedInAt,
          status: attendanceTable.status,
        })
        .from(attendanceTable)
        .where(and(eq(attendanceTable.id, attendanceId), ownsAttendance(studentId, studentEmail)))
        .limit(1)
        .for("update");

      if (!lockedAttendance) {
        throw Object.assign(new Error("Attendance not found."), { status: 404 });
      }
      if (!FEEDBACK_ELIGIBLE_ATTENDANCE_STATUSES.includes(lockedAttendance.status as typeof FEEDBACK_ELIGIBLE_ATTENDANCE_STATUSES[number])) {
        throw Object.assign(new Error("Feedback is not available for this attendance status."), { status: 400 });
      }
      const dueAt = parseDbTimestamp(lockedAttendance.checkedInAt);
      if (!dueAt || dueAt.getTime() + 3 * 60 * 60 * 1000 > Date.now()) {
        throw Object.assign(new Error("Feedback is not due yet."), { status: 400 });
      }

      const [row] = await tx
        .select({
          attendanceId: attendanceTable.id,
          attendanceStudentId: attendanceTable.studentId,
          studentName: attendanceTable.studentName,
          studentEmail: attendanceTable.studentEmail,
          checkedInAt: attendanceTable.checkedInAt,
          status: attendanceTable.status,
          bookingId: attendanceTable.bookingId,
          classId: sql<number | null>`coalesce(${attendanceTable.classId}, ${bookingsTable.classId})`,
          scheduleId: sql<number | null>`coalesce(${attendanceTable.scheduleId}, ${bookingsTable.scheduleId})`,
          classTitle: sql<string | null>`coalesce(${attendanceTable.classTitle}, ${classesTable.title})`,
          instructorId: instructorsTable.id,
          instructorName: instructorsTable.name,
          danceTypeName: sql<string | null>`coalesce(${danceTypesTable.name}, ${classesTable.category})`,
          childId: childrenTable.id,
          childName: childrenTable.fullName,
          scheduleType: schedulesTable.type,
          scheduleDayOfWeek: schedulesTable.dayOfWeek,
          scheduleDate: schedulesTable.date,
          scheduleStartTime: schedulesTable.startTime,
          scheduleEndTime: schedulesTable.endTime,
          scheduleLocation: schedulesTable.location,
          schedulePriceEgp: schedulesTable.priceEgp,
        })
        .from(attendanceTable)
        .leftJoin(bookingsTable, eq(attendanceTable.bookingId, bookingsTable.id))
        .leftJoin(childrenTable, eq(bookingsTable.participantChildId, childrenTable.id))
        .leftJoin(classesTable, sql`${classesTable.id} = coalesce(${attendanceTable.classId}, ${bookingsTable.classId})`)
        .leftJoin(instructorsTable, eq(classesTable.instructorId, instructorsTable.id))
        .leftJoin(danceTypesTable, eq(classesTable.danceTypeId, danceTypesTable.id))
        .leftJoin(schedulesTable, sql`${schedulesTable.id} = coalesce(${attendanceTable.scheduleId}, ${bookingsTable.scheduleId})`)
        .where(and(eq(attendanceTable.id, attendanceId), ownsAttendance(studentId, studentEmail)))
        .limit(1);

      if (!row) {
        throw Object.assign(new Error("Attendance not found."), { status: 404 });
      }

      const [created] = await tx
        .insert(feedbackTable)
        .values({
          attendanceId: row.attendanceId,
          studentId: row.attendanceStudentId ?? studentId,
          studentEmailSnapshot: normalizeEmail(row.studentEmail),
          studentNameSnapshot: row.studentName,
          childId: row.childId,
          childNameSnapshot: row.childName,
          bookingId: row.bookingId,
          classId: row.classId,
          classTitleSnapshot: row.classTitle,
          scheduleId: row.scheduleId,
          scheduleSnapshot: {
            type: row.scheduleType,
            dayOfWeek: row.scheduleDayOfWeek,
            date: row.scheduleDate,
            startTime: row.scheduleStartTime,
            endTime: row.scheduleEndTime,
            location: row.scheduleLocation,
            priceEgp: row.schedulePriceEgp,
            label: scheduleLabel(row),
          },
          instructorId: row.instructorId,
          instructorNameSnapshot: row.instructorName,
          danceTypeNameSnapshot: row.danceTypeName,
          rating,
          comment: comment || null,
          tags: parsed.data.tags ?? [],
          reviewStatus: "pending",
          clientSubmissionId,
          submittedAt: parsed.data.submittedAt ?? null,
        })
        .returning();

      return created;
    });

    res.status(inserted.clientSubmissionId === clientSubmissionId ? 201 : 200).json(publicFeedback(inserted));
  } catch (error: unknown) {
    const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { status: unknown }).status) : 500;
    if (status >= 400 && status < 500) {
      res.status(status).json({ error: error instanceof Error ? error.message : "Feedback submission failed." });
      return;
    }
    const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
    if (code === "23505") {
      const [existing] = await db.select().from(feedbackTable).where(eq(feedbackTable.attendanceId, attendanceId)).limit(1);
      if (existing) {
        if (!feedbackBelongsToStudent(existing, studentId, studentEmail)) {
          res.status(403).json({ error: "Feedback submission does not belong to this student." });
          return;
        }
        res.json(publicFeedback(existing));
        return;
      }
    }
    throw error;
  }
});

const AdminFeedbackQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  reviewStatus: z.enum(REVIEW_STATUSES).optional(),
  studentEmail: z.string().trim().optional(),
  search: z.string().trim().optional(),
});

router.get("/feedback", blockStudentJwt, requireAdminAuth, requireAdminPermission("feedback", "view"), async (req: AdminRequest, res): Promise<void> => {
  const query = AdminFeedbackQuery.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const page = query.data.page ?? 1;
  const pageSize = query.data.pageSize ?? 50;
  const offset = (page - 1) * pageSize;
  const conditions = [];
  if (query.data.rating != null) conditions.push(eq(feedbackTable.rating, query.data.rating));
  if (query.data.reviewStatus) conditions.push(eq(feedbackTable.reviewStatus, query.data.reviewStatus));
  if (query.data.studentEmail) {
    const normalizedEmail = normalizeEmail(query.data.studentEmail);
    // Membership Engine (Phase 3): resolve email → studentId first so this
    // hits the indexed feedback_student_id_received_at_idx path for current
    // accounts, falling back to the (unindexed) email-snapshot match only
    // for legacy rows that predate feedback.studentId being populated.
    const [matchedStudent] = await db
      .select({ id: studentsTable.id })
      .from(studentsTable)
      .where(sql`lower(trim(${studentsTable.email})) = ${normalizedEmail}`)
      .limit(1);
    conditions.push(
      matchedStudent
        ? or(
            eq(feedbackTable.studentId, matchedStudent.id),
            sql`lower(trim(${feedbackTable.studentEmailSnapshot})) = ${normalizedEmail}`,
          )
        : sql`lower(trim(${feedbackTable.studentEmailSnapshot})) = ${normalizedEmail}`,
    );
  }
  if (query.data.search) {
    const pattern = `%${query.data.search.toLowerCase()}%`;
    conditions.push(sql`(
      lower(coalesce(${feedbackTable.studentNameSnapshot}, '')) like ${pattern}
      OR lower(coalesce(${feedbackTable.studentEmailSnapshot}, '')) like ${pattern}
      OR lower(coalesce(${feedbackTable.childNameSnapshot}, '')) like ${pattern}
      OR lower(coalesce(${feedbackTable.classTitleSnapshot}, '')) like ${pattern}
      OR lower(coalesce(${feedbackTable.instructorNameSnapshot}, '')) like ${pattern}
    )`);
  }
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [countRow] = whereClause
    ? await db.select({ total: sql<number>`count(*)::int` }).from(feedbackTable).where(whereClause)
    : await db.select({ total: sql<number>`count(*)::int` }).from(feedbackTable);

  const rows = whereClause
    ? await db.select().from(feedbackTable).where(whereClause).orderBy(desc(feedbackTable.receivedAt)).limit(pageSize).offset(offset)
    : await db.select().from(feedbackTable).orderBy(desc(feedbackTable.receivedAt)).limit(pageSize).offset(offset);

  const canViewComments = adminCanViewComments(req);
  const total = Number(countRow?.total ?? 0);

  res.setHeader("X-Total-Count", String(total));
  res.setHeader("X-Page", String(page));
  res.setHeader("X-Page-Size", String(pageSize));
  res.setHeader("X-Total-Pages", String(total === 0 ? 0 : Math.ceil(total / pageSize)));
  res.json({
    data: rows.map((row) => ({
      id: row.id,
      attendanceId: row.attendanceId,
      student: row.studentNameSnapshot,
      studentEmail: row.studentEmailSnapshot,
      child: row.childNameSnapshot,
      trainer: row.instructorNameSnapshot,
      classTitle: row.classTitleSnapshot,
      rating: row.rating,
      commentPreview: canViewComments ? row.comment : null,
      hasComment: Boolean(row.comment),
      reviewStatus: row.reviewStatus,
      submittedAt: row.submittedAt,
      receivedAt: row.receivedAt,
    })),
    total,
    page,
    pageSize,
  });
});

const FeedbackParams = z.object({ id: z.coerce.number().int().positive() });

router.get("/feedback/:id", blockStudentJwt, requireAdminAuth, requireAdminPermission("feedback", "view"), async (req: AdminRequest, res): Promise<void> => {
  const params = FeedbackParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.select().from(feedbackTable).where(eq(feedbackTable.id, params.data.id)).limit(1);
  if (!row) {
    res.status(404).json({ error: "Feedback not found" });
    return;
  }
  const canViewComments = adminCanViewComments(req);
  res.json({
    ...row,
    comment: canViewComments ? row.comment : null,
    commentHidden: !canViewComments && Boolean(row.comment),
  });
});

const ReviewBody = z.object({
  reviewStatus: z.enum(REVIEW_STATUSES),
});

router.patch("/feedback/:id/review", blockStudentJwt, requireAdminAuth, requireAdminPermission("feedback", "review"), async (req: AdminRequest, res): Promise<void> => {
  const params = FeedbackParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = ReviewBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [row] = await db
    .update(feedbackTable)
    .set({
      reviewStatus: body.data.reviewStatus,
      reviewedBy: req.adminUser?.id ?? null,
      reviewedAt: new Date().toISOString(),
    })
    .where(eq(feedbackTable.id, params.data.id))
    .returning();

  if (!row) {
    res.status(404).json({ error: "Feedback not found" });
    return;
  }

  res.json(row);
});

export default router;
