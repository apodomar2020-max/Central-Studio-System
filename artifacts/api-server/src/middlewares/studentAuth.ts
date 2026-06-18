/**
 * requireStudentAuth — student identity gate for student-scoped routes.
 *
 * ─── How it works ────────────────────────────────────────────────────────────
 *
 * This middleware must run AFTER requireAuth (which is applied globally in
 * app.ts). requireAuth performs the actual JWT verification: if the Bearer
 * token is a valid student JWT, it sets:
 *
 *   req.studentId          — numeric student ID (from JWT sub claim)
 *   req.studentEmail       — email (from JWT email claim)
 *   req.studentJwtVerified — true
 *
 * requireStudentAuth simply asserts those properties are present. It does NOT
 * re-verify the token — that would be redundant and wasteful. If requireAuth
 * has not run or the request used an API key instead of a student JWT, this
 * middleware returns 401.
 *
 * ─── Security guarantee ──────────────────────────────────────────────────────
 *
 * req.studentId can ONLY be set by requireAuth after successfully verifying a
 * JWT signed with STUDENT_JWT_SECRET. No client header can set it directly —
 * the X-Student-Id header pattern is intentionally NOT consulted here.
 *
 * A route protected by requireStudentAuth knows the student identity is
 * cryptographically verified. The route handler can use req.studentId safely
 * to scope DB queries: WHERE parent_id = req.studentId.
 *
 * ─── Usage ───────────────────────────────────────────────────────────────────
 *
 * import { requireStudentAuth } from "../middlewares/studentAuth";
 *
 * // Apply to an entire router:
 * router.use("/children", requireStudentAuth);
 *
 * // Or to a single route:
 * router.get("/ballet/my-application", requireStudentAuth, handler);
 */

import type { NextFunction, Request, Response } from "express";

export function requireStudentAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.studentJwtVerified || typeof req.studentId !== "number") {
    res.status(401).json({
      error: "Student authentication required. Please log in to continue.",
    });
    return;
  }
  next();
}

/**
 * requireVerifiedStudent — like requireStudentAuth, but additionally rejects
 * accounts whose email is not yet verified.
 *
 * Mandatory email verification: a "limited" token issued to an unverified
 * account carries emailVerified=false in its claims (surfaced as
 * req.studentEmailVerified). Such a token is accepted only by OTP and /auth/me
 * routes; every other student-scoped route uses this guard and returns 403
 * with { requiresOtp: true } so the client can route the user to the OTP screen.
 *
 * Legacy tokens issued before this feature have no emailVerified claim
 * (req.studentEmailVerified === undefined). Those are grandfathered through —
 * we only block an explicit `false`.
 */
export function requireVerifiedStudent(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.studentJwtVerified || typeof req.studentId !== "number") {
    res.status(401).json({
      error: "Student authentication required. Please log in to continue.",
    });
    return;
  }
  if (req.studentEmailVerified === false) {
    res.status(403).json({
      error: "Email verification required.",
      requiresOtp: true,
      email: req.studentEmail,
    });
    return;
  }
  next();
}
