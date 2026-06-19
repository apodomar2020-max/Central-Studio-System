import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, studentsTable, packageOrdersTable, bookingsTable } from "@workspace/db";
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
} from "@workspace/api-zod";

const router: IRouter = Router();

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
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
router.get("/students/by-token/:token", async (req, res): Promise<void> => {
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

router.get("/students", async (req, res): Promise<void> => {
  const rows = await db.select().from(studentsTable).orderBy(studentsTable.joinedAt);
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

  res.json(ListStudentsResponse.parse(
    rows.map((student) => ({
      ...student,
      totalBookings: bookingCounts.get(normalizeEmail(student.email)) ?? 0,
    })),
  ));
});

router.post("/students", async (req, res): Promise<void> => {
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

router.get("/students/:id", async (req, res): Promise<void> => {
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
  res.json(GetStudentResponse.parse(row));
});

router.patch("/students/:id", async (req, res): Promise<void> => {
  const params = UpdateStudentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
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

router.delete("/students/:id", async (req, res): Promise<void> => {
  const params = DeleteStudentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
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
