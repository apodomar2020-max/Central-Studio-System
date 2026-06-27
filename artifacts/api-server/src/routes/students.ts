import { blockStudentJwt } from "../middlewares/auth";
import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, studentsTable, packageOrdersTable, bookingsTable, childrenTable } from "@workspace/db";
import {
  CreateStudentBody,
  GetStudentParams,
  GetStudentResponse,
  UpdateStudentParams,
  UpdateStudentBody,
  UpdateStudentResponse,
  DeleteStudentParams,
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

  const allRows = await db.select().from(studentsTable).orderBy(studentsTable.joinedAt);
  const rows = allRows.filter((student) =>
    student.accountType === "parent" ? canViewParents : canViewStudents,
  );
  const bookingRows = await db
    .select({
      studentEmail: bookingsTable.studentEmail,
      bookingStatus: bookingsTable.bookingStatus,
    })
    .from(bookingsTable);

  const bookingCounts = new Map<string, number>();
  for (const booking of bookingRows) {
    const status = booking.bookingStatus.trim().toLowerCase();
    if (status === "cancelled" || status === "rejected") continue;
    const email = normalizeEmail(booking.studentEmail);
    bookingCounts.set(email, (bookingCounts.get(email) ?? 0) + 1);
  }

  const childCounts = new Map<number, number>();
  if (canViewChildren) {
    const childrenRows = await db
      .select({ parentId: childrenTable.parentId })
      .from(childrenTable);
    for (const child of childrenRows) {
      childCounts.set(child.parentId, (childCounts.get(child.parentId) ?? 0) + 1);
    }
  }

  res.json(ListStudentsResponse.parse(
    rows.map((student) => ({
      ...student,
      totalBookings: bookingCounts.get(normalizeEmail(student.email)) ?? 0,
      ...(canViewChildren ? { childCount: childCounts.get(student.id) ?? 0 } : {}),
    })),
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
