/**
 * API authentication middleware.
 *
 * All routes under /api are protected except public diagnostic endpoints.
 *
 * Accepted credential formats:
 *   - Header:  X-Api-Key: <key>               (admin dashboard / server-to-server)
 *   - Header:  Authorization: Bearer <apiKey>  (mobile guest mode)
 *   - Header:  Authorization: Bearer <jwt>     (mobile logged-in — student JWT)
 *
 * Student JWT fast-path:
 *   If the Bearer token contains two dots (looks like a JWT), it is verified
 *   against STUDENT_JWT_SECRET (algorithm pinned to HS256 — defense in depth
 *   against an algorithm-confusion attack; every student token this server
 *   has ever issued is HS256, so this rejects nothing legitimate). A valid
 *   token with type="student" then has its embedded tokenVersion checked
 *   against the student's CURRENT token_version in the database (Security-02B,
 *   CS-SEC-H-03 — session revocation). Only once both checks pass does it set:
 *     req.studentId          — numeric student ID from the JWT sub claim
 *     req.studentEmail       — email from the JWT
 *     req.studentJwtVerified — true (flag used by requireStudentAuth)
 *   An invalid or revoked JWT returns 401 immediately (no API key fallback).
 *
 * ─── Session revocation (Security-02B) ───────────────────────────────────────
 *
 * A legacy token minted before this feature carries no tokenVersion claim —
 * it is treated as version 1, matching every existing row's DEFAULT 1, so
 * deploying this change alone invalidates nothing. A row's token_version is
 * bumped (atomically, `token_version = token_version + 1`) by password reset,
 * password change, and POST /auth/logout — each such bump immediately
 * invalidates every token issued before it, for every device, on this
 * token's very next request. There is no session table and no per-device
 * granularity in this phase: one bump revokes the whole account's tokens.
 *
 * This adds exactly one indexed DB read (`students.token_version` by primary
 * key) to what was previously a fully stateless verification path — the
 * accepted, documented cost of immediate revocation. No caching in this
 * phase, by design: caching would reintroduce the propagation-delay window
 * this feature exists to close.
 *
 * In development, if API_SECRET_KEY is not set the middleware logs a warning
 * and allows all requests through — so local dev still works without setup.
 * In production (NODE_ENV=production) a missing key causes startup to abort.
 */
import { timingSafeEqual } from "crypto";
import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db, studentsTable } from "@workspace/db";
import { logger } from "../lib/logger";

// ─── Global Express type extensions ──────────────────────────────────────────
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      studentId?: number;
      studentEmail?: string;
      studentJwtVerified?: boolean;
      // Email-verification state carried in the JWT. May be undefined for
      // legacy tokens issued before mandatory verification — see
      // requireVerifiedStudent, which only blocks an explicit `false`.
      studentEmailVerified?: boolean;
    }
  }
}

// Middleware is mounted at /api so Express strips that prefix —
// req.path inside here is "/healthz", not "/api/healthz".
const PUBLIC_PATHS = new Set(["/healthz", "/version"]);

const secretKey = process.env["API_SECRET_KEY"];

