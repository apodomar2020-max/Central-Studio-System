/**
 * Security Wave — Auth Abuse Foundation: Express middleware built on
 * lib/authAbuseProtection.ts. Two independent layers, both enforced:
 *
 *   ipRateLimiter(scope, opts)      — IP-scoped, applied broadly.
 *   accountRateLimiter(scope, opts) — account-scoped (email/username/
 *                                     already-authenticated numeric id),
 *                                     applied to specific sensitive routes.
 *
 * A request is rejected (429) if EITHER layer's limit is exceeded — one
 * attacker rotating IPs still hits the account-scoped limit; one attacker
 * hammering many accounts from one IP still hits the IP-scoped limit.
 *
 * Client IP extraction reuses Express's own `req.ip`, which already
 * respects this app's configured `trust proxy` hop count (app.ts,
 * TRUST_PROXY_HOPS) — no ad-hoc X-Forwarded-For parsing here, so this
 * never trusts a header beyond what the configured proxy model allows.
 */
import type { NextFunction, Request, Response } from "express";
import { accountLimitKey, consume, idLimitKey, ipLimitKey, resetCounter } from "../lib/authAbuseProtection";

export interface RateLimitOptions {
  limit: number;
  windowSeconds: number;
  /** Response body when blocked. Kept generic by callers — never confirms account existence. */
  message?: string;
}

function setRateLimitHeaders(res: Response, limit: number, remaining: number, retryAfterSeconds: number): void {
  res.setHeader("RateLimit-Limit", String(limit));
  res.setHeader("RateLimit-Remaining", String(Math.max(0, remaining)));
  res.setHeader("Retry-After", String(retryAfterSeconds));
}

function tooManyRequests(res: Response, retryAfterSeconds: number, message: string): void {
  res.status(429).json({
    error: message,
    code: "RATE_LIMITED",
    retryAfterSeconds,
  });
}

/**
 * IP-scoped limiter. `scope` namespaces the counter (e.g. "login",
 * "register", "admin-login") so different endpoints don't share a budget.
 */
export function ipRateLimiter(scope: string, opts: RateLimitOptions) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const ip = req.ip ?? "unknown";
    const key = ipLimitKey(scope, ip);
    const { count, ttlSeconds } = await consume(key, opts.windowSeconds);
    setRateLimitHeaders(res, opts.limit, opts.limit - count, ttlSeconds);
    if (count > opts.limit) {
      tooManyRequests(res, ttlSeconds, opts.message ?? "Too many requests. Please try again later.");
      return;
    }
    next();
  };
}

/**
 * Account-scoped limiter keyed off a normalized identifier extracted from
 * the (already body-parsed) request by `identifierFor`. If `identifierFor`
 * returns null (identifier missing/malformed — request body validation
 * will reject it downstream anyway), this layer is skipped; the IP layer
 * still applies.
 */
export function accountRateLimiter(
  scope: string,
  opts: RateLimitOptions & { identifierFor: (req: Request) => string | null },
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const identifier = opts.identifierFor(req);
    if (!identifier) {
      next();
      return;
    }
    const key = accountLimitKey(scope, identifier);
    const { count, ttlSeconds } = await consume(key, opts.windowSeconds);
    if (count > opts.limit) {
      setRateLimitHeaders(res, opts.limit, 0, ttlSeconds);
      tooManyRequests(res, ttlSeconds, opts.message ?? "Too many attempts. Please try again later.");
      return;
    }
    next();
  };
}

/** Same as accountRateLimiter, but keyed on an already-authenticated numeric id (no HMAC needed — not raw PII). */
export function idRateLimiter(
  scope: string,
  opts: RateLimitOptions & { idFor: (req: Request) => number | string | null },
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const id = opts.idFor(req);
    if (id === null) {
      next();
      return;
    }
    const key = idLimitKey(scope, id);
    const { count, ttlSeconds } = await consume(key, opts.windowSeconds);
    if (count > opts.limit) {
      setRateLimitHeaders(res, opts.limit, 0, ttlSeconds);
      tooManyRequests(res, ttlSeconds, opts.message ?? "Too many attempts. Please try again later.");
      return;
    }
    next();
  };
}

/** Ages out failure state on a successful auth — call after a successful login/reset/verify. */
export async function resetAccountLimiter(scope: string, normalizedIdentifier: string): Promise<void> {
  await resetCounter(accountLimitKey(scope, normalizedIdentifier));
}
export async function resetIdLimiter(scope: string, id: number | string): Promise<void> {
  await resetCounter(idLimitKey(scope, id));
}
