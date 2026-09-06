/**
 * Children routes — /api/children
 *
 * All routes require:
 *   1. requireAuth        — applied globally in app.ts. Accepts either the
 *                           shared API key OR a signed student JWT. A valid
 *                           student JWT sets req.studentId and req.studentJwtVerified.
 *   2. requireStudentAuth — asserts req.studentJwtVerified is true. Rejects
 *                           requests that arrived with only an API key.
 *
 * Ownership is enforced at the DB level:
 *   All queries include WHERE parent_id = req.studentId.
 *   req.studentId is sourced exclusively from the verified JWT — not from any
 *   client-controlled header. X-Student-Id is intentionally ignored here.
 *
 * Routes:
 *   GET    /api/children          — list own children
 *   POST   /api/children          — create child (parentId injected server-side)
 *   PATCH  /api/children/:id      — update own child
 *   DELETE /api/children/:id      — delete own child
 */

import { Router, type IRouter } from "express";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import {
  balletApplicationsTable,
  bookingsTable,
  childrenTable,
  db,
  packageOrdersTable,
  studentsTable,
} from "@workspace/db";
import { insertChildSchema, updateChildSchema } from "@workspace/db";
import { requireStudentAuth, requireVerifiedStudent } from "../middlewares/studentAuth";
import { logger } from "../lib/logger";

/**
 * Profile Completion Engine (Phase 4) — best-effort resume hint only; never
 * read by the completion calculation itself (see lib/profileCompletion.ts).
 */
async function stampLastCompletionStep(studentId: number, step: "children" | "medical"): Promise<void> {
  await db
    .update(studentsTable)
    .set({ lastCompletionStep: step, updatedAt: new Date().toISOString() })
    .where(eq(studentsTable.id, studentId));
}

const router: IRouter = Router();

type ChildDateOfBirthLockReason = "class_booking" | "package_subscription" | "ballet_application";

type ChildDateOfBirthLockPolicy = {
  locked: boolean;
  reasons: ChildDateOfBirthLockReason[];
};

async function childDateOfBirthLockPolicies(childIds: number[]): Promise<Map<number, ChildDateOfBirthLockPolicy>> {
  const policies = new Map<number, ChildDateOfBirthLockPolicy>();
  for (const childId of childIds) policies.set(childId, { locked: false, reasons: [] });
  if (childIds.length === 0) return policies;

  const [bookingRows, packageRows, balletRows] = await Promise.all([
    db.select({ childId: bookingsTable.participantChildId }).from(bookingsTable)
      .where(inArray(bookingsTable.participantChildId, childIds)),
    db.select({ childId: packageOrdersTable.participantChildId }).from(packageOrdersTable)
      .where(inArray(packageOrdersTable.participantChildId, childIds)),
    db.select({ childId: balletApplicationsTable.childId }).from(balletApplicationsTable)
      .where(inArray(balletApplicationsTable.childId, childIds)),
  ]);

  const addReason = (childId: number | null, reason: ChildDateOfBirthLockReason) => {
    if (childId == null) return;
    const policy = policies.get(childId);
    if (!policy || policy.reasons.includes(reason)) return;
    policy.locked = true;
    policy.reasons.push(reason);
  };
  for (const row of bookingRows) addReason(row.childId, "class_booking");
  for (const row of packageRows) addReason(row.childId, "package_subscription");
  for (const row of balletRows) addReason(row.childId, "ballet_application");
  return policies;
}

// All routes in this file require a verified student JWT (and a verified email).
// X-Student-Id is NOT consulted — identity comes from the signed token only.
router.use("/children", requireStudentAuth, requireVerifiedStudent);

// ─── GET /api/children ────────────────────────────────────────────────────────
// Returns all children belonging to the authenticated student, ordered by name.
router.get("/children", async (req, res): Promise<void> => {
  const studentId = req.studentId!;

  const rows = await db
    .select()
    .from(childrenTable)
    .where(eq(childrenTable.parentId, studentId))
    .orderBy(asc(childrenTable.fullName));

  // Strip qrToken — it is internal and must never be returned to clients.
  const policies = await childDateOfBirthLockPolicies(rows.map((row) => row.id));
  const safe = rows.map(({ qrToken: _qt, ...rest }) => ({
    ...rest,
    dateOfBirthLocked: policies.get(rest.id)?.locked ?? false,
    dateOfBirthLockReasons: policies.get(rest.id)?.reasons ?? [],
  }));

  res.json({ children: safe });
});

