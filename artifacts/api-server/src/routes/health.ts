import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { isRedisHealthy } from "../lib/authAbuseProtection";

const router: IRouter = Router();

router.get("/healthz", async (_req, res) => {
  // Redis powers distributed auth rate limiting only — it is never a
  // requirement for overall API health (a Redis outage degrades limiting
  // to the bounded in-process fallback, it does not take the API down), so
  // its status is informational-only here and never flips the top-level
  // "status"/HTTP code. No credentials or connection details are ever
  // exposed — just a boolean-shaped operational flag.
  const redisOk = await isRedisHealthy();
  try {
    await db.execute(sql`select 1`);
    res.json({ status: "ok", database: "ok", rateLimiterRedis: redisOk ? "ok" : "degraded" });
  } catch {
    res.status(503).json({ status: "error", database: "error", rateLimiterRedis: redisOk ? "ok" : "degraded" });
  }
});

export default router;
