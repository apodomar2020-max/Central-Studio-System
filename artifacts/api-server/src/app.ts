import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import compression from "compression";
import helmet from "helmet";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { requireAuth } from "./middlewares/auth";
import { captureError } from "./lib/errorMonitoring";
import { ExposableHttpError } from "./lib/httpError";
import { ipRateLimiter } from "./middlewares/authRateLimit";

const app: Express = express();

function positiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

app.set("trust proxy", positiveIntegerEnv("TRUST_PROXY_HOPS", 1));

// Broad, IP-scoped outer layer over the whole /api/auth and
// /api/admin/auth prefixes — distributed via Redis (lib/authAbuseProtection.ts),
// with a bounded per-instance fallback if Redis is unavailable (never
// silently unlimited). Narrower, endpoint-specific IP + account-scoped
// limiters are layered on top of this inside auth.ts / emailOtp.ts /
// socialAuth.ts / adminAuth.ts for the genuinely sensitive routes.
const authRateLimitWindowSeconds = Math.round(positiveIntegerEnv("AUTH_RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000) / 1000);
const authRateLimitMax = positiveIntegerEnv("AUTH_RATE_LIMIT_MAX", 50);
const authRateLimiter = ipRateLimiter("auth-broad", {
  limit: authRateLimitMax,
  windowSeconds: authRateLimitWindowSeconds,
  message: "Too many authentication attempts. Please try again later.",
});

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(helmet());
app.use(compression());
// CORS — restrict to known origins in production.
// Set ALLOWED_ORIGINS as a comma-separated list of allowed origins, e.g.:
//   ALLOWED_ORIGINS=https://admin.centralstudio.app,https://centralstudio.app
// In development (NODE_ENV != production) all origins are allowed.
const allowedOrigins: string[] = process.env["ALLOWED_ORIGINS"]
  ? process.env["ALLOWED_ORIGINS"].split(",").map((o) => o.trim()).filter(Boolean)
  : [];

app.use(
  cors({
    origin(origin, callback) {
      // Allow same-origin / non-browser requests (no Origin header)
      if (!origin) return callback(null, true);
      // Development: allow everything
      if (process.env["NODE_ENV"] !== "production") return callback(null, true);
      // Production: check allowlist
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin '${origin}' is not allowed`));
    },
    credentials: true,
    // Pagination metadata headers (GET /attendance, GET /package-orders) —
    // without this the browser cannot read them cross-origin.
    exposedHeaders: ["X-Total-Count", "X-Page", "X-Page-Size", "X-Total-Pages"],
  }),
);
app.use("/api/auth", authRateLimiter);
app.use("/api/admin/auth", authRateLimiter);
app.use(express.json({ limit: process.env["API_JSON_BODY_LIMIT"] ?? "1mb" }));
app.use(express.urlencoded({ extended: true, limit: process.env["API_URLENCODED_BODY_LIMIT"] ?? "1mb" }));

// Authenticate all /api routes (healthz is explicitly exempted inside the middleware)
app.use("/api", requireAuth);
app.use("/api", router);

// 404 handler — must come after all routes
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

// Global error handler — must be last and must have 4 parameters so Express
// recognises it as an error-handling middleware (even if `next` is unused).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  captureError(err, { method: _req.method, path: _req.path });
  logger.error(err, "Unhandled error");
  const rawStatus = typeof err === "object" && err !== null && "status" in err
    ? Number((err as { status: unknown }).status)
    : 500;
  const status = rawStatus >= 400 && rawStatus < 600 ? rawStatus : 500;
  const rawMessage =
    typeof err === "object" && err !== null && "message" in err
      ? String((err as { message: unknown }).message)
      : null;
  // Only client-safe messages leave the server: 4xx errors carry deliberate
  // messages (body-parser, business rules, ExposableHttpError), but 5xx
  // messages can contain SQL/driver internals (e.g. DrizzleQueryError's
  // "Failed query: …") and are replaced with a fixed response (Security G-01).
  const exposable = err instanceof ExposableHttpError || status < 500;
  const message = exposable
    ? rawMessage ?? "Request failed"
    : "Internal server error";
  res.status(status).json({ error: message });
});

export default app;
