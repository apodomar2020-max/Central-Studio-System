/**
 * Security Wave — Auth Abuse Foundation: Redis-backed distributed
 * rate/lockout limiting for pre-auth and auth-adjacent endpoints.
 *
 * SCOPE (this module only):
 *   - IP-scoped counters, distributed across every Railway API instance via
 *     the existing Redis infrastructure (REDIS_URL, same instance BullMQ
 *     already uses — a dedicated connection, not the BullMQ one; see
 *     "why a separate connection" below).
 *   - Account-scoped counters, keyed by a domain-separated HMAC fingerprint
 *     of the normalized email/username — never the raw value.
 *   - A bounded, safe degraded mode if Redis is unreachable: this NEVER
 *     silently becomes "unlimited" — it falls back to a small in-process
 *     (per-instance) sliding counter, which is weaker under horizontal
 *     scale-out but still a real, bounded limit, not an open door.
 *
 * WHAT THIS MODULE NEVER DOES
 *   - never stores a raw email/password/OTP/JWT/social token as a Redis key
 *     or in a log line;
 *   - never creates a permanent Redis record — every key carries a bounded
 *     TTL equal to its own rate-limit window;
 *   - never replaces the existing DB-backed OTP cooldown/attempt-count/
 *     single-use/expiration logic in authHelpers.ts — this is an
 *     additional, independent layer on top of it, not a replacement.
 *
 * WHY A SEPARATE REDIS CONNECTION FROM QUEUE.TS
 *   BullMQ's shared connection is configured with `maxRetriesPerRequest:
 *   null` (required for its own blocking commands) — a command issued on
 *   that connection during a Redis outage can hang indefinitely, which is
 *   exactly wrong for a rate limiter sitting in the hot path of every auth
 *   request. This module's connection uses a small bounded retry count and
 *   a short per-command timeout instead, so a Redis outage degrades this
 *   module in milliseconds, never blocks a request.
 */
import { createHmac, timingSafeEqual } from "crypto";
import IORedis from "ioredis";
import { logger } from "./logger";

const KEY_VERSION = "v1";

// ─── Account fingerprint pepper — domain-separated from OTP_PEPPER ────────
//
// Deliberately its own secret, not a reuse of OTP_PEPPER: OTP_PEPPER's
// blast radius is the at-rest OTP digest (email_otps.code); this pepper's
// blast radius is Redis rate-limit key material. Keeping them independent
// means rotating one never requires reasoning about the other's exposure.
// Same fail-closed-in-production / warn-in-dev pattern as OTP_PEPPER /
// STUDENT_JWT_SECRET.
export const AUTH_ABUSE_PEPPER = process.env["AUTH_ABUSE_PEPPER"] ?? "dev-auth-abuse-pepper-change-in-production";

