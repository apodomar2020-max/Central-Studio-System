// Test setup only. Costly registration now requires real Redis on both routes;
// existing non-admission suites must supply it rather than weaken the gate.
import { before, beforeEach, after } from "node:test";
import IORedis from "ioredis";
import { Queue } from "bullmq";

export function useAuthAdmissionFixture(): void {
  if (process.env.NODE_ENV === "production") throw new Error("Test fixture cannot run in production");
  const url = "redis://127.0.0.1:16386/15";
  process.env.REDIS_URL = url;
  const redis = new IORedis(url, { lazyConnect: true, connectTimeout: 2000, maxRetriesPerRequest: 1, commandTimeout: 5000, retryStrategy: () => null });
  before(async () => { await redis.connect(); await redis.flushdb(); });
  beforeEach(async () => { await redis.flushdb(); });
  after(async () => {
    await (await import("./authRecovery")).closeRecoveryQueue();
    (await import("./authAbuseProtection")).__resetClientForTests();
    await redis.quit();
  });
}

export async function processQueuedRecoveryForTests(): Promise<void> {
  const recovery = await import("./authRecovery");
  const redis = new IORedis("redis://127.0.0.1:16386/15", { maxRetriesPerRequest: 1, connectTimeout: 2000 });
  const queue = new Queue(recovery.AUTH_RECOVERY_QUEUE, { connection: redis });
  try {
    for (const job of await queue.getJobs(["wait"])) await recovery.processRecovery(job as any);
  } finally { await queue.close(); await redis.quit(); }
}
