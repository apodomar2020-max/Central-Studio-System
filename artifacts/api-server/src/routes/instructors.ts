import { blockStudentJwt } from "../middlewares/auth";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { and, eq, ne, sql } from "drizzle-orm";
import { db, instructorsTable, bookingsTable, classesTable } from "@workspace/db";
import { requireAdminAuth, requireAdminPermission } from "./adminAuth";
import {
  CreateInstructorBody,
  GetInstructorParams,
  GetInstructorResponse,
  UpdateInstructorParams,
  UpdateInstructorBody,
  UpdateInstructorResponse,
  DeleteInstructorParams,
  ListInstructorsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const requireInstructorMediaPermission = (req: Request, res: Response, next: NextFunction): void => {
  if (!Object.prototype.hasOwnProperty.call(req.body ?? {}, "photoUrl")) {
    next();
    return;
  }
  requireAdminPermission("instructors", "mediaManage")(req, res, next);
};

router.get("/instructors", async (req, res): Promise<void> => {
  const rows = await db.select().from(instructorsTable).orderBy(instructorsTable.createdAt);
  res.json(ListInstructorsResponse.parse(rows));
});

router.post("/instructors", blockStudentJwt, requireAdminAuth, requireAdminPermission("instructors", "create"), requireInstructorMediaPermission, async (req, res): Promise<void> => {
  const parsed = CreateInstructorBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.insert(instructorsTable).values(parsed.data).returning();
  res.status(201).json(GetInstructorResponse.parse(row));
});

router.get("/instructors/:id", async (req, res): Promise<void> => {
  const params = GetInstructorParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.select().from(instructorsTable).where(eq(instructorsTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "Instructor not found" });
    return;
  }
  res.json(GetInstructorResponse.parse(row));
});

// Unique-student count for an instructor — counts DISTINCT students who have a
// (non-cancelled) booking for any class taught by this instructor. A student who
// attended 100 classes still counts once. Computed in the database, never on the
// client.
//
// Identity precedence (most stable first):
//   1. accountOwnerStudentId — the stable account/student ID (primary).
//   2. normalized student_email (lower(trim(...))) — fallback for legacy rows
//      that predate owner IDs. Normalizing avoids casing/whitespace duplicates.
// A CASE expression picks ID when present, else the normalized email, so the two
// keyspaces never collide ("id:" / "email:" prefixes).
router.get("/instructors/:id/student-count", async (req, res): Promise<void> => {
  const params = GetInstructorParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const identity = sql`case
    when ${bookingsTable.accountOwnerStudentId} is not null
      then 'id:' || ${bookingsTable.accountOwnerStudentId}
    else 'email:' || lower(trim(${bookingsTable.studentEmail}))
  end`;
  const [row] = await db
    .select({ count: sql<number>`count(distinct ${identity})` })
    .from(bookingsTable)
    .innerJoin(classesTable, eq(bookingsTable.classId, classesTable.id))
    .where(and(eq(classesTable.instructorId, params.data.id), ne(bookingsTable.bookingStatus, "cancelled")));
  res.json({ studentCount: Number(row?.count ?? 0) });
});

router.patch("/instructors/:id", blockStudentJwt, requireAdminAuth, requireAdminPermission("instructors", "edit"), requireInstructorMediaPermission, async (req, res): Promise<void> => {
  const params = UpdateInstructorParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateInstructorBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.update(instructorsTable).set(parsed.data).where(eq(instructorsTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Instructor not found" });
    return;
  }
  res.json(UpdateInstructorResponse.parse(row));
});

router.delete("/instructors/:id", blockStudentJwt, requireAdminAuth, requireAdminPermission("instructors", "delete"), async (req, res): Promise<void> => {
  const params = DeleteInstructorParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.delete(instructorsTable).where(eq(instructorsTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Instructor not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
