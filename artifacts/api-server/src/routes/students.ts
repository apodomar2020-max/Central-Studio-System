import { blockStudentJwt } from "../middlewares/auth";
import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  studentsTable,
  packageOrdersTable,
  bookingsTable,
  childrenTable,
  attendanceTable,
  feedbackTable,
  creditTransactionsTable,
  classesTable,
  schedulesTable,
  instructorsTable,
  studentDanceInterestsTable,
  danceTypesTable,
  notificationDevicesTable,
} from "@workspace/db";
import {
  CreateStudentBody,
  GetStudentParams,
  GetStudentResponse,
  UpdateStudentParams,
  UpdateStudentBody,
  UpdateStudentResponse,
  ListStudentsQueryParams,
  GetStudentByTokenParams,
  hasRolePermission,
} from "@workspace/api-zod";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { resolveMemberIdentity } from "../lib/membershipIdentity";
import { sanitizeStudentRow } from "../lib/studentSanitizer";
import { buildProfileCompletion } from "../lib/studentProfileResponse";
import { computeProfileCompletion } from "../lib/profileCompletion";
import { buildStudentProfilePdfBuffer, studentProfilePdfFilename } from "./studentProfilePdf";
import { diffFields, logActivity } from "../lib/activityLog";
import { computeAgeAsOf } from "../lib/balletAgeEligibility";
import * as zod from "zod";

const router: IRouter = Router();

/**
 * Admin child-card display age (DOB / Age display fix). `children.dateOfBirth`
 * is the canonical source (see lib/db/src/schema/children.ts's own doc
 * comment); `children.age` is a legacy stored snapshot — kept readable for
 * records that predate canonical DOB, or that came from a flow (e.g. Mobile)
 * that also populates it, but never preferred over a valid canonical
 * computation. Falls back to the legacy value whenever DOB is absent OR
 * present-but-invalid (computeAgeAsOf returns null for either case) — never
 * throws, never produces NaN. Reuses the existing, already-proven
 * computeAgeAsOf() from ballet eligibility rather than duplicating date math.
 */
