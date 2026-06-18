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
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db, childrenTable } from "@workspace/db";
import { insertChildSchema, updateChildSchema } from "@workspace/db";
import { requireStudentAuth, requireVerifiedStudent } from "../middlewares/studentAuth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

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
  const safe = rows.map(({ qrToken: _qt, ...rest }) => rest);

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

  const { qrToken: _qt, ...safe } = row;
  res.json({ child: safe });
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
