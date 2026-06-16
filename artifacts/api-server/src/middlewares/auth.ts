/**
 * API authentication middleware.
 *
 * All routes under /api are protected except /api/healthz.
 *
 * Accepted credential formats:
 *   - Header:  X-Api-Key: <key>               (admin dashboard / server-to-server)
 *   - Header:  Authorization: Bearer <apiKey>  (mobile guest mode)
 *   - Header:  Authorization: Bearer <jwt>     (mobile logged-in — student JWT)
 *
 * Student JWT fast-path:
 *   If the Bearer token contains two dots (looks like a JWT), it is verified
 *   against STUDENT_JWT_SECRET. A valid token with type="student" sets:
 *     req.studentId          — numeric student ID from the JWT sub claim
 *     req.studentEmail       — email from the JWT
 *     req.studentJwtVerified — true (flag used by requireStudentAuth)
 *   An invalid JWT returns 401 immediately (no API key fallback).
 *
 * In development, if API_SECRET_KEY is not set the middleware logs a warning
 * and allows all requests through — so local dev still works without setup.
 * In production (NODE_ENV=production) a missing key causes startup to abort.
 */
import { timingSafeEqual } from "crypto";
import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { logger } from "../lib/logger";

// ─── Global Express type extensions ──────────────────────────────────────────
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      studentId?: number;
      studentEmail?: string;
      studentJwtVerified?: boolean;
    }
  }
}

// Middleware is mounted at /api so Express strips that prefix —
// req.path inside here is "/healthz", not "/api/healthz".
const PUBLIC_PATHS = new Set(["/healthz"]);

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
}

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

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
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
    try {
      const payload = jwt.verify(token, STUDENT_JWT_SECRET) as unknown as StudentTokenPayload;
      if (payload.type !== "student") {
        logger.warn({ path: req.path }, "JWT token type is not 'student'");
        res.status(401).json({ error: "Invalid token type" });
        return;
      }
      // Attach student identity — consumed by requireStudentAuth downstream.
      req.studentId = payload.sub;
      req.studentEmail = payload.email;
      req.studentJwtVerified = true;
      next();
      return;
    } catch (err) {
      logger.warn({ path: req.path, err }, "Invalid or expired student JWT");
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }
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