// ─── POST /api/children ───────────────────────────────────────────────────────
// Creates a new child belonging to the authenticated student.
router.post("/children", async (req, res): Promise<void> => {
  const studentId = req.studentId!;

  const parsed = insertChildSchema.safeParse(req.body);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    res.status(400).json({ error: firstIssue?.message ?? "Invalid input" });
    return;
  }

  const [row] = await db
    .insert(childrenTable)
    .values({
      ...parsed.data,
      parentId: studentId, // always injected server-side, never trusted from client
    })
    .returning();

  if (!row) {
    res.status(500).json({ error: "Failed to create child" });
    return;
  }

  logger.info({ childId: row.id, parentId: studentId }, "Child created");
  await stampLastCompletionStep(studentId, "children");

  const { qrToken: _qt, ...safe } = row;
  res.status(201).json({ child: safe });
});

// ─── PATCH /api/children/:id ──────────────────────────────────────────────────
// Updates a child. Ownership enforced by WHERE parent_id = studentId.
router.patch("/children/:id", async (req, res): Promise<void> => {
  const studentId = req.studentId!;

  const idParsed = z.coerce.number().int().positive().safeParse(req.params["id"]);
  if (!idParsed.success) {
    res.status(400).json({ error: "Invalid child id" });
    return;
  }
  const childId = idParsed.data;

  const parsed = updateChildSchema.safeParse(req.body);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    res.status(400).json({ error: firstIssue?.message ?? "Invalid input" });
    return;
  }

  if (Object.keys(parsed.data).length === 0) {
    res.status(400).json({ error: "No fields provided to update" });
    return;
  }

  const [existing] = await db
    .select()
    .from(childrenTable)
    .where(and(eq(childrenTable.id, childId), eq(childrenTable.parentId, studentId)))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Child not found" });
    return;
  }

  const currentDateOfBirth = existing.dateOfBirth ?? existing.birthday ?? null;
  const requestedDateOfBirth = parsed.data.dateOfBirth !== undefined
    ? parsed.data.dateOfBirth
    : parsed.data.birthday !== undefined
      ? parsed.data.birthday
      : currentDateOfBirth;
  const changesDateOfBirth = requestedDateOfBirth !== currentDateOfBirth;
  const changesAge = parsed.data.age !== undefined && parsed.data.age !== existing.age;

  if (changesDateOfBirth || changesAge) {
    const policy = (await childDateOfBirthLockPolicies([childId])).get(childId)!;
    if (policy.locked) {
      res.status(409).json({
        error: "Date of birth cannot be changed after this child has a class booking, package, or Ballet application.",
        code: "CHILD_DATE_OF_BIRTH_LOCKED",
        reasons: policy.reasons,
      });
      return;
    }
  }

  // The AND condition enforces ownership: a student cannot update
  // a child that belongs to a different parent even if they know the ID.
  const [row] = await db
    .update(childrenTable)
    .set(parsed.data)
    .where(and(
      eq(childrenTable.id, childId),
      eq(childrenTable.parentId, studentId),
    ))
    .returning();

  if (!row) {
    // Could be not found OR owned by a different student — both return 404
    // to avoid leaking the existence of other users' children.
    res.status(404).json({ error: "Child not found" });
    return;
  }

  logger.info({ childId, parentId: studentId }, "Child updated");
  if (Object.prototype.hasOwnProperty.call(parsed.data, "medicalNotes")) {
    await stampLastCompletionStep(studentId, "medical");
  }

  const { qrToken: _qt, ...safe } = row;
  const policy = (await childDateOfBirthLockPolicies([row.id])).get(row.id)!;
  res.json({ child: {
    ...safe,
    dateOfBirthLocked: policy.locked,
    dateOfBirthLockReasons: policy.reasons,
  } });
});

// ─── DELETE /api/children/:id ─────────────────────────────────────────────────
// Deletes a child. Ownership enforced by WHERE parent_id = studentId.
// Returns 204 No Content on success.
router.delete("/children/:id", async (req, res): Promise<void> => {
  const studentId = req.studentId!;

  const idParsed = z.coerce.number().int().positive().safeParse(req.params["id"]);
  if (!idParsed.success) {
    res.status(400).json({ error: "Invalid child id" });
    return;
  }
  const childId = idParsed.data;

  const [row] = await db
    .delete(childrenTable)
    .where(and(
      eq(childrenTable.id, childId),
      eq(childrenTable.parentId, studentId),
    ))
    .returning({ id: childrenTable.id });

  if (!row) {
    res.status(404).json({ error: "Child not found" });
    return;
  }

  logger.info({ childId, parentId: studentId }, "Child deleted");

  res.sendStatus(204);
});

export default router;
