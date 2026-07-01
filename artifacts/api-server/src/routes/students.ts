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
} from "@workspace/db";
import {
  CreateStudentBody,
  GetStudentParams,
  GetStudentResponse,
  UpdateStudentParams,
  UpdateStudentBody,
  UpdateStudentResponse,
  DeleteStudentParams,
  ListStudentsQueryParams,
  ListStudentsResponse,
  GetStudentByTokenParams,
  hasRolePermission,
} from "@workspace/api-zod";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";

const router: IRouter = Router();

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
  const parentIds = rows
    .filter((student) => student.accountType === "parent")
    .map((student) => student.id);
  if (canViewChildren && parentIds.length > 0) {
    const childrenRows = await db
      .select({ parentId: childrenTable.parentId, total: sql<number>`count(*)::int` })
      .from(childrenTable)
      .where(inArray(childrenTable.parentId, parentIds))
      .groupBy(childrenTable.parentId);
    for (const child of childrenRows) {
      childCounts.set(child.parentId, Number(child.total ?? 0));
    }
  }

  res.json(ListStudentsResponse.parse(
    {
      students: rows.map((student) => ({
        ...student,
        totalBookings: bookingCounts.get(normalizeEmail(student.email)) ?? 0,
        ...(canViewChildren ? { childCount: childCounts.get(student.id) ?? 0 } : {}),
      })),
      total,
      page,
      pageSize,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    },
  ));
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
        birthday: c.birthday ?? null,
        age: c.age ?? null,
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

