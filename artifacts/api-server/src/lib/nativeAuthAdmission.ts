import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import type { Request, RequestHandler } from "express";
import { accountFingerprint, getAdmissionRedis } from "./authAbuseProtection";

// Launch safety defaults, not traffic-calibrated limits. Bad overrides fail
// startup rather than silently removing a security boundary.
function setting(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Invalid positive integer configuration: ${name}`);
  }
  return value;
}

export const AUTH_ADMISSION_CONFIG = Object.freeze({
  registerShort: setting("NATIVE_REGISTER_GLOBAL_15M", 10),
  registerDay: setting("NATIVE_REGISTER_GLOBAL_24H", 100),
  registerEmail: setting("NATIVE_REGISTER_EMAIL_1H", 5),
  registerPeer: setting("NATIVE_REGISTER_PEER_1H", 60),
  recoveryShort: setting("AUTH_RECOVERY_REQUEST_GLOBAL_15M", 20),
  recoveryDay: setting("AUTH_RECOVERY_REQUEST_GLOBAL_24H", 200),
  recoveryEmail: setting("AUTH_RECOVERY_REQUEST_EMAIL_15M", 5),
  recoveryPeer: setting("AUTH_RECOVERY_REQUEST_PEER_15M", 40),
  providerShort: setting("AUTH_EMAIL_GLOBAL_15M", 10),
  providerDay: setting("AUTH_EMAIL_GLOBAL_24H", 200),
  verificationShort: setting("AUTH_EMAIL_VERIFY_15M", 5),
  verificationDay: setting("AUTH_EMAIL_VERIFY_24H", 150),
  recipientHour: setting("AUTH_EMAIL_RECIPIENT_1H", 5),
  recipientDay: setting("AUTH_EMAIL_RECIPIENT_24H", 10),
  studentShort: setting("AUTH_EMAIL_STUDENT_15M", 10),
  peerShort: setting("AUTH_EMAIL_PEER_15M", 20),
  providerTimeoutMs: setting("AUTH_EMAIL_TIMEOUT_MS", 5000),
});

export type AdmissionContext = { peer?: string; studentId?: number | null };
export type AdmissionLimit = { dimension: string; limit: number; windowMs: number };
export class AuthAdmissionError extends Error {
  constructor(public readonly kind: "limited" | "unavailable", public readonly retryAfterSeconds = 1) {
    super("Authentication admission temporarily unavailable");
    this.name = "AuthAdmissionError";
  }
}

// Railway's current observed chain does not establish a trustworthy end-client
// IP. NEVER accept XFF/X-Real-IP here or guess proxy hops. TCP peer is only a
// coarse secondary signal; identifier and fleet limits are authoritative.
export function admissionContext(req: Pick<Request, "socket" | "studentId">): AdmissionContext {
  const address = req.socket.remoteAddress;
  const peer = address?.startsWith("::ffff:") ? address.slice(7) : address;
  return { ...(peer && isIP(peer) ? { peer } : {}), studentId: req.studentId };
}

// All dimensions are checked and reserved together, using Redis server time.
// True rolling windows, no fixed-window boundary doubling and no local fallback.
export const ADMISSION_SCRIPT = `
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local retry = 0
for i, key in ipairs(KEYS) do
  local window = tonumber(ARGV[i * 2])
  local limit = tonumber(ARGV[i * 2 + 1])
  redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
  if redis.call('ZCARD', key) >= limit then
    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    retry = math.max(retry, tonumber(oldest[2]) + window - now)
  end
end
if retry > 0 then return {0, math.ceil(retry / 1000)} end
for i, key in ipairs(KEYS) do
  redis.call('ZADD', key, now, ARGV[1])
  redis.call('PEXPIRE', key, tonumber(ARGV[i * 2]))
end
return {1, 0}
`;

export async function reserveAdmission(limits: AdmissionLimit[]): Promise<void> {
  const redis = getAdmissionRedis();
  if (!redis || limits.length === 0) throw new AuthAdmissionError("unavailable");
  const keys = limits.map(({ dimension }) => `authadmission:{auth}:v1:${dimension}`);
  const args = limits.flatMap(({ windowMs, limit }) => [String(windowMs), String(limit)]);
  let result: unknown;
  try {
    result = await redis.eval(ADMISSION_SCRIPT, keys.length, ...keys, randomUUID(), ...args);
  } catch {
    throw new AuthAdmissionError("unavailable");
  }
  if (!Array.isArray(result) || result.length !== 2 || ![0, 1].includes(result[0]) || !Number.isFinite(result[1])) {
    throw new AuthAdmissionError("unavailable");
  }
  if (result[0] !== 1) throw new AuthAdmissionError("limited", Math.max(1, result[1]));
}

const minutes15 = 900_000;
const hour = 3_600_000;
const day = 86_400_000;
const c = AUTH_ADMISSION_CONFIG;
function dimension(dimension: string, limit: number, windowMs: number): AdmissionLimit {
  return { dimension, limit, windowMs };
}

export async function reserveRegistration(email: string, context: AdmissionContext): Promise<void> {
  await reserveAdmission([
    dimension("register:global:short", c.registerShort, minutes15),
    dimension("register:global:day", c.registerDay, day),
    dimension(`register:email:${accountFingerprint(email.trim().toLowerCase())}`, c.registerEmail, hour),
    ...(context.peer ? [dimension(`register:peer:${accountFingerprint(context.peer)}`, c.registerPeer, hour)] : []),
  ]);
}

export async function reserveRecoveryRequest(email: string, context: AdmissionContext = {}): Promise<void> {
  await reserveAdmission([
    dimension("recovery:global:short", c.recoveryShort, minutes15),
    dimension("recovery:global:day", c.recoveryDay, day),
    dimension(`recovery:email:${accountFingerprint(email.trim().toLowerCase())}`, c.recoveryEmail, minutes15),
    ...(context.peer ? [dimension(`recovery:peer:${accountFingerprint(context.peer)}`, c.recoveryPeer, minutes15)] : []),
  ]);
}

export async function reserveEmailAttempt(email: string, verification: boolean, context: AdmissionContext = {}): Promise<void> {
  const recipient = accountFingerprint(email.trim().toLowerCase());
  await reserveAdmission([
    dimension("email:global:short", c.providerShort, minutes15),
    dimension("email:global:day", c.providerDay, day),
    dimension(`email:recipient:hour:${recipient}`, c.recipientHour, hour),
    dimension(`email:recipient:day:${recipient}`, c.recipientDay, day),
    ...(verification ? [dimension("email:verify:short", c.verificationShort, minutes15), dimension("email:verify:day", c.verificationDay, day)] : []),
    ...(context.studentId != null ? [dimension(`email:student:${context.studentId}`, c.studentShort, minutes15)] : []),
    ...(context.peer ? [dimension(`email:peer:${accountFingerprint(context.peer)}`, c.peerShort, minutes15)] : []),
  ]);
}

export const nativeRegistrationAdmission: RequestHandler = async (req, res, next) => {
  if (typeof req.body?.email !== "string" || req.body.email.length > 320) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  try {
    await reserveRegistration(req.body.email, admissionContext(req));
    next();
  } catch (error) {
    if (!(error instanceof AuthAdmissionError)) return next(error);
    res.setHeader("Retry-After", error.retryAfterSeconds);
    res.status(error.kind === "limited" ? 429 : 503).json({ error: "Please try again later." });
  }
};