if (!process.env["AUTH_ABUSE_PEPPER"]) {
  if (process.env["NODE_ENV"] === "production") {
    throw new Error(
      "AUTH_ABUSE_PEPPER must be set in production. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  logger.warn(
    "AUTH_ABUSE_PEPPER is not set — using insecure dev default. " +
      "Set this env var before deploying to production.",
  );
}

/**
 * Domain-separated, keyed HMAC fingerprint of a normalized account
 * identifier (email or admin username). Truncated to 16 bytes (32 hex
 * chars) — this is a Redis key component, not a security digest that needs
 * full 256-bit collision resistance; 128 bits is vastly more than enough
 * headroom for this purpose while keeping keys short.
 */
export function accountFingerprint(normalizedIdentifier: string): string {
  return createHmac("sha256", AUTH_ABUSE_PEPPER)
    .update(`${KEY_VERSION}\nauth-abuse\n${normalizedIdentifier}`)
    .digest("hex")
    .slice(0, 32);
}

// ─── Dedicated Redis connection ────────────────────────────────────────────

let client: IORedis | null | undefined; // undefined = not yet attempted

function getClient(): IORedis | null {
  if (client !== undefined) return client;
  const url = process.env["REDIS_URL"]?.trim();
  if (!url) {
    client = null;
    return client;
  }
  client = new IORedis(url, {
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    commandTimeout: 750,
    retryStrategy: (attempt) => (attempt > 3 ? null : Math.min(attempt * 200, 1000)),
    lazyConnect: false,
  });
  client.on("error", (err) => {
    logger.warn({ err: err.message }, "Auth-abuse-protection Redis connection error");
  });
  return client;
}

/** Test-only: force a fresh connection attempt on next getClient() call. */
export function __resetClientForTests(): void {
  if (client) {
    client.disconnect();
  }
  client = undefined;
}

// ─── Bounded in-process fallback (never fully open) ────────────────────────
//
// Used ONLY when Redis is unreachable. Per-instance, not distributed — a
// deliberately weaker but still-bounded degraded mode. Cleaned up lazily
// (entries just expire out of relevance; the Map is small by construction
// since only actively-abusive keys accumulate entries).
type FallbackEntry = { count: number; resetAtMs: number };
const fallbackStore = new Map<string, FallbackEntry>();

function fallbackConsume(key: string, limit: number, windowSeconds: number): { count: number; ttlSeconds: number } {
  const now = Date.now();
  const existing = fallbackStore.get(key);
  if (!existing || existing.resetAtMs <= now) {
    const resetAtMs = now + windowSeconds * 1000;
    fallbackStore.set(key, { count: 1, resetAtMs });
    return { count: 1, ttlSeconds: windowSeconds };
  }
  existing.count += 1;
  return { count: existing.count, ttlSeconds: Math.max(1, Math.ceil((existing.resetAtMs - now) / 1000)) };
}

function fallbackReset(key: string): void {
  fallbackStore.delete(key);
}

// Bound the fallback map itself so a Redis outage cannot become an
// unbounded memory-growth vector under a sustained distributed-IP attack.
const FALLBACK_MAX_ENTRIES = 50_000;
function fallbackPruneIfNeeded(): void {
  if (fallbackStore.size <= FALLBACK_MAX_ENTRIES) return;
  const now = Date.now();
  for (const [k, v] of fallbackStore) {
    if (v.resetAtMs <= now) fallbackStore.delete(k);
  }
  // Still oversized after pruning expired entries (sustained attack, not
  // just staleness) — drop oldest-inserted entries (Map preserves
  // insertion order) rather than let memory grow unbounded.
  if (fallbackStore.size > FALLBACK_MAX_ENTRIES) {
    const excess = fallbackStore.size - FALLBACK_MAX_ENTRIES;
    let i = 0;
    for (const k of fallbackStore.keys()) {
      if (i >= excess) break;
      fallbackStore.delete(k);
      i += 1;
    }
  }
}

// Atomic INCR-then-set-TTL-if-new. Lua so the two operations never race
// across concurrent requests hitting the same key on different instances.
const CONSUME_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("TTL", KEYS[1])
return {count, ttl}
`;

export type ConsumeResult = { count: number; ttlSeconds: number; degraded: boolean };

/**
 * Increments the counter for `key` and returns the new count plus the
 * key's remaining TTL. Creates the key with `windowSeconds` TTL on first
 * increment. Falls back to the bounded in-process counter (degraded: true)
 * if Redis is unavailable — never throws, never silently allows unlimited
 * requests.
 */
export async function consume(key: string, windowSeconds: number): Promise<ConsumeResult> {
  const redis = getClient();
  if (!redis) {
    fallbackPruneIfNeeded();
    const { count, ttlSeconds } = fallbackConsume(key, Infinity, windowSeconds);
    return { count, ttlSeconds, degraded: true };
  }
  try {
    const result = (await redis.eval(CONSUME_SCRIPT, 1, key, String(windowSeconds))) as [number, number];
    const [count, ttl] = result;
    return { count, ttlSeconds: ttl > 0 ? ttl : windowSeconds, degraded: false };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "Auth-abuse-protection Redis consume failed — using degraded fallback");
    fallbackPruneIfNeeded();
    const { count, ttlSeconds } = fallbackConsume(key, Infinity, windowSeconds);
    return { count, ttlSeconds, degraded: true };
  }
}

/** Clears a counter early — used to age out failure state on a successful auth. */
export async function resetCounter(key: string): Promise<void> {
  const redis = getClient();
  fallbackReset(key);
  if (!redis) return;
  try {
    await redis.del(key);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "Auth-abuse-protection Redis reset failed (non-fatal)");
  }
}

// ─── Key builders — deterministic, namespaced, no raw PII ─────────────────

export function ipLimitKey(scope: string, ip: string): string {
  return `authlimit:${KEY_VERSION}:ip:${scope}:${ip}`;
}

export function accountLimitKey(scope: string, normalizedIdentifier: string): string {
  return `authlimit:${KEY_VERSION}:acct:${scope}:${accountFingerprint(normalizedIdentifier)}`;
}

/** Numeric ids (e.g. an already-authenticated studentId) are not raw PII — safe to key on directly. */
export function idLimitKey(scope: string, id: number | string): string {
  return `authlimit:${KEY_VERSION}:id:${scope}:${id}`;
}

/** Constant-time-safe equality for the rare case two fingerprints must be compared directly (defensive; not currently required by any caller, kept for parity with the OTP digest module's pattern). */
export function fingerprintsEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  try {
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

export async function isRedisHealthy(): Promise<boolean> {
  const redis = getClient();
  if (!redis) return false;
  try {
    await redis.ping();
    return true;
  } catch {
    return false;
  }
}
