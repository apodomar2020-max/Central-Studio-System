import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { requireAuth } from "./middlewares/auth";

const app: Express = express();

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
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
  logger.error(err, "Unhandled error");
  const status = typeof err === "object" && err !== null && "status" in err
    ? Number((err as { status: unknown }).status)
    : 500;
  const message =
    typeof err === "object" && err !== null && "message" in err
      ? String((err as { message: unknown }).message)
      : "Internal server error";
  res.status(status >= 400 && status < 600 ? status : 500).json({ error: message });
});

export default app;