function deriveChildDisplayAge(dateOfBirth: string | null, legacyAge: number | null): number | null {
  if (dateOfBirth) {
    const today = new Date().toISOString().slice(0, 10);
    const computed = computeAgeAsOf(dateOfBirth, today);
    if (computed !== null) return computed;
  }
  return legacyAge ?? null;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function adminCan(req: AdminRequest, moduleKey: string, actionKey: string): boolean {
  const admin = req.adminUser;
  return Boolean(admin && (admin.isSuperAdmin || hasRolePermission(admin.permissions, moduleKey, actionKey)));
}

function accountModule(accountType: string | null): "parents" | "students" {
  return accountType === "parent" ? "parents" : "students";
}

const STUDENT_ACTIVITY_FIELDS = ["name", "email", "phone", "notes", "totalBookings"] as const;

function studentActivitySnapshot(row: {
  name: string;
  email: string;
  phone: string | null;
  notes: string | null;
  totalBookings: number;
}): Record<string, unknown> {
  return {
    name: row.name,
    email: row.email,
    phone: row.phone,
    notes: row.notes,
    totalBookings: row.totalBookings,
  };
}

// ---------------------------------------------------------------------------
// GET /students/by-token/:token
//
// Resolves an opaque QR token to a student profile + their active packages.
// This is the first step in the QR check-in flow:
//   Admin scans QR → frontend calls this → gets student name + packages.
//
// Must be registered BEFORE /students/:id so Express doesn't try to coerce
// the literal string "by-token" as a numeric :id.
// ---------------------------------------------------------------------------
router.get("/students/by-token/:token", requireAdminAuth, requireAdminPermission("qr", "scan"), async (req, res): Promise<void> => {
  const params = GetStudentByTokenParams.safeParse(req.params);
  if (!params.success) {
    // Token was present but not a valid UUID format
    res.status(400).json({ error: "Invalid QR token format" });
    return;
  }

  const [student] = await db
    .select()
    .from(studentsTable)
    .where(eq(studentsTable.qrToken, params.data.token));

  if (!student) {
    res.status(404).json({ error: "QR code not recognised" });
    return;
  }

  // Fetch active packages for this student (by email — the stable link
  // between students and packageOrders tables)
  const packageOrders = await db
    .select()
    .from(packageOrdersTable)
    .where(
      and(
        eq(packageOrdersTable.studentEmail, student.email),
        eq(packageOrdersTable.status, "active"),
      ),
    );

  const activePackages = packageOrders
    .filter((p) => p.remainingCredits > 0)
    .map((p) => ({
      id: p.id,
      packageName: p.packageName,
      totalCredits: p.totalCredits,
      remainingCredits: p.remainingCredits,
      expiresAt: p.expiresAt ?? null,
    }));

  // Return only the fields the admin needs — do NOT expose passwordHash,
  // emailVerified, notes, qrToken, or other internal fields.
  res.json({
    id: student.id,
    name: student.name,
    email: student.email,
    phone: student.phone ?? null,
    joinedAt: student.joinedAt,
    activePackages,
  });
});

// ---------------------------------------------------------------------------
// GET /students/resolve-identity
//
// Membership Engine utility endpoint — thin wrapper around
// resolveMemberIdentity() for admin tooling ("who does this booking/
// attendance/child belong to?"). Read-only. Accepts exactly the same input
// shape as the shared helper; at least one identifier is required.
//
// Must be registered BEFORE /students/:id (same reason as by-token above) —
// otherwise Express would try to coerce "resolve-identity" as a numeric id.
// ---------------------------------------------------------------------------
const ResolveIdentityQuery = zod.object({
  studentId: zod.coerce.number().int().positive().optional(),
  studentEmail: zod.string().email().optional(),
  bookingId: zod.coerce.number().int().positive().optional(),
  attendanceId: zod.coerce.number().int().positive().optional(),
  childId: zod.coerce.number().int().positive().optional(),
});

router.get("/students/resolve-identity", requireAdminAuth, async (req: AdminRequest, res): Promise<void> => {
  const query = ResolveIdentityQuery.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { studentId, studentEmail, bookingId, attendanceId, childId } = query.data;
  if (studentId == null && studentEmail == null && bookingId == null && attendanceId == null && childId == null) {
    res.status(400).json({ error: "Provide at least one of studentId, studentEmail, bookingId, attendanceId, childId." });
    return;
  }

  if (!adminCan(req, "users", "view") && !adminCan(req, "students", "view") && !adminCan(req, "parents", "view")) {
    res.status(403).json({
      error: "Permission denied",
      requiredPermission: { anyOf: ["users.view", "students.view", "parents.view"] },
    });
    return;
  }

  const identity = await resolveMemberIdentity({ studentId, studentEmail, bookingId, attendanceId, childId });
  res.json(identity);
});

router.get("/students", requireAdminAuth, async (req: AdminRequest, res): Promise<void> => {
  const query = ListStudentsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const canViewAll = adminCan(req, "users", "view");
  const canViewStudents = canViewAll || adminCan(req, "students", "view");
  const canViewParents = canViewAll || adminCan(req, "parents", "view");
  const canViewChildren = adminCan(req, "children", "view");

  if (!canViewStudents && !canViewParents) {
    res.status(403).json({
      error: "Permission denied",
      requiredPermission: {
        anyOf: ["users.view", "students.view", "parents.view"],
      },
    });
    return;
  }

  const page = query.data.page ?? 1;
  const pageSize = query.data.pageSize ?? 50;
  const offset = (page - 1) * pageSize;
  const conditions = [];

  if (query.data.accountType === "parent") {
    if (!canViewParents) {
      res.status(403).json({ error: "Permission denied", requiredPermission: "parents.view" });
      return;
    }
    conditions.push(eq(studentsTable.accountType, "parent"));
  } else if (query.data.accountType === "student") {
    if (!canViewStudents) {
      res.status(403).json({ error: "Permission denied", requiredPermission: "students.view" });
      return;
    }
    conditions.push(sql`(${studentsTable.accountType} IS NULL OR ${studentsTable.accountType} = 'student')`);
  } else if (!canViewAll) {
    if (canViewStudents && !canViewParents) {
      conditions.push(sql`(${studentsTable.accountType} IS NULL OR ${studentsTable.accountType} = 'student')`);
    } else if (canViewParents && !canViewStudents) {
      conditions.push(eq(studentsTable.accountType, "parent"));
    }
  }

  const search = query.data.search?.trim().toLowerCase();
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(sql`(
      lower(coalesce(${studentsTable.name}, '')) like ${pattern}
      OR lower(coalesce(${studentsTable.email}, '')) like ${pattern}
      OR lower(coalesce(${studentsTable.phone}, '')) like ${pattern}
    )`);
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [countRow] = whereClause
    ? await db.select({ total: sql<number>`count(*)::int` }).from(studentsTable).where(whereClause)
    : await db.select({ total: sql<number>`count(*)::int` }).from(studentsTable);
  const total = Number(countRow?.total ?? 0);

  const rows = whereClause
    ? await db.select().from(studentsTable).where(whereClause).orderBy(desc(studentsTable.joinedAt)).limit(pageSize).offset(offset)
    : await db.select().from(studentsTable).orderBy(desc(studentsTable.joinedAt)).limit(pageSize).offset(offset);

  const bookingCounts = new Map<string, number>();
  const emails = rows.map((student) => student.email);
  if (emails.length > 0) {
    const bookingRows = await db
      .select({
        studentEmail: bookingsTable.studentEmail,
        total: sql<number>`count(*)::int`,
      })
      .from(bookingsTable)
      .where(and(
        inArray(bookingsTable.studentEmail, emails),
        sql`lower(trim(${bookingsTable.bookingStatus})) not in ('cancelled', 'rejected')`,
      ))
      .groupBy(bookingsTable.studentEmail);

    for (const booking of bookingRows) {
      bookingCounts.set(normalizeEmail(booking.studentEmail), Number(booking.total ?? 0));
    }
  }

  const childCounts = new Map<number, number>();
  const childMissingMedicalCounts = new Map<number, number>();
  const parentIds = rows
    .filter((student) => student.accountType === "parent")
    .map((student) => student.id);
  if (canViewChildren && parentIds.length > 0) {
    const childrenRows = await db
      .select({
        parentId: childrenTable.parentId,
        total: sql<number>`count(*)::int`,
        missingMedical: sql<number>`count(*) filter (where ${childrenTable.medicalNotes} is null)::int`,
      })
      .from(childrenTable)
      .where(inArray(childrenTable.parentId, parentIds))
      .groupBy(childrenTable.parentId);
    for (const child of childrenRows) {
      childCounts.set(child.parentId, Number(child.total ?? 0));
      childMissingMedicalCounts.set(child.parentId, Number(child.missingMedical ?? 0));
    }
  }

  // Profile Completion Engine (Phase 4) — gated behind users.view specifically,
  // same rule as the /students/:id/overview endpoint. Computed in-memory from
  // columns/counts already fetched above — no per-row query (avoids N+1).
  const canViewProfileCompletion = canViewAll;
  const danceInterestCounts = new Map<number, number>();
  if (canViewProfileCompletion && rows.length > 0) {
    const interestRows = await db
      .select({ studentId: studentDanceInterestsTable.studentId, total: sql<number>`count(*)::int` })
      .from(studentDanceInterestsTable)
      .where(inArray(studentDanceInterestsTable.studentId, rows.map((s) => s.id)))
      .groupBy(studentDanceInterestsTable.studentId);
    for (const r of interestRows) {
      danceInterestCounts.set(r.studentId, Number(r.total ?? 0));
    }
  }

  res.json({
    students: rows.map((student) => {
      const danceInterestCount = danceInterestCounts.get(student.id) ?? 0;
      const profileCompletion = canViewProfileCompletion
        ? computeProfileCompletion({
            emailVerified: student.emailVerified,
            accountType: student.accountType as "student" | "parent" | null,
            name: student.name,
            phone: student.phone,
            gender: student.gender,
            dateOfBirth: student.dateOfBirth,
            city: student.city,
            nationality: student.nationality,
            howDidYouHearAboutUs: student.howDidYouHearAboutUs,
            policiesAcceptedAt: student.policiesAcceptedAt,
            childrenCount: childCounts.get(student.id) ?? 0,
            childrenMissingMedicalCount: childMissingMedicalCounts.get(student.id) ?? 0,
            danceInterestCount,
          })
        : null;
      return {
        // Sensitive credential fields (passwordHash, qrToken, provider ids)
        // must never reach the client, even for admins (Security Phase F).
        ...sanitizeStudentRow(student),
        totalBookings: bookingCounts.get(normalizeEmail(student.email)) ?? 0,
        ...(canViewChildren ? { childCount: childCounts.get(student.id) ?? 0 } : {}),
        ...(canViewProfileCompletion
          ? {
              danceInterestCount,
              profileCompletion,
              verificationBadge: student.emailVerified && (profileCompletion?.isComplete ?? false),
            }
          : {}),
      };
    }),
    total,
    page,
    pageSize,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
  });
});

router.post("/students", blockStudentJwt, requireAdminAuth, requireAdminPermission("users", "create"), async (req, res): Promise<void> => {
  const parsed = CreateStudentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .insert(studentsTable)
    .values({ ...parsed.data, email: normalizeEmail(parsed.data.email) })
    .returning();
  res.status(201).json(GetStudentResponse.parse(row));
});

router.get("/students/:id", requireAdminAuth, async (req: AdminRequest, res): Promise<void> => {
  const params = GetStudentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.select().from(studentsTable).where(eq(studentsTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "Student not found" });
    return;
  }

  const targetModule = accountModule(row.accountType);
  if (!adminCan(req, "users", "view") && !adminCan(req, targetModule, "view")) {
    res.status(403).json({
      error: "Permission denied",
      requiredPermission: { anyOf: [`users.view`, `${targetModule}.view`] },
    });
    return;
  }

  const canViewChildren = adminCan(req, "children", "view");
  const children = canViewChildren
    ? await db.select().from(childrenTable).where(eq(childrenTable.parentId, row.id))
    : [];

  res.json(GetStudentResponse.parse({
    ...row,
    ...(canViewChildren ? {
      children: children.map(c => ({
        id: c.id,
        fullName: c.fullName,
        dateOfBirth: c.dateOfBirth ?? null,
        birthday: c.birthday ?? null,
        age: deriveChildDisplayAge(c.dateOfBirth ?? null, c.age ?? null),
        gender: c.gender,
        medicalNotes: c.medicalNotes ?? null,
        emergencyName: c.emergencyName ?? null,
        emergencyPhone: c.emergencyPhone ?? null,
      })),
    } : {}),
  }));
});

