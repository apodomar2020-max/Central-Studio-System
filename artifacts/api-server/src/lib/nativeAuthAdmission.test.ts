import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import IORedis from "ioredis";

const url = process.env.DISPOSABLE_NATIVE_AUTH_REDIS_URL ?? "redis://127.0.0.1:16386/11";
const parsed = new URL(url);
if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/11") throw new Error("Disposable local Redis DB 11 required");
process.env.REDIS_URL = url;
process.env.AUTH_ABUSE_PEPPER = "test-only-native-admission-pepper";
process.env.AUTH_EMAIL_TIMEOUT_MS = "40";
process.env.DATABASE_URL = "postgres://localhost:1/disposable_native_admission";
process.env.NODE_ENV = "test";
let redis: IORedis;
let lib: typeof import("./nativeAuthAdmission");
let abuse: typeof import("./authAbuseProtection");
before(async () => {
  redis = new IORedis(url);
  lib = await import("./nativeAuthAdmission");
  abuse = await import("./authAbuseProtection");
});
beforeEach(async () => { await redis.flushdb(); abuse.__resetClientForTests(); process.env.REDIS_URL = url; });
after(async () => { abuse.__resetClientForTests(); await redis.quit(); });

test("atomic admission across independent connections caps concurrent attempts without partial reservations", async () => {
  const independent = new IORedis(url);
  const limits = [{ dimension: "test:fleet", limit: 7, windowMs: 60_000 }, { dimension: "test:day", limit: 7, windowMs: 86_400_000 }];
  try {
    const results = await Promise.all(Array.from({ length: 50 }, (_, i) => i % 2
      ? lib.reserveAdmission(limits).then(() => true, () => false)
      : independent.eval(lib.ADMISSION_SCRIPT, 2, "authadmission:{auth}:v1:test:fleet", "authadmission:{auth}:v1:test:day", `other-instance-${i}`, "60000", "7", "86400000", "7").then((result: any) => result[0] === 1)));
    assert.equal(results.filter(Boolean).length, 7);
    assert.equal(await redis.zcard("authadmission:{auth}:v1:test:day"), 7);
    assert.ok((await redis.pttl("authadmission:{auth}:v1:test:day")) > 0);
  } finally { await independent.quit(); }
});

test("rolling window expires old admissions but the 24-hour cap remains", async () => {
  const short = "authadmission:{auth}:v1:test:short";
  const day = "authadmission:{auth}:v1:test:day";
  const limits = [{ dimension: "test:short", limit: 1, windowMs: 1000 }, { dimension: "test:day", limit: 2, windowMs: 86_400_000 }];
  await lib.reserveAdmission(limits);
  await assert.rejects(lib.reserveAdmission(limits), { kind: "limited" });
  await redis.zadd(short, Date.now() - 2000, (await redis.zrange(short, 0, 0))[0]!);
  await lib.reserveAdmission(limits);
  await redis.del(short);
  await assert.rejects(lib.reserveAdmission(limits), { kind: "limited" });
  assert.equal(await redis.zcard(day), 2);
  assert.equal(await redis.zcard(short), 0, "rejection must not partially charge another dimension");
});

test("normalized registration identifiers share a ceiling and admitted duplicates remain charged", async () => {
  for (let i = 0; i < 5; i++) await lib.reserveRegistration(i % 2 ? " Test@EXAMPLE.COM " : "test@example.com", {});
  await assert.rejects(lib.reserveRegistration("test@example.com", {}), { kind: "limited" });
  assert.equal(await redis.zcard("authadmission:{auth}:v1:register:global:day"), 5);
  assert.ok(!(await redis.keys("*")).some((key) => key.includes("example.com")));
});

test("spoofed forwarding headers never select admission identity; malformed peers are omitted", () => {
  const request = { socket: { remoteAddress: "::ffff:127.0.0.1" }, headers: { "x-forwarded-for": "8.8.8.8", "x-real-ip": "1.1.1.1" }, studentId: 12 };
  assert.deepEqual(lib.admissionContext(request as any), { peer: "127.0.0.1", studentId: 12 });
  assert.deepEqual(lib.admissionContext({ socket: { remoteAddress: "invalid" } } as any), { studentId: undefined });
});

test("missing and unreachable Redis fail closed without process-local fallback", async () => {
  delete process.env.REDIS_URL;
  abuse.__resetClientForTests();
  await assert.rejects(lib.reserveRegistration("test@example.com", {}), { kind: "unavailable" });
  process.env.REDIS_URL = "redis://127.0.0.1:1/11";
  abuse.__resetClientForTests();
  await assert.rejects(lib.reserveEmailAttempt("test@example.com", false), { kind: "unavailable" });
});

test("failed provider requests, 429, timeout, and security notices each consume shared budget without retries", async () => {
  process.env.BREVO_API_KEY = "test-only-brevo-key";
  process.env.EMAIL_FROM = "test@example.test";
  const { sendOtpEmail, sendSecurityNotificationEmail } = await import("./authHelpers");
  const original = globalThis.fetch;
  let calls = 0;
  try {
    for (const status of [500, 429]) {
      globalThis.fetch = (async () => { calls++; return new Response("", { status }); }) as typeof fetch;
      await assert.rejects(sendOtpEmail("test@example.test", "123456", "reset"));
    }
    globalThis.fetch = ((_input, init) => new Promise((_resolve, reject) => {
      calls++;
      init?.signal?.addEventListener("abort", () => reject(new Error("timeout")), { once: true });
    })) as typeof fetch;
    await assert.rejects(sendOtpEmail("test@example.test", "123456", "verify"));
    globalThis.fetch = (async () => { calls++; return new Response("", { status: 201 }); }) as typeof fetch;
    await sendSecurityNotificationEmail("test@example.test", "password_changed");
    assert.equal(calls, 4);
    assert.equal(await redis.zcard("authadmission:{auth}:v1:email:global:day"), 4);
    await redis.zadd("authadmission:{auth}:v1:email:global:day", ...Array.from({ length: 200 }, (_, i) => String(i)).flatMap((value) => [Date.now(), value]));
    await assert.rejects(sendOtpEmail("other@example.test", "123456", "reset"));
    assert.equal(calls, 4, "denied admission must not contact provider");
  } finally { globalThis.fetch = original; delete process.env.BREVO_API_KEY; }
});
