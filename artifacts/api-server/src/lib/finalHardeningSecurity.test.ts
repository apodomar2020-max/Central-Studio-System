import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

process.env["AUTH_ABUSE_PEPPER"] ??= "test-final-hardening-auth-abuse-pepper".padEnd(64, "0");
delete process.env["REDIS_URL"];

const srcRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(srcRoot, "../../..");

async function source(relativeToRepo: string): Promise<string> {
  return readFile(path.join(repoRoot, relativeToRepo), "utf8");
}

test("public expensive-endpoint limiter allows legitimate traffic and blocks excess traffic", async () => {
  const { __resetClientForTests } = await import("./authAbuseProtection");
  const { ipRateLimiter } = await import("../middlewares/authRateLimit");
  __resetClientForTests();
  const limiter = ipRateLimiter(`final-hardening-${Date.now()}`, { limit: 2, windowSeconds: 60 });

  async function invoke() {
    const headers = new Map<string, string>();
    let statusCode = 200;
    let body: unknown;
    let nextCalled = false;
    const req = { ip: "203.0.113.10" };
    const res = {
      setHeader(name: string, value: string) { headers.set(name, value); },
      status(code: number) { statusCode = code; return this; },
      json(value: unknown) { body = value; return this; },
    };
    await limiter(req as never, res as never, () => { nextCalled = true; });
    return { headers, statusCode, body, nextCalled };
  }

  assert.equal((await invoke()).nextCalled, true);
  assert.equal((await invoke()).nextCalled, true);
  const blocked = await invoke();
  assert.equal(blocked.nextCalled, false);
  assert.equal(blocked.statusCode, 429);
  assert.equal((blocked.body as { code?: string }).code, "RATE_LIMITED");
  assert.equal(blocked.headers.get("RateLimit-Limit"), "2");

  const instagramRoute = await source("artifacts/api-server/src/routes/instagram.ts");
  assert.match(instagramRoute, /router\.get\("\/instagram\/reels", instagramReelsLimiter/);
});

test("queue retries, backoff, retained failures, and concurrency are bounded", async () => {
  const { defaultJobOptions, queueConcurrency } = await import("./queue");
  const previous = { attempts: process.env["QUEUE_JOB_ATTEMPTS"], backoff: process.env["QUEUE_JOB_BACKOFF_MS"], concurrency: process.env["TEST_QUEUE_CONCURRENCY"] };
  try {
    process.env["QUEUE_JOB_ATTEMPTS"] = "999999";
    process.env["QUEUE_JOB_BACKOFF_MS"] = "1";
    process.env["TEST_QUEUE_CONCURRENCY"] = "999999";
    const options = defaultJobOptions();
    assert.equal(options.attempts, 10);
    assert.deepEqual(options.backoff, { type: "exponential", delay: 100 });
    assert.equal(options.removeOnComplete, 100);
    assert.equal(options.removeOnFail, 500);
    assert.equal(queueConcurrency("TEST_QUEUE_CONCURRENCY"), 20);
  } finally {
    for (const [key, value] of Object.entries({
      QUEUE_JOB_ATTEMPTS: previous.attempts,
      QUEUE_JOB_BACKOFF_MS: previous.backoff,
      TEST_QUEUE_CONCURRENCY: previous.concurrency,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("queue payload contracts contain IDs and control fields, not auth tokens, admin email, or IP", async () => {
  const queueSource = await source("artifacts/api-server/src/lib/queue.ts");
  const campaignJob = queueSource.slice(
    queueSource.indexOf("export type WhatsAppCampaignSendJob"),
    queueSource.indexOf("export type ReportJob"),
  );
  assert.match(campaignJob, /campaignId: number/);
  assert.doesNotMatch(campaignJob, /actorEmail|ipAddress|password|accessToken|refreshToken|jwt|authorization/i);

  const reportJob = queueSource.slice(
    queueSource.indexOf("export type ReportJob"),
    queueSource.indexOf("export type NotificationAutomationJob"),
  );
  assert.match(reportJob, /reportJobId: number/);
  assert.doesNotMatch(reportJob, /filters|entity|password|accessToken|refreshToken|jwt|authorization/i);

  const marketingRoute = await source("artifacts/api-server/src/routes/marketing.ts");
  const enqueueStart = marketingRoute.indexOf("const job = await enqueueJob<WhatsAppCampaignSendJob>");
  const enqueueEnd = marketingRoute.indexOf("if (!job)", enqueueStart);
  const enqueueBlock = marketingRoute.slice(enqueueStart, enqueueEnd);
  assert.doesNotMatch(enqueueBlock, /adminUser.*email|req\.ip|accessToken|authorization/i);
});

test("known sensitive diagnostic fields are removed and defensive logger redaction remains enabled", async () => {
  const authHelpers = await source("artifacts/api-server/src/lib/authHelpers.ts");
  assert.doesNotMatch(authHelpers, /logger\.(?:info|warn|error)\(\{\s*(?:to|email):/);
  const mobileAuth = await source("artifacts/central/services/authProfile.ts");
  const authDiagnostics = mobileAuth.match(/console\.log\("\[AUTH_NAV\][\s\S]*?\}\);/g)?.join("\n") ?? "";
  assert.doesNotMatch(authDiagnostics, /email: user\.email|authProvider: user\.authProvider/);
  const push = await source("artifacts/central/services/pushNotifications.ts");
  assert.doesNotMatch(push, /tokenPrefix|\.slice\(0, 12\)/);

  const { LOG_REDACTION_PATHS } = await import("./logger");
  for (const required of ["req.body", "req.headers['x-admin-token']", "authorization", "accessToken", "botToken", "otp", "challengeId", "*.token"]) {
    assert.ok(LOG_REDACTION_PATHS.includes(required as never));
  }
});

test("ordinary audit-log API is read-only and both audit tables have no update/delete route", async () => {
  const auditRoute = await source("artifacts/api-server/src/routes/adminActivityLogs.ts");
  assert.match(auditRoute, /router\.get\(/);
  assert.doesNotMatch(auditRoute, /router\.(?:post|put|patch|delete)\(/);

  const promotionRoutes = await source("artifacts/api-server/src/routes/promotions.ts");
  assert.doesNotMatch(promotionRoutes, /(?:update|delete)\(promotionAuditLogsTable\)/);
});

test("Instagram persistence is encrypted-only after online migration and token values are never returned", async () => {
  const route = await source("artifacts/api-server/src/routes/instagram.ts");
  assert.match(route, /accessToken: null/);
  assert.match(route, /accessTokenCiphertext: envelope\.ciphertext/);
  assert.doesNotMatch(route, /json\(\{[^}]*accessToken/);
  assert.doesNotMatch(route, /logger\.[a-z]+\([^\n]*(?:tokenInMemory|envToken|access_token)/);

  const migration = await source("lib/db/migrations/0124_instagram_token_encryption.sql");
  assert.match(migration, /ALTER COLUMN "access_token" DROP NOT NULL/);
  assert.match(migration, /access_token_ciphertext/);
  assert.match(migration, /access_token_auth_tag/);
  assert.match(migration, /encryption_key_version/);
});

test("served SVG has explicit nosniff, disposition, and script-denying CSP headers", async () => {
  const route = await source("artifacts/api-server/src/routes/danceTypes.ts");
  const serveBlock = route.slice(route.indexOf('router.get("/dance-types/:id/icon.svg"'));
  assert.match(serveBlock, /sanitizeSvg\(row\.iconSvg\)/);
  assert.match(serveBlock, /X-Content-Type-Options", "nosniff"/);
  assert.match(serveBlock, /Content-Disposition/);
  assert.match(serveBlock, /default-src 'none'/);
  assert.match(serveBlock, /script-src 'none'/);
  assert.doesNotMatch(serveBlock, /default-src \*|script-src \*/);
});