router.get("/students/:id/overview", requireAdminAuth, async (req: AdminRequest, res): Promise<void> => {
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

  const email = normalizeEmail(row.email);
  const ownerCondition = sql`(${bookingsTable.accountOwnerStudentId} = ${row.id} OR lower(trim(${bookingsTable.studentEmail})) = ${email})`;

  const permissions = {
    canViewChildren: adminCan(req, "children", "view"),
    canViewBookings: adminCan(req, "bookings", "view"),
    canViewAttendance: adminCan(req, "attendance", "view"),
    canViewPackages: adminCan(req, "packageOrders", "view"),
    canViewCredits: adminCan(req, "credits", "history"),
    canViewFeedback: adminCan(req, "feedback", "view"),
    canViewFeedbackComments: adminCan(req, "feedback", "viewComments"),
  };

  // ---------------------------------------------------------------------
  // Children (parent accounts only)
  // ---------------------------------------------------------------------
  const childrenPromise =
    permissions.canViewChildren && row.accountType === "parent"
      ? db.select().from(childrenTable).where(eq(childrenTable.parentId, row.id))
      : Promise.resolve([]);

  // ---------------------------------------------------------------------
  // Bookings — total count (excluding cancelled/rejected, matching the
  // Students list page's own totalBookings definition) + recent 10
  // ---------------------------------------------------------------------
  const totalBookingsPromise = permissions.canViewBookings
    ? db
        .select({ total: sql<number>`count(*)::int` })
        .from(bookingsTable)
        .where(sql`${ownerCondition} AND lower(trim(${bookingsTable.bookingStatus})) not in ('cancelled', 'rejected')`)
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
        .limit(10)
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
        .limit(10)
    : Promise.resolve([]);

  // ---------------------------------------------------------------------
  // Packages — active package + recent 5. No integer FK exists from
  // package_orders to students, only studentEmail (see schema comment on
  // packageOrdersTable.packageId re: legacy FK) — so we cannot reliably
  // join to a price. Amount-paid is intentionally omitted rather than
  // guessed from a possibly-stale packageId.
  // ---------------------------------------------------------------------
  const activePackagePromise = permissions.canViewPackages
    ? db
        .select()
        .from(packageOrdersTable)
        .where(and(
          eq(packageOrdersTable.studentEmail, row.email),
          eq(packageOrdersTable.status, "active"),
          sql`${packageOrdersTable.remainingCredits} > 0`,
        ))
        .orderBy(sql`${packageOrdersTable.expiresAt} asc nulls last`)
        .limit(1)
        .then((r) => r[0] ?? null)
    : Promise.resolve(null);

  const recentPackagesPromise = permissions.canViewPackages
    ? db
        .select()
        .from(packageOrdersTable)
        .where(eq(packageOrdersTable.studentEmail, row.email))
        .orderBy(desc(packageOrdersTable.createdAt))
        .limit(5)
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
        .where(eq(packageOrdersTable.studentEmail, row.email))
        .then((orders) => {
          const orderIds = orders.map((o) => o.id);
          if (orderIds.length === 0) return [];
          return db
            .select()
            .from(creditTransactionsTable)
            .where(inArray(creditTransactionsTable.packageOrderId, orderIds))
            .orderBy(desc(creditTransactionsTable.createdAt))
            .limit(10);
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
        .limit(10)
    : Promise.resolve([]);

  const [
    children,
    totalBookings,
    recentBookingsRaw,
    totalAttendance,
    recentAttendanceRaw,
    activePackage,
    recentPackages,
    creditTransactions,
    feedbackAgg,
    recentFeedbackRaw,
  ] = await Promise.all([
    childrenPromise,
    totalBookingsPromise,
    recentBookingsPromise,
    totalAttendancePromise,
    recentAttendancePromise,
    activePackagePromise,
    recentPackagesPromise,
    creditTransactionsPromise,
    feedbackAggPromise,
    recentFeedbackPromise,
  ]);

  const recentBookings = recentBookingsRaw.map((b) => ({
    id: b.id,
    bookingNumber: `#${b.id}`,
    classTitle: b.classTitle ?? null,
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
    remainingCredits: activePackage?.remainingCredits ?? null,
    packageExpiry: activePackage?.expiresAt ?? null,
    feedbackAverage: feedbackAgg.avg,
    feedbackCount: feedbackAgg.count,
    lastActivity,
  };

  // ---------------------------------------------------------------------
  // Profile completion — current (Phase-1-pending) definition only checks
  // name/phone/accountType, exactly matching profileMissingFields() in
  // routes/auth.ts. Gender/DOB/city/nationality/how-did-you-know-us/dance
  // interests are NOT yet collected anywhere in the system — surfaced as
  // null so the UI can render "Not collected yet" rather than fake a value.
  // ---------------------------------------------------------------------
  const trackedFields = [row.name, row.phone, row.accountType].filter((v) => v != null && v !== "");
  const profileCompletionPercent = row.profileCompleted
    ? 100
    : Math.round((trackedFields.length / 3) * 100);
  const verificationBadge = row.emailVerified && row.profileCompleted;

  const completion = {
    emailVerified: row.emailVerified,
    profileCompleted: row.profileCompleted,
    profileCompletedAt: row.profileCompletedAt ?? null,
    profileCompletionPercent,
    verificationBadge,
    note: "Interim definition based on 3 currently-tracked fields (name, phone, account type). The full Profile Completion Engine (gender, birthday, city, nationality, how-did-you-know-us, dance interests) is a separate, not-yet-implemented phase.",
    fieldsNotYetCollected: ["gender", "dateOfBirth", "city", "nationality", "howDidYouKnowUs", "danceInterests"],
  };

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

  res.json({
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
      // Not yet collected anywhere in the system (Phase 1 — Profile Completion
      // Engine — not implemented). Always null until that phase ships.
      gender: null,
      dateOfBirth: null,
      city: null,
      nationality: null,
      howDidYouKnowUs: null,
    },
    completion,
    stats,
    children: permissions.canViewChildren
      ? children.map((c) => ({
          id: c.id,
          fullName: c.fullName,
          birthday: c.birthday ?? null,
          age: c.age ?? null,
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
  });
});

router.patch("/students/:id", blockStudentJwt, requireAdminAuth, async (req: AdminRequest, res): Promise<void> => {
  const params = UpdateStudentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [existing] = await db
    .select({ id: studentsTable.id, accountType: studentsTable.accountType })
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
  res.json(UpdateStudentResponse.parse(row));
});

router.delete("/students/:id", blockStudentJwt, requireAdminAuth, async (req: AdminRequest, res): Promise<void> => {
  const params = DeleteStudentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [existing] = await db
    .select({ id: studentsTable.id, accountType: studentsTable.accountType })
    .from(studentsTable)
    .where(eq(studentsTable.id, params.data.id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Student not found" });
    return;
  }

  const targetModule = accountModule(existing.accountType);
  if (!adminCan(req, "users", "delete") && !adminCan(req, targetModule, "delete")) {
    res.status(403).json({
      error: "Permission denied",
      requiredPermission: { anyOf: [`users.delete`, `${targetModule}.delete`] },
    });
    return;
  }

  const [row] = await db.delete(studentsTable).where(eq(studentsTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Student not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
