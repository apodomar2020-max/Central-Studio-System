/**
 * API authentication middleware.
 *
 * All routes under /api are subject to this middleware except the public
 * diagnostic endpoints (/healthz, /version). It does NOT by itself decide
 * whether a route requires identity — that is left entirely to each route's
 * own downstream gate (requireStudentAuth, requireAdminAuth, a route-local
 * "requireXReadAccess", etc). This middleware's only job is:
 *
 *   1. If the request carries a token that looks like a JWT, verify it as a
 *      student access token and attach identity on success, or fail closed
 *      with 401 on any verification failure (bad signature, expired, wrong
 *      `type`, or revoked via tokenVersion — see Security-02B below).
 *   2. Otherwise (no token, or a token that is present but not JWT-shaped),
 *      treat the request as anonymous and call next() with no identity
 *      attached. This includes the retired shared API key: `API_SECRET_KEY` /
 *      `X-Api-Key` has ZERO authorization significance and is never compared
 *      against anything here (Security-04B/04C retired it; see below).
 *
 * Accepted headers (unchanged from before, `extractToken`'s precedence order
 * is preserved for backward compatibility with old clients that still send
 * these — they simply stop being meaningful for authorization):
 *   - Header:  X-Api-Key: <anything>            (now inert — never checked)
 *   - Header:  Authorization: Bearer <anything>  (checked ONLY if JWT-shaped)
 *   - Header:  Authorization: Bearer <jwt>       (mobile logged-in — student JWT)
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
 *   An invalid, expired, wrong-type, or revoked JWT-shaped token returns 401
 *   IMMEDIATELY — it must never be treated as "no credential" / anonymous.
 *   Falling through to anonymous on a failed JWT would let an attacker
 *   holding an expired/forged/revoked token silently retry as if they had
 *   sent nothing, which is a strictly worse signal than a clean 401 and is
 *   a named Security-04B release blocker.
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
 * ─── API_SECRET_KEY: retired from authorization (Security-04B/04C) ──────────
 *
 * Route-level trust was audited (357 route registrations, 60 route modules):
 * every route that actually needs identity has its own independent gate
 * (requireStudentAuth/requireVerifiedStudent using STUDENT_JWT_SECRET,
 * requireAdminAuth + RBAC using ADMIN_JWT_SECRET, or a route-local read-access
 * gate such as requireBookingReadAccess). The only routes that ever relied on
 * the shared key ALONE were public catalog/CMS GETs, the auth entry points
 * (register/login/forgot-password/reset-password/social login/admin login —
 * which must be reachable by definition), the device-unregister route (which
 * has its own separate unregisterSecret hash comparison), health/version, and
 * one hardcoded 405 stub. None of those need API_SECRET_KEY to be safe, so
 * the key carries no authorization weight anywhere in this middleware, and no
 * client (Security-04C removed the last client-side sender) sends it anymore.
 * This is not conditioned on whether API_SECRET_KEY happens to be set in the
 * environment — behavior is identical either way.
 */
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
  // Skip auth for public paths
  if (PUBLIC_PATHS.has(req.path)) {
    next();
    return;
  }

  const token = extractToken(req);

  // No credential at all, OR a credential that is present but not JWT-shaped
  // (the legacy shared API key, sent via X-Api-Key or Bearer) — both are
  // anonymous as of Security-04B. There is nothing left to compare a
  // non-JWT token against: API_SECRET_KEY has no authorization role here.
  // Anonymous requests are NOT rejected at this global gate — each route's
  // own downstream requirement (requireStudentAuth, requireAdminAuth, a
  // route-local read-access gate, or none at all for public routes) decides
  // whether that's sufficient.
  if (!token || !looksLikeJwt(token)) {
    next();
    return;
  }

  // ── Student JWT fast-path ────────────────────────────────────────────────
  // A JWT-shaped token is always verified as a student access token, and an
  // invalid one is REJECTED OUTRIGHT (401) — it must never be treated as
  // "no credential" / anonymous. That distinction matters: silently
  // downgrading a bad/expired/revoked JWT to anonymous would let a request
  // that should fail closed instead pass through to whatever a route allows
  // unauthenticated (which may be nothing, or may be more than the sender
  // should get), and would mask the fact that a real credential was rejected.
  {
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
}

/**
 * Blocks requests authenticated with a student JWT from reaching routes that
 * are intended for admin/server-to-server use only.
 *
 * The admin dashboard authenticates via its own X-Admin-Token (see
 * requireAdminAuth in routes/adminAuth.ts) — this middleware leaves those
 * requests through untouched. Only student JWTs (identified by
 * req.studentJwtVerified) are rejected.
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