// ---------------------------------------------------------------------------
// GET /students/:id/overview
//
// Read-only 360° profile aggregate for the admin Users detail page. Combines
// identity, completion status (current 3-field definition — the full Profile
// Completion Engine is a separate, not-yet-built phase), stats, children,
// packages, recent bookings/attendance/feedback/credit-ledger activity, and a
// timeline synthesized from those same rows (no new tables, no extra queries
// beyond what's already fetched for each section).
//
// Every sub-section is gated by the same permission that gates its own
// dedicated list page (bookings.view, attendance.view, packageOrders.view,
// credits.history, feedback.view/viewComments, children.view) so an admin
// never sees data here that they couldn't already see elsewhere. Sections the
// admin lacks permission for come back as empty with `permissions.can*` set
// to false, so the UI can distinguish "no access" from "no data yet".
// ---------------------------------------------------------------------------

const CREDIT_TX_LABELS: Record<string, string> = {
  package_activated: "Package activated",
  attendance_deduction: "Credit used",
  manual_adjustment: "Credits adjusted",
  package_bonus: "Bonus credits added",
  package_refund: "Credit refunded",
};

export type MembershipStatus = "Active" | "Inactive" | "Needs Profile" | "No Active Package" | "New" | "At Risk";

const NEW_ACCOUNT_DAYS = 14;
const ACTIVE_RECENT_DAYS = 30;
const INACTIVE_DAYS = 60;
const AT_RISK_MIN_BOOKINGS = 3;
const AT_RISK_MAX_RATE = 0.5;
const DEFAULT_OVERVIEW_LIMITS = { bookings: 10, attendance: 10, packages: 5, credits: 10, feedback: 10 };
const EXPORT_OVERVIEW_LIMITS = { bookings: 100, attendance: 100, packages: 100, credits: 100, feedback: 100 };

class StudentOverviewHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: Record<string, unknown>,
  ) {
    super(String(body["error"] ?? "Student overview failed"));
  }
}

function daysSince(isoDate: string): number {
  return (Date.now() - new Date(isoDate).getTime()) / 86_400_000;
}

/**
 * Membership Engine (Phase 3) — simple, explainable status rules. Priority
 * order matters: the first rule that matches wins, since these conditions
 * are not mutually exclusive (e.g. a brand-new account also has no active
 * package). Deliberately not more elaborate than this for Phase 3.
 */
function computeMembershipStatus(input: {
  profileCompleted: boolean;
  joinedAt: string;
  totalBookings: number;
  totalAttendance: number;
  attendanceRate: number | null;
  hasActivePackage: boolean;
  lastActivity: string | null;
}): MembershipStatus {
  if (!input.profileCompleted) return "Needs Profile";
  if (input.totalBookings === 0 && daysSince(input.joinedAt) <= NEW_ACCOUNT_DAYS) return "New";
  if (
    input.totalBookings >= AT_RISK_MIN_BOOKINGS &&
    input.attendanceRate != null &&
    input.attendanceRate < AT_RISK_MAX_RATE
  ) {
    return "At Risk";
  }
  const recentActivity = input.lastActivity != null && daysSince(input.lastActivity) <= ACTIVE_RECENT_DAYS;
  if (input.hasActivePackage || recentActivity) return "Active";
  if (input.totalBookings > 0 || input.totalAttendance > 0) return "No Active Package";
  if (input.lastActivity == null || daysSince(input.lastActivity) > INACTIVE_DAYS) return "Inactive";
  return "Inactive";
}