if (!secretKey) {
  if (process.env["NODE_ENV"] === "production") {
    throw new Error(
      "API_SECRET_KEY must be set in production. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  logger.warn(
    "API_SECRET_KEY is not set — all requests are allowed. " +
      "Set this env var before deploying to production.",
  );
}

// Student JWT secret — separate from the admin JWT secret.
export const STUDENT_JWT_SECRET =
  process.env["STUDENT_JWT_SECRET"] ?? "dev-student-secret-change-in-production";

if (!process.env["STUDENT_JWT_SECRET"]) {
  if (process.env["NODE_ENV"] === "production") {
    throw new Error(
      "STUDENT_JWT_SECRET must be set in production. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  logger.warn(
    "STUDENT_JWT_SECRET is not set — using insecure dev default. " +
      "Set this env var before deploying to production.",
  );
}

// Payload shape of a signed student JWT.
export interface StudentTokenPayload {
  sub: number;    // student.id
  email: string;
  type: "student";
  // Whether this student's email was verified at the time the token was issued.
  // Absent on legacy tokens. A "limited" token (unverified account) carries false.
  emailVerified?: boolean;
  // Session-revocation generation this token was issued under (Security-02B).
  // Absent on legacy tokens minted before this feature — treated as 1, the
  // same value every pre-existing student row defaults to. See
  // LEGACY_TOKEN_VERSION below.
  tokenVersion?: number;
}

/** Every student row (and every legacy JWT with no claim) starts here. */
export const LEGACY_TOKEN_VERSION = 1;

/** Response body for a token that failed the revocation check specifically —
 *  distinct from a merely malformed/expired one, so the client can safely
 *  distinguish "please sign in again" from other 401s (see requireAuth). */
const SESSION_REVOKED_BODY = {
  error: "Session expired. Please sign in again.",
  code: "SESSION_REVOKED",
} as const;

/** Returns true when a string looks like a JWT (header.payload.signature). */
function looksLikeJwt(token: string): boolean {
  // A JWT has exactly two dots separating three base64url segments.
  const parts = token.split(".");
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

function extractToken(req: Request): string | null {
  // X-Api-Key header (admin dashboard / server-to-server)
  const apiKey = req.headers["x-api-key"];
  if (typeof apiKey === "string" && apiKey.length > 0) return apiKey;

  // Authorization: Bearer <token> (mobile app — either shared key or student JWT)
  const authHeader = req.headers["authorization"];
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token.length > 0) return token;
  }

  return null;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Pass through if no key is configured (dev mode)
  if (!secretKey) {
    next();
    return;
  }

  // Skip auth for public paths
  if (PUBLIC_PATHS.has(req.path)) {
    next();
    return;
  }

  const token = extractToken(req);

  if (!token) {
    res.status(401).json({ error: "Missing authentication credentials" });
    return;
  }

  // ── Student JWT fast-path ────────────────────────────────────────────────
  // If the token looks like a JWT, treat it as a student access token.
  // We do NOT fall through to the API key check on failure — an invalid JWT
  // must be rejected outright to avoid token-downgrade confusion.
  if (looksLikeJwt(token)) {
    let payload: StudentTokenPayload;
    try {
      // algorithms pinned: defense-in-depth against algorithm confusion.
      // Every student token this server has ever issued is HS256 — this
      // rejects nothing legitimate, only a token forged under a different alg.
      payload = jwt.verify(token, STUDENT_JWT_SECRET, { algorithms: ["HS256"] }) as unknown as StudentTokenPayload;
    } catch (err) {
      logger.warn({ path: req.path, err }, "Invalid or expired student JWT");
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }
    if (payload.type !== "student") {
      logger.warn({ path: req.path }, "JWT token type is not 'student'");
      res.status(401).json({ error: "Invalid token type" });
      return;
    }

    // ── Session revocation (Security-02B, CS-SEC-H-03) ──────────────────────
    // A cryptographically valid, unexpired token can still have been revoked
    // by a password reset, password change, or logout that happened after it
    // was issued — none of which the signature alone can reflect. The only
    // way to know is to ask the database, on every request, for the
    // account's current generation.
    try {
      const [student] = await db
        .select({ tokenVersion: studentsTable.tokenVersion })
        .from(studentsTable)
        .where(eq(studentsTable.id, payload.sub))
        .limit(1);

      if (!student) {
        // Account no longer exists — never distinguish this from a normal
        // revocation in the response; both mean "this token cannot be used".
        logger.warn({ path: req.path, studentId: payload.sub }, "Student JWT for a nonexistent account");
        res.status(401).json(SESSION_REVOKED_BODY);
        return;
      }

      const tokenVersion = payload.tokenVersion ?? LEGACY_TOKEN_VERSION;
      if (tokenVersion !== student.tokenVersion) {
        // Deliberately do not include either version number in the response —
        // no internal state is exposed to the client, only the fact that
        // re-authentication is required.
        logger.info({ path: req.path, studentId: payload.sub }, "Student JWT rejected: session revoked");
        res.status(401).json(SESSION_REVOKED_BODY);
        return;
      }
    } catch (err) {
      // A DB failure here must not be treated as "authenticated" — fail
      // closed, and let the global error handler produce the standard
      // generic 5xx body (Security G-01) rather than leaking driver detail.
      next(err);
      return;
    }

    // Attach student identity — consumed by requireStudentAuth downstream.
    req.studentId = payload.sub;
    req.studentEmail = payload.email;
    req.studentJwtVerified = true;
    req.studentEmailVerified = payload.emailVerified;
    next();
    return;
  }

  // ── Shared API key path (admin dashboard, guest mobile browsing) ─────────
  const expected = Buffer.from(secretKey, "utf8");
  const provided = Buffer.from(token, "utf8");

  if (
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  ) {
    logger.warn({ ip: req.ip, path: req.path }, "Rejected request with invalid API key");
    res.status(403).json({ error: "Invalid credentials" });
    return;
  }

  next();
}

/**
 * Blocks requests authenticated with a student JWT from reaching routes that
 * are intended for admin/server-to-server use only.
 *
 * The admin dashboard authenticates via the shared API key (Bearer <key>) for
 * resource routes — this middleware leaves those through. Only student JWTs
 * (identified by req.studentJwtVerified) are rejected.
 *
 * Apply to every POST/PATCH/DELETE route that should never be called by a
 * mobile-app student, e.g. creating/editing instructors, deleting bookings.
 */
export function blockStudentJwt(req: Request, res: Response, next: NextFunction): void {
  if (req.studentJwtVerified) {
    res.status(403).json({ error: "Students are not permitted to call this endpoint" });
    return;
  }
  next();
}
