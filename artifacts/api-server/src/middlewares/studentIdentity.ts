/**
 * Student Identity Middleware
 *
 * ─── Why this exists ─────────────────────────────────────────────────────────
 *
 * The existing requireAuth middleware validates only the shared API_SECRET_KEY.
 * It proves the request came from an authorised client (the mobile app or admin
 * dashboard), but it does NOT identify WHICH student is making the request.
 *
 * For student-scoped resources (children, future ballet applications), we need
 * to know the student's identity so we can enforce ownership:
 *   WHERE parent_id = <requesting student's id>
 *
 * ─── Temporary approach (pre-JWT) ────────────────────────────────────────────
 *
 * The mobile app sends the student's numeric ID in the X-Student-Id request
 * header alongside the existing API key. The middleware:
 *   1. Reads the X-Student-Id header.
 *   2. Validates it is a positive integer.
 *   3. Confirms the student exists in the database (prevents faking an
 *      arbitrary number for an account that was deleted).
 *   4. Attaches req.studentId (number) for use in route handlers.
 *
 * ─── Known limitation ────────────────────────────────────────────────────────
 *
 * A malicious actor who already has the API key could send any valid student ID.
 * This is mitigated by the fact that:
 *   - The API key is not public and is only embedded in the mobile app binary.
 *   - Children data is new — there are no existing records to steal.
 *   - This approach is upgrade-safe: when student JWTs are added, only this
 *     middleware changes (validate the JWT signature instead of the header).
 *
 * ─── Upgrade path (Phase N) ──────────────────────────────────────────────────
 *
 * POST /api/auth/login should return a signed student JWT (e.g., via jsonwebtoken).
 * requireStudentIdentity then verifies the JWT and extracts studentId from the
 * claims — no API change needed in any route handler.
 */

import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db, studentsTable } from "@workspace/db";
import { logger } from "../lib/logger";

// Extend Express Request to include studentId after this middleware runs.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      studentId?: number;
    }
  }
}

export async function requireStudentIdentity(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const raw = req.headers["x-student-id"];
  const headerValue = Array.isArray(raw) ? raw[0] : raw;

  if (!headerValue) {
    res.status(401).json({ error: "Missing X-Student-Id header" });
    return;
  }

  const studentId = parseInt(headerValue, 10);
  if (!Number.isInteger(studentId) || studentId <= 0) {
    res.status(400).json({ error: "Invalid X-Student-Id header: must be a positive integer" });
    return;
  }

  // Verify the student actually exists.
  // Uses a SELECT on the indexed primary key — negligible overhead.
  const [student] = await db
    .select({ id: studentsTable.id })
    .from(studentsTable)
    .where(eq(studentsTable.id, studentId))
    .limit(1);

  if (!student) {
    logger.warn({ studentId, path: req.path }, "requireStudentIdentity: student not found");
    res.status(401).json({ error: "Student account not found" });
    return;
  }

  req.studentId = studentId;
  next();
}