async function buildStudentOverviewData(
  req: AdminRequest,
  studentId: number,
  limits = DEFAULT_OVERVIEW_LIMITS,
) {
  const [row] = await db.select().from(studentsTable).where(eq(studentsTable.id, studentId));
  if (!row) {
    throw new StudentOverviewHttpError(404, { error: "Student not found" });
  }

  const targetModule = accountModule(row.accountType);
  if (!adminCan(req, "users", "view") && !adminCan(req, targetModule, "view")) {
    throw new StudentOverviewHttpError(403, {
      error: "Permission denied",
      requiredPermission: { anyOf: [`users.view`, `${targetModule}.view`] },
    });
  }

  // Membership Engine — resolve the canonical identity once via the shared
  // resolver rather than re-deriving normalization inline. Single query, not
  // per-row, so this doesn't reintroduce N+1 in the sections below.
  const identity = await resolveMemberIdentity({ studentId: row.id });
  const email = identity.normalizedEmail ?? normalizeEmail(row.email);
  const ownerCondition = sql`(${bookingsTable.accountOwnerStudentId} = ${row.id} OR lower(trim(${bookingsTable.studentEmail})) = ${email})`;
  const packageOwnerCondition = sql`(${packageOrdersTable.studentId} = ${row.id} OR lower(trim(${packageOrdersTable.studentEmail})) = ${email})`;

  const permissions = {
    canViewChildren: adminCan(req, "children", "view"),
    canViewBookings: adminCan(req, "bookings", "view"),
    canViewAttendance: adminCan(req, "attendance", "view"),
    canViewPackages: adminCan(req, "packageOrders", "view"),
    canViewCredits: adminCan(req, "credits", "history"),
    canViewFeedback: adminCan(req, "feedback", "view"),
    canViewFeedbackComments: adminCan(req, "feedback", "viewComments"),
    // Profile Completion Engine (Phase 4) — explicitly narrower than the
    // other sections: only users.view, not the broader students/parents.view.
    canViewProfileCompletion: adminCan(req, "users", "view"),
  };

  // ---------------------------------------------------------------------
  // Children (parent accounts only)
  // ---------------------------------------------------------------------
  const childrenPromise =
    permissions.canViewChildren && row.accountType === "parent"
      ? db.select().from(childrenTable).where(eq(childrenTable.parentId, row.id))
      : Promise.resolve([]);

  // ---------------------------------------------------------------------
  // Bookings — historical account total + recent 10.
  //
  // User 360 should reflect the same booking universe the mobile app shows:
  // every booking record owned by the account, including cancelled/rejected
  // rows that remain part of the user's booking history.
  // ---------------------------------------------------------------------
  const totalBookingsPromise = permissions.canViewBookings
    ? db
        .select({ total: sql<number>`count(*)::int` })
        .from(bookingsTable)
        .where(ownerCondition)
        .then((r) => Number(r[0]?.total ?? 0))
    : Promise.resolve(0);

  const recentBookingsPromise = permissions.canViewBookings
    ? db
        .select({
          id: bookingsTable.id,
          bookingStatus: bookingsTable.bookingStatus,
          paymentStatus: bookingsTable.paymentStatus,
          paymentMode: bookingsTable.paymentMode,
          occurrenceDate: bookingsTable.occurrenceDate,
          createdAt: bookingsTable.createdAt,
          studentName: bookingsTable.studentName,
          classTitle: classesTable.title,
          scheduleStartTime: schedulesTable.startTime,
          scheduleEndTime: schedulesTable.endTime,
          participantChildName: childrenTable.fullName,
        })
        .from(bookingsTable)
        .leftJoin(classesTable, eq(bookingsTable.classId, classesTable.id))
        .leftJoin(schedulesTable, eq(bookingsTable.scheduleId, schedulesTable.id))
        .leftJoin(childrenTable, eq(bookingsTable.participantChildId, childrenTable.id))
        .where(ownerCondition)
        .orderBy(desc(bookingsTable.createdAt))
        .limit(limits.bookings)
    : Promise.resolve([]);

  // ---------------------------------------------------------------------
  // Attendance — total count + recent 10 (with class/instructor snapshot)
  // ---------------------------------------------------------------------
  const attendanceOwnerCondition = sql`(${attendanceTable.studentId} = ${row.id} OR lower(trim(${attendanceTable.studentEmail})) = ${email})`;

  const totalAttendancePromise = permissions.canViewAttendance
    ? db
        .select({ total: sql<number>`count(*)::int` })
        .from(attendanceTable)
        .where(attendanceOwnerCondition)
        .then((r) => Number(r[0]?.total ?? 0))
    : Promise.resolve(0);

  const recentAttendancePromise = permissions.canViewAttendance
    ? db
        .select({
          id: attendanceTable.id,
          classTitle: attendanceTable.classTitle,
          status: attendanceTable.status,
          creditDeducted: attendanceTable.creditDeducted,
          checkedInAt: attendanceTable.checkedInAt,
          instructorName: instructorsTable.name,
        })
        .from(attendanceTable)
        .leftJoin(classesTable, eq(attendanceTable.classId, classesTable.id))
        .leftJoin(instructorsTable, eq(classesTable.instructorId, instructorsTable.id))
        .where(attendanceOwnerCondition)
        .orderBy(desc(attendanceTable.checkedInAt))
        .limit(limits.attendance)
    : Promise.resolve([]);

  // ---------------------------------------------------------------------
  // Packages — active package + recent 5. package_orders.student_id (Phase
  // 3, migration 0034) is nullable and only backfilled where an explicit
  // backfill has been run — so match on `studentId = X OR normalized email`
  // (packageOwnerCondition above), never studentId alone, or pre-backfill
  // rows would silently disappear. Amount-paid is intentionally omitted:
  // package_orders has no reliable price field (packageId is a legacy FK
  // that may not match a current price_packages row).
  // ---------------------------------------------------------------------
  // Finance Batch 1 fix: this used to `.limit(1)` and return a single active
  // package's remainingCredits as "the" balance — wrong whenever a student
  // has more than one active package (e.g. an old 3-credit package plus a
  // newly activated 4-credit package), since only one of the two rows would
  // ever be counted. availableCredits below is now the SUM of remainingCredits
  // across every qualifying active package; activePackages carries the full
  // contributing list, and activePackage (below) keeps the single
  // soonest-expiring package for its existing display purpose only.
  const activePackagesPromise = permissions.canViewPackages
    ? db
        .select()
        .from(packageOrdersTable)
        .where(and(
          packageOwnerCondition,
          eq(packageOrdersTable.status, "active"),
          sql`${packageOrdersTable.remainingCredits} > 0`,
        ))
        .orderBy(sql`${packageOrdersTable.expiresAt} asc nulls last`)
    : Promise.resolve([] as (typeof packageOrdersTable.$inferSelect)[]);

  const recentPackagesPromise = permissions.canViewPackages
    ? db
        .select()
        .from(packageOrdersTable)
        .where(packageOwnerCondition)
        .orderBy(desc(packageOrdersTable.createdAt))
        .limit(limits.packages)
    : Promise.resolve([]);

  // ---------------------------------------------------------------------
  // Credit ledger — resolve this student's package order ids, then the
  // 10 most recent ledger rows across those orders (same 2-step approach
  // as GET /admin/credits/ledger).
  // ---------------------------------------------------------------------
  const creditTransactionsPromise = permissions.canViewCredits
    ? db
        .select({ id: packageOrdersTable.id })
        .from(packageOrdersTable)
        .where(packageOwnerCondition)
        .then((orders) => {
          const orderIds = orders.map((o) => o.id);
          if (orderIds.length === 0) return [];
          return db
            .select()
            .from(creditTransactionsTable)
            .where(inArray(creditTransactionsTable.packageOrderId, orderIds))
            .orderBy(desc(creditTransactionsTable.createdAt))
            .limit(limits.credits);
        })
    : Promise.resolve([]);

  // ---------------------------------------------------------------------
  // Feedback — rating average/count (SQL aggregate, not fetched-then-averaged)
  // + recent 10, with comment masked unless feedback.viewComments.
  // ---------------------------------------------------------------------
  const feedbackOwnerCondition = sql`(${feedbackTable.studentId} = ${row.id} OR lower(trim(${feedbackTable.studentEmailSnapshot})) = ${email})`;

  const feedbackAggPromise = permissions.canViewFeedback
    ? db
        .select({
          avg: sql<number | null>`avg(${feedbackTable.rating})::float`,
          count: sql<number>`count(*)::int`,
        })
        .from(feedbackTable)
        .where(feedbackOwnerCondition)
        .then((r) => ({ avg: r[0]?.avg ?? null, count: Number(r[0]?.count ?? 0) }))
    : Promise.resolve({ avg: null, count: 0 });

  const recentFeedbackPromise = permissions.canViewFeedback
    ? db
        .select({
          id: feedbackTable.id,
          classTitleSnapshot: feedbackTable.classTitleSnapshot,
          instructorNameSnapshot: feedbackTable.instructorNameSnapshot,
          rating: feedbackTable.rating,
          comment: feedbackTable.comment,
          reviewStatus: feedbackTable.reviewStatus,
          submittedAt: feedbackTable.submittedAt,
          receivedAt: feedbackTable.receivedAt,
        })
        .from(feedbackTable)
        .where(feedbackOwnerCondition)
        .orderBy(desc(feedbackTable.receivedAt))
        .limit(limits.feedback)
    : Promise.resolve([]);

  // Profile Completion Engine (Phase 4) — "Your Vibe" selections, gated the
  // same as the completion block itself (users.view).
  const danceInterestsPromise = adminCan(req, "users", "view")
    ? db
        .select({ id: danceTypesTable.id, name: danceTypesTable.name, slug: danceTypesTable.slug })
        .from(studentDanceInterestsTable)
        .innerJoin(danceTypesTable, eq(studentDanceInterestsTable.danceTypeId, danceTypesTable.id))
        .where(eq(studentDanceInterestsTable.studentId, row.id))
    : Promise.resolve([]);

  const [
    children,
    totalBookings,
    recentBookingsRaw,
    totalAttendance,
    recentAttendanceRaw,
    activePackages,
    recentPackages,
    creditTransactions,
    feedbackAgg,
    recentFeedbackRaw,
    danceInterests,
  ] = await Promise.all([
    childrenPromise,
    totalBookingsPromise,
    recentBookingsPromise,
    totalAttendancePromise,
    recentAttendancePromise,
    activePackagesPromise,
    recentPackagesPromise,
    creditTransactionsPromise,
    feedbackAggPromise,
    recentFeedbackPromise,
    danceInterestsPromise,
  ]);

  // Canonical availableCredits: the sum of remainingCredits across every
  // qualifying active package (excludes pendingPayment/cancelled/fullyUsed/
  // expired packages and non-owned rows via packageOwnerCondition/status/
  // remainingCredits>0 filters already applied in activePackagesPromise
  // above). activePackage keeps the single soonest-expiring package for its
  // existing narrower display purpose (package name/expiry sub-label).
  const activePackage = activePackages[0] ?? null;
  const availableCredits = activePackages.reduce((sum, p) => sum + p.remainingCredits, 0);

  const recentBookings = recentBookingsRaw.map((b) => ({
    id: b.id,
    bookingNumber: `#${b.id}`,
    classTitle: b.classTitle ?? null,
    // Membership Engine (Phase 3) — explicit self/child clarity, not just an
    // inferred name (matches resolveMemberIdentity's participantType shape).
    participantType: (b.participantChildName ? "child" : "self") as "self" | "child",
    participantName: b.participantChildName ?? b.studentName,
    occurrenceDate: b.occurrenceDate ?? null,
    scheduleStartTime: b.scheduleStartTime ?? null,
    scheduleEndTime: b.scheduleEndTime ?? null,
    bookingStatus: b.bookingStatus,
    paymentStatus: b.paymentStatus,
    paymentMode: b.paymentMode ?? null,
    createdAt: b.createdAt,
  }));

  const recentAttendance = recentAttendanceRaw.map((a) => ({
    id: a.id,
    classTitle: a.classTitle ?? null,
    instructorName: a.instructorName ?? null,
    status: a.status,
    creditDeducted: a.creditDeducted,
    checkedInAt: a.checkedInAt,
  }));

  const recentFeedback = recentFeedbackRaw.map((f) => ({
    id: f.id,
    classTitle: f.classTitleSnapshot ?? null,
    instructorName: f.instructorNameSnapshot ?? null,
    rating: f.rating,
    commentPreview: permissions.canViewFeedbackComments ? f.comment : null,
    hasComment: Boolean(f.comment),
    reviewStatus: f.reviewStatus,
    submittedAt: f.submittedAt ?? f.receivedAt,
  }));

  // ---------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------
  const attendanceRate = totalBookings > 0 ? totalAttendance / totalBookings : null;
  const lastActivityCandidates = [
    row.lastLoginAt,
    recentBookings[0]?.createdAt,
    recentAttendance[0]?.checkedInAt,
    recentFeedback[0]?.submittedAt,
  ].filter((v): v is string => Boolean(v));
  const lastActivity = lastActivityCandidates.length > 0
    ? lastActivityCandidates.reduce((latest, v) => (v > latest ? v : latest))
    : row.joinedAt;

  const stats = {
    totalBookings,
    totalAttendance,
    attendanceRate,
    activePackage: activePackage
      ? {
          id: activePackage.id,
          packageName: activePackage.packageName,
          remainingCredits: activePackage.remainingCredits,
          totalCredits: activePackage.totalCredits,
          expiresAt: activePackage.expiresAt ?? null,
        }
      : null,
    // Canonical availableCredits — the sum across every qualifying active
    // package, not just one. Kept under the existing `remainingCredits` key
    // for backward compatibility with existing Admin UI consumers.
    remainingCredits: permissions.canViewPackages ? availableCredits : null,
    availableCredits: permissions.canViewPackages ? availableCredits : null,
    // Full contributing-package list behind the aggregate above, for any
    // surface that needs to show the breakdown rather than just the total.
    activePackages: activePackages.map((p) => ({
      id: p.id,
      packageName: p.packageName,
      remainingCredits: p.remainingCredits,
      totalCredits: p.totalCredits,
      expiresAt: p.expiresAt ?? null,
    })),
    packageExpiry: activePackage?.expiresAt ?? null,
    feedbackAverage: feedbackAgg.avg,
    feedbackCount: feedbackAgg.count,
    lastActivity,
  };

  // ---------------------------------------------------------------------
  // Profile completion — Profile Completion Engine (Phase 4). Same shared
  // engine the mobile app's /auth/me uses (lib/profileCompletion.ts via
  // lib/studentProfileResponse.ts), so admin and mobile always agree.
  // Gated specifically behind users.view, per Phase 4's permission rule —
  // narrower than the students/parents.view base gate on the rest of this
  // endpoint.
  // ---------------------------------------------------------------------
  const profileCompletion = await buildProfileCompletion(row);
  const verificationBadge = row.emailVerified && profileCompletion.isComplete;

  const completion = {
    emailVerified: row.emailVerified,
    profileCompletedAt: row.profileCompletedAt ?? null,
    lastCompletionStep: row.lastCompletionStep ?? null,
    percent: profileCompletion.percent,
    isComplete: profileCompletion.isComplete,
    nextStep: profileCompletion.nextStep,
    missing: profileCompletion.missing,
    completed: profileCompletion.completed,
    verificationBadge,
  };

  // ---------------------------------------------------------------------
  // Membership status — see computeMembershipStatus() for the rule order.
  // ---------------------------------------------------------------------
  const membershipStatus = computeMembershipStatus({
    profileCompleted: row.profileCompleted,
    joinedAt: row.joinedAt,
    totalBookings: stats.totalBookings,
    totalAttendance: stats.totalAttendance,
    attendanceRate: stats.attendanceRate,
    hasActivePackage: stats.activePackage != null,
    lastActivity: stats.lastActivity,
  });

  // ---------------------------------------------------------------------
  // Timeline — synthesized entirely from data already fetched above. No
  // per-status-transition audit log exists yet, so booking/package status
  // changes use the row's updatedAt/activatedAt as the best available proxy
  // for "when" rather than the exact transition time.
  // ---------------------------------------------------------------------
  type TimelineItem = { icon: string; title: string; description: string; timestamp: string; sourceType: string };
  const timeline: TimelineItem[] = [];

  timeline.push({
    icon: "account",
    title: "Account created",
    description: `${row.name} joined via ${row.authProvider ?? "manual signup"}.`,
    timestamp: row.joinedAt,
    sourceType: "account",
  });
  if (row.emailVerifiedAt) {
    timeline.push({
      icon: "email",
      title: "Email verified",
      description: "The account's email address was verified.",
      timestamp: row.emailVerifiedAt,
      sourceType: "account",
    });
  }
  if (row.profileCompletedAt) {
    timeline.push({
      icon: "profile",
      title: "Profile completed",
      description: "Required profile fields were completed.",
      timestamp: row.profileCompletedAt,
      sourceType: "account",
    });
  }
  for (const b of recentBookings) {
    timeline.push({
      icon: "booking",
      title: "Booking created",
      description: `${b.bookingNumber} for ${b.classTitle ?? "a class"} (${b.participantName}).`,
      timestamp: b.createdAt,
      sourceType: "booking",
    });
    if (b.bookingStatus !== "pending") {
      timeline.push({
        icon: "booking",
        title: `Booking ${b.bookingStatus}`,
        description: `${b.bookingNumber} — ${b.classTitle ?? "class"}.`,
        timestamp: b.createdAt,
        sourceType: "booking",
      });
    }
  }
  for (const a of recentAttendance) {
    timeline.push({
      icon: "attendance",
      title: "Attendance recorded",
      description: `${a.classTitle ?? "Class"}${a.instructorName ? ` with ${a.instructorName}` : ""} — ${a.status}.`,
      timestamp: a.checkedInAt,
      sourceType: "attendance",
    });
  }
  for (const c of creditTransactions) {
    timeline.push({
      icon: "credit",
      title: CREDIT_TX_LABELS[c.type] ?? "Credit transaction",
      description: c.notes ?? `${c.delta > 0 ? "+" : ""}${c.delta} credits.`,
      timestamp: c.createdAt,
      sourceType: "credit",
    });
  }
  for (const f of recentFeedback) {
    timeline.push({
      icon: "feedback",
      title: "Feedback submitted",
      description: `${f.rating}/5 for ${f.classTitle ?? "a class"}.`,
      timestamp: f.submittedAt ?? row.joinedAt,
      sourceType: "feedback",
    });
  }
  for (const p of recentPackages) {
    timeline.push({
      icon: "package",
      title: "Package ordered",
      description: `${p.packageName} (${p.totalCredits} credits).`,
      timestamp: p.createdAt,
      sourceType: "package",
    });
  }
  timeline.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

  return {
    user: {
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone ?? null,
      avatarUrl: row.avatarUrl ?? null,
      accountType: row.accountType ?? null,
      authProvider: row.authProvider ?? null,
      providerDisplayName: row.providerDisplayName ?? null,
      emailVerified: row.emailVerified,
      emailVerifiedAt: row.emailVerifiedAt ?? null,
      lastLoginAt: row.lastLoginAt ?? null,
      joinedAt: row.joinedAt,
      createdAt: row.createdAt,
      qrToken: row.qrToken,
      notes: row.notes ?? null,
      gender: row.gender ?? null,
      dateOfBirth: row.dateOfBirth ?? null,
      city: row.city ?? null,
      nationality: row.nationality ?? null,
      howDidYouHearAboutUs: row.howDidYouHearAboutUs ?? null,
      policiesAcceptedAt: row.policiesAcceptedAt ?? null,
      // Account Lifecycle (Phase B1D) — surfaced so the admin Student Detail
      // page can render a status badge and gate the Danger Zone controls.
      accountStatus: row.accountStatus,
      deactivatedAt: row.deactivatedAt ?? null,
    },
    completion: permissions.canViewProfileCompletion ? completion : null,
    membershipStatus,
    stats,
    danceInterests: permissions.canViewProfileCompletion ? danceInterests : [],
    children: permissions.canViewChildren
      ? children.map((c) => ({
          id: c.id,
          fullName: c.fullName,
          dateOfBirth: c.dateOfBirth ?? null,
          birthday: c.birthday ?? null,
          age: deriveChildDisplayAge(c.dateOfBirth ?? null, c.age ?? null),
          gender: c.gender,
          medicalNotes: c.medicalNotes ?? null,
          emergencyName: c.emergencyName ?? null,
          emergencyPhone: c.emergencyPhone ?? null,
        }))
      : [],
    packages: {
      active: stats.activePackage,
      recent: permissions.canViewPackages
        ? recentPackages.map((p) => ({
            id: p.id,
            packageName: p.packageName,
            status: p.status,
            totalCredits: p.totalCredits,
            remainingCredits: p.remainingCredits,
            activatedAt: p.activatedAt ?? null,
            expiresAt: p.expiresAt ?? null,
            createdAt: p.createdAt,
          }))
        : [],
    },
    bookings: permissions.canViewBookings ? recentBookings : [],
    attendance: permissions.canViewAttendance ? recentAttendance : [],
    feedback: permissions.canViewFeedback ? recentFeedback : [],
    creditTransactions: permissions.canViewCredits ? creditTransactions : [],
    timeline: timeline.slice(0, 30),
    permissions,
  };
}

