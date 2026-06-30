import { blockStudentJwt } from "../middlewares/auth";
import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, studentsTable, packageOrdersTable, bookingsTable, childrenTable } from "@workspace/db";
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
