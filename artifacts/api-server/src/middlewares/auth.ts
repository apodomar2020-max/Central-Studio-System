/**
 * API authentication middleware.
 *
 * All routes under /api are protected except /api/healthz.
 *
 * Two accepted formats (both check against the same API_SECRET_KEY env var):
 *   - Header:  X-Api-Key: <key>          (admin dashboard / server-to-server)
 *   - Header:  Authorization: Bearer <key>  (mobile app)
 *
 * Set up:
 *   1. Generate a strong random key, e.g.:
 *        node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *   2. Set API_SECRET_KEY=<that value> in your environment / .env file.
 *   3. Pass the same key from the mobile app via setAuthTokenGetter() and
 *      from the admin dashboard via the X-Api-Key request header.
 *
 * In development, if API_SECRET_KEY is not set the middleware logs a warning
 * and allows all requests through — so local dev still works without setup.
 * In production (NODE_ENV=production) a missing key causes startup to abort.
 */
import { timingSafeEqual } from "crypto";
import type { NextFunction, Request, Response } from "express";
import { logger } from "../lib/logger";

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

function extractToken(req: Request): string | null {
  // X-Api-Key header (admin dashboard / server-to-server)
  const apiKey = req.headers["x-api-key"];
  if (typeof apiKey === "string" && apiKey.length > 0) return apiKey;

  // Authorization: Bearer <token> (mobile app)
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

  // Constant-time comparison to prevent timing attacks
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