function handleStudentOverviewError(res: { status: (code: number) => { json: (body: unknown) => void } }, err: unknown): void {
  if (err instanceof StudentOverviewHttpError) {
    res.status(err.status).json(err.body);
    return;
  }
  console.error("[students] overview failed:", err);
  res.status(500).json({ error: "Failed to load student overview" });
}

router.get("/students/:id/overview", requireAdminAuth, async (req: AdminRequest, res): Promise<void> => {
  const params = GetStudentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    res.json(await buildStudentOverviewData(req, params.data.id));
  } catch (err) {
    handleStudentOverviewError(res, err);
  }
});

router.get("/students/:id/overview.pdf", requireAdminAuth, async (req: AdminRequest, res): Promise<void> => {
  const params = GetStudentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const overview = await buildStudentOverviewData(req, params.data.id, EXPORT_OVERVIEW_LIMITS);
    const buf = await buildStudentProfilePdfBuffer({
      overview,
      generatedBy: req.adminUser?.username ?? "Admin",
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${studentProfilePdfFilename(overview.user.id, overview.user.name)}"`);
    res.send(buf);
  } catch (err) {
    handleStudentOverviewError(res, err);
  }
});

router.patch("/students/:id", blockStudentJwt, requireAdminAuth, async (req: AdminRequest, res): Promise<void> => {
  const params = UpdateStudentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [existing] = await db
    .select({
      id: studentsTable.id,
      name: studentsTable.name,
      email: studentsTable.email,
      phone: studentsTable.phone,
      notes: studentsTable.notes,
      totalBookings: studentsTable.totalBookings,
      accountType: studentsTable.accountType,
    })
    .from(studentsTable)
    .where(eq(studentsTable.id, params.data.id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Student not found" });
    return;
  }

  const targetModule = accountModule(existing.accountType);
  if (!adminCan(req, "users", "edit") && !adminCan(req, targetModule, "edit")) {
    res.status(403).json({
      error: "Permission denied",
      requiredPermission: { anyOf: [`users.edit`, `${targetModule}.edit`] },
    });
    return;
  }

  const parsed = UpdateStudentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data.email
    ? { ...parsed.data, email: normalizeEmail(parsed.data.email) }
    : parsed.data;
  const [row] = await db.update(studentsTable).set(data).where(eq(studentsTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Student not found" });
    return;
  }
  const { before, after } = diffFields(
    studentActivitySnapshot(existing),
    studentActivitySnapshot(row),
    STUDENT_ACTIVITY_FIELDS,
  );
  const changedKeys = Object.keys(after);
  if (changedKeys.length > 0) {
    const moduleKey = accountModule(row.accountType);
    await logActivity(req, {
      action: "update",
      module: moduleKey,
      entityType: moduleKey === "parents" ? "parent" : "student",
      entityId: row.id,
      entityLabel: row.name,
      before,
      after,
      summary: `Updated ${moduleKey === "parents" ? "parent" : "student"} ${row.name}: ${changedKeys.join(", ")}`,
    });
  }
  res.json(UpdateStudentResponse.parse(row));
});

// ── Account lifecycle: deactivate / reactivate (Phase B1B) ─────────────────
// Neither route can reach account_status='deleted' — that value exists only
// in the CHECK constraint ahead of a future tombstone phase. Permission is
// gated on the SAME module/action the PATCH route above already uses for
// account-management edits (students.edit / parents.edit, chosen by the
// target's accountType via accountModule()) — a lifecycle action was not
// added to lib/api-zod/src/permissions.ts because "edit" already represents
// "manage this account" and deactivation/reactivation is squarely that.
router.post("/students/:id/deactivate", blockStudentJwt, requireAdminAuth, async (req: AdminRequest, res): Promise<void> => {
  const params = UpdateStudentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 500) : undefined;

  const [existing] = await db
    .select({ id: studentsTable.id, accountType: studentsTable.accountType, name: studentsTable.name })
    .from(studentsTable)
    .where(eq(studentsTable.id, params.data.id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Student not found" });
    return;
  }

  const targetModule = accountModule(existing.accountType);
  if (!adminCan(req, "users", "edit") && !adminCan(req, targetModule, "edit")) {
    res.status(403).json({
      error: "Permission denied",
      requiredPermission: { anyOf: [`users.edit`, `${targetModule}.edit`] },
    });
    return;
  }

  const adminId = req.adminUser!.id;
  const outcome = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ id: studentsTable.id, accountStatus: studentsTable.accountStatus })
      .from(studentsTable)
      .where(eq(studentsTable.id, params.data.id))
      .for("update")
      .limit(1);
    if (!locked) return { kind: "notFound" as const };

    if (locked.accountStatus === "deactivated") {
      return { kind: "noop" as const, status: locked.accountStatus };
    }
    if (locked.accountStatus !== "active") {
      // Defensive: no route can put a row in "deleted" this phase, but never
      // transition out of it if one somehow existed (e.g. manual DB edit).
      return { kind: "conflict" as const, status: locked.accountStatus };
    }

    await tx
      .update(studentsTable)
      .set({
        accountStatus: "deactivated",
        deactivatedAt: new Date().toISOString(),
        deactivatedByAdminId: adminId,
        tokenVersion: sql`${studentsTable.tokenVersion} + 1`,
      })
      .where(eq(studentsTable.id, params.data.id));

    await tx
      .update(notificationDevicesTable)
      .set({ isActive: false })
      .where(eq(notificationDevicesTable.studentId, params.data.id));

    return { kind: "deactivated" as const };
  });

  if (outcome.kind === "notFound") {
    res.status(404).json({ error: "Student not found" });
    return;
  }
  if (outcome.kind === "conflict") {
    res.status(409).json({ error: "Account cannot be deactivated from its current state.", accountStatus: outcome.status });
    return;
  }
  if (outcome.kind === "noop") {
    // Idempotent: already deactivated. No additional token_version bump,
    // no duplicate audit event.
    res.status(200).json({ id: existing.id, accountStatus: "deactivated" });
    return;
  }

  res.status(200).json({ id: existing.id, accountStatus: "deactivated" });

  // Audit AFTER commit, per activityLog.ts's documented contract.
  await logActivity(req, {
    action: "deactivate",
    module: targetModule,
    entityType: targetModule === "parents" ? "parent" : "student",
    entityId: existing.id,
    entityLabel: existing.name,
    summary: `Deactivated ${targetModule === "parents" ? "parent" : "student"} ${existing.name}`,
    ...(reason ? { after: { reason } } : {}),
  });
});

