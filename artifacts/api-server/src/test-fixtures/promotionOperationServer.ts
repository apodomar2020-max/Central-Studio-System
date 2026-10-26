/** Disposable integration test process, never imported by the application. */
import express from "express";
import { pool } from "@workspace/db";
import adminAuth from "../routes/adminAuth";
import promotions from "../routes/promotions";
import { requireAuth } from "../middlewares/auth";
const url = new URL(process.env.DATABASE_URL!);
if (
  process.env.NODE_ENV !== "test" ||
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  !/disposable/.test(url.pathname)
)
  throw Error("Disposable local test process only");
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  // Simulates a committed write whose HTTP response never reaches its client.
  if (req.get("x-test-drop-response") === "true")
    res.end = (() => {
      res.socket?.destroy();
      return res;
    }) as typeof res.end;
  next();
});
app.use("/api", requireAuth);
app.use("/api", adminAuth);
app.use("/api", promotions);
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const e = err as { expose?: boolean; status?: number; message?: string };
    res
      .status(e.expose ? e.status! : 500)
      .json({ error: e.expose ? e.message : "Internal server error" });
  },
);
const server = app.listen(0, "127.0.0.1", () => {
  const a = server.address();
  if (a && typeof a !== "string") process.send?.({ port: a.port });
});
process.on("SIGTERM", () => {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
});
