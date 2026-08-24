/**
 * Security Wave — Auth Abuse Foundation: unit-level coverage for the core
 * Redis-backed limiter (lib/authAbuseProtection.ts). Real local Redis (not
 * mocked) — see REDIS_URL below, a disposable numeric DB on localhost only.
 *
 * HTTP-level coverage (enumeration, per-route wiring, multi-instance
 * sharing) lives in routes/authAbuseFoundation.integration.test.ts.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const REDIS_URL = process.env.DISPOSABLE_AUTH_ABUSE_REDIS_URL ?? "redis://127.0.0.1:6379/5";

function assertDisposableRedisUrl(url: string): void {
  const parsed = new URL(url);
  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    throw new Error(`Refusing: REDIS_URL host "${parsed.hostname}" is not localhost/127.0.0.1`);
  }
}
assertDisposableRedisUrl(REDIS_URL);
process.env.REDIS_URL = REDIS_URL;
process.env.AUTH_ABUSE_PEPPER = "test-auth-abuse-pepper".padEnd(64, "0");

let lib: typeof import("./authAbuseProtection");
let ioredisClient: import("ioredis").Redis;

before(async () => {
  lib = await import("./authAbuseProtection");
  const IORedis = (await import("ioredis")).default;
  ioredisClient = new IORedis(REDIS_URL);
  await ioredisClient.flushdb();
});

after(async () => {
  await ioredisClient.flushdb();
  await ioredisClient.quit();
  lib.__resetClientForTests();
});

// ═══════════════════════════════════════════════════════════════════════
// Key builders — deterministic, namespaced, no raw PII
// ═══════════════════════════════════════════════════════════════════════

test("15: normalized-email variants (case/whitespace) produce the same account key — once normalized by the caller", () => {
  // accountLimitKey/accountFingerprint operate on whatever identifier
  // string they are given — normalization is the CALLER's responsibility
  // (auth.ts's emailIdentifier() calls normalizeEmail() before ever
  // reaching this function), matching the OTP digest module's same
  // division of responsibility. This proves the property that actually
  // matters: once normalized, case/whitespace variants collapse to the
  // exact same bucket.
  const normalize = (e: string) => e.toLowerCase().trim();
  const a = lib.accountLimitKey("login", normalize(" Foo@Example.com "));
  const b = lib.accountLimitKey("login", normalize("foo@example.com"));
  assert.equal(a, b);
});

test("16: raw email is never present in the generated Redis key", () => {
  const key = lib.accountLimitKey("login", "someone@example.com");
  assert.ok(!key.includes("someone@example.com"));
  assert.ok(!key.includes("@"));
  assert.match(key, /^authlimit:v1:acct:login:[0-9a-f]{32}$/);
});

test("account fingerprint is deterministic and different scopes produce different keys for the same identifier", () => {
  const loginKey = lib.accountLimitKey("login", "someone@example.com");
  const registerKey = lib.accountLimitKey("register", "someone@example.com");
  assert.notEqual(loginKey, registerKey);
});

test("ip key never gets HMAC-fingerprinted (IP is not in the forbidden-PII list, and IP throttling needs the raw value to function)", () => {
  const key = lib.ipLimitKey("login", "203.0.113.7");
  assert.equal(key, "authlimit:v1:ip:login:203.0.113.7");
});

test("id key uses the numeric id directly (not raw PII, no HMAC needed)", () => {
  const key = lib.idLimitKey("otp-send", 42);
  assert.equal(key, "authlimit:v1:id:otp-send:42");
});

// ═══════════════════════════════════════════════════════════════════════
// consume() — atomic increment, TTL, reset, TTL expiry
// ═══════════════════════════════════════════════════════════════════════

test("consume increments across calls and reports degraded:false when Redis is healthy", async () => {
  const key = `test:consume:${Date.now()}`;
  const r1 = await lib.consume(key, 60);
  const r2 = await lib.consume(key, 60);
  const r3 = await lib.consume(key, 60);
  assert.equal(r1.count, 1);
  assert.equal(r2.count, 2);
  assert.equal(r3.count, 3);
  assert.equal(r1.degraded, false);
  assert.ok(r1.ttlSeconds > 0 && r1.ttlSeconds <= 60);
});

test("resetCounter clears the count back to zero", async () => {
  const key = `test:reset:${Date.now()}`;
  await lib.consume(key, 60);
  await lib.consume(key, 60);
  await lib.resetCounter(key);
  const after1 = await lib.consume(key, 60);
  assert.equal(after1.count, 1, "count must restart from 1 after reset");
});

test("14: TTL expiry restores access — a key set with a 1-second window resets after it elapses", async () => {
  const key = `test:ttl:${Date.now()}`;
  const r1 = await lib.consume(key, 1);
  assert.equal(r1.count, 1);
  await new Promise((resolve) => setTimeout(resolve, 1300));
  const r2 = await lib.consume(key, 1);
  assert.equal(r2.count, 1, "counter must have expired and restarted, not kept incrementing");
});

test("concurrent consume calls on the same key are atomic — no lost increments", async () => {
  const key = `test:concurrent:${Date.now()}`;
  const results = await Promise.all(Array.from({ length: 20 }, () => lib.consume(key, 60)));
  const counts = results.map((r) => r.count).sort((a, b) => a - b);
  assert.deepEqual(counts, Array.from({ length: 20 }, (_, i) => i + 1), "every increment must be distinct — no race lost an update");
});

// ═══════════════════════════════════════════════════════════════════════
// 13. Redis unavailable fails safely (bounded degraded fallback, not open)
// ═══════════════════════════════════════════════════════════════════════

test("13: Redis unavailable — consume degrades to a bounded in-process counter, never throws, never unlimited", async () => {
  const originalUrl = process.env.REDIS_URL;
  process.env.REDIS_URL = "redis://127.0.0.1:1/0"; // unreachable: nothing listens on port 1
  lib.__resetClientForTests();
  try {
    const key = `test:degraded:${Date.now()}`;
    const r1 = await lib.consume(key, 60);
    const r2 = await lib.consume(key, 60);
    const r3 = await lib.consume(key, 60);
    assert.equal(r1.degraded, true);
    assert.equal(r2.degraded, true);
    assert.equal(r3.degraded, true);
    // Bounded — still counts up, not "always allowed".
    assert.equal(r1.count, 1);
    assert.equal(r2.count, 2);
    assert.equal(r3.count, 3);
  } finally {
    process.env.REDIS_URL = originalUrl;
    lib.__resetClientForTests();
  }
});

test("isRedisHealthy reflects actual connectivity — true against local Redis, false against an unreachable one", async () => {
  assert.equal(await lib.isRedisHealthy(), true, "sanity: local Redis must be reachable for this suite");

  const originalUrl = process.env.REDIS_URL;
  process.env.REDIS_URL = "redis://127.0.0.1:1/0";
  lib.__resetClientForTests();
  try {
    assert.equal(await lib.isRedisHealthy(), false);
  } finally {
    process.env.REDIS_URL = originalUrl;
    lib.__resetClientForTests();
  }
});

test("reconnect behavior: after Redis becomes reachable again, consume resumes non-degraded operation", async () => {
  const originalUrl = process.env.REDIS_URL;
  process.env.REDIS_URL = "redis://127.0.0.1:1/0";
  lib.__resetClientForTests();
  const degradedResult = await lib.consume(`test:reconnect:${Date.now()}`, 60);
  assert.equal(degradedResult.degraded, true);

  process.env.REDIS_URL = originalUrl;
  lib.__resetClientForTests();
  const recoveredResult = await lib.consume(`test:reconnect:${Date.now()}`, 60);
  assert.equal(recoveredResult.degraded, false, "must resume real Redis-backed counting once reachable again");
});

// ═══════════════════════════════════════════════════════════════════════
// 23. No secret/PII in anything this module produces
// ═══════════════════════════════════════════════════════════════════════

test("23: AUTH_ABUSE_PEPPER value never appears in any key this module generates", () => {
  const pepper = process.env.AUTH_ABUSE_PEPPER!;
  const keys = [
    lib.accountLimitKey("login", "someone@example.com"),
    lib.accountLimitKey("register", "another@example.com"),
    lib.ipLimitKey("login", "203.0.113.7"),
    lib.idLimitKey("otp-verify", 99),
  ];
  for (const k of keys) assert.ok(!k.includes(pepper));
});

test("no permanent Redis records — every key set by consume() carries a bounded TTL", async () => {
  const key = `test:ttl-bound:${Date.now()}`;
  await lib.consume(key, 5);
  const ttl = await ioredisClient.ttl(key);
  assert.ok(ttl > 0 && ttl <= 5, `expected a bounded positive TTL, got ${ttl}`);
});