router.post("/students/:id/reactivate", blockStudentJwt, requireAdminAuth, async (req: AdminRequest, res): Promise<void> => {
  const params = UpdateStudentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [existing] = await db
    .select({ id: studentsTable.id, accountType: studentsTable.accountType, name: studentsTable.name })
    .from(studentsTable)
    .where(eq(studentsTable.id, params.data.id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Student not found" });
    return;
  }

  const targetModule = accountModule(existing.accountType);
  if (!adminCan(req, "users", "edit") && !adminCan(req, targetModule, "edit")) {
    res.status(403).json({
      error: "Permission denied",
      requiredPermission: { anyOf: [`users.edit`, `${targetModule}.edit`] },
    });
    return;
  }

  const outcome = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ id: studentsTable.id, accountStatus: studentsTable.accountStatus })
      .from(studentsTable)
      .where(eq(studentsTable.id, params.data.id))
      .for("update")
      .limit(1);
    if (!locked) return { kind: "notFound" as const };

    if (locked.accountStatus === "active") {
      return { kind: "noop" as const };
    }
    if (locked.accountStatus === "deleted") {
      return { kind: "conflict" as const };
    }

    // notification_devices is deliberately untouched here — reactivation
    // does not resurrect old disabled devices; a fresh login + device
    // registration is required to get a new active device row.
    await tx
      .update(studentsTable)
      .set({
        accountStatus: "active",
        deactivatedAt: null,
        deactivatedByAdminId: null,
        tokenVersion: sql`${studentsTable.tokenVersion} + 1`,
      })
      .where(eq(studentsTable.id, params.data.id));

    return { kind: "reactivated" as const };
  });

  if (outcome.kind === "notFound") {
    res.status(404).json({ error: "Student not found" });
    return;
  }
  if (outcome.kind === "conflict") {
    res.status(409).json({ error: "Account cannot be reactivated from its current state." });
    return;
  }
  if (outcome.kind === "noop") {
    res.status(200).json({ id: existing.id, accountStatus: "active" });
    return;
  }

  res.status(200).json({ id: existing.id, accountStatus: "active" });

  await logActivity(req, {
    action: "reactivate",
    module: targetModule,
    entityType: targetModule === "parents" ? "parent" : "student",
    entityId: existing.id,
    entityLabel: existing.name,
    summary: `Reactivated ${targetModule === "parents" ? "parent" : "student"} ${existing.name}`,
  });
});

// Student account hard-deletion is intentionally disabled. The prior
// implementation performed a raw, untransacted DELETE with no audit logging
// that could either violate FK/CHECK constraints (promotion_redemptions,
// bookings/package_orders/payment_records/credit_transactions/attendance
// participant_shape checks on child-scoped activity) or, where it succeeded,
// leave PII behind and dangling references in credit_transactions, feedback,
// and email_otps. A safe account lifecycle workflow (deletion funnel /
// anonymization / deactivation) is planned separately; until it ships, this
// route unconditionally rejects the destructive operation for every caller,
// including Super Admin. The auth chain (blockStudentJwt, requireAdminAuth,
// requireAdminPermission) is preserved so unauthenticated and unauthorized
// callers still get the normal 401/403 responses rather than this 405.
router.delete(
  "/students/:id",
  blockStudentJwt,
  requireAdminAuth,
  requireAdminPermission("users", "delete"),
  (_req: AdminRequest, res): void => {
    res.status(405).json({
      error: "Student account deletion is temporarily unavailable while the safe account lifecycle workflow is being used.",
      code: "STUDENT_ACCOUNT_DELETION_DISABLED",
    });
  },
);

export default router;
