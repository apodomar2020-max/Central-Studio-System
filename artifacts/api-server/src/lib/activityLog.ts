/**
 * activityLog — unified admin activity logging service (Phase 7B).
 *
 * Writes one row to admin_activity_logs per sensitive admin mutation.
 *
 * Contract:
 *  - Call AFTER the business action succeeds (never inside its transaction).
 *  - NEVER throws — a logging failure must never break the business action.
 *    Failures are reported through the operational logger only.
 *  - before/after are redacted recursively: password/token/OTP/secret-like
 *    keys are replaced with "[redacted]", and oversized payloads truncated.
 *  - Full role permission maps must not be passed here — pass summary-level
 *    values (e.g. a permission count) instead.
 *
 * (Named activityLog.ts deliberately — lib/audit.ts is reserved by the
 * stashed marketing-audit WIP.)
 */
import { db, adminActivityLogsTable } from "@workspace/db";
import { logger } from "./logger";
import type { AdminRequest } from "../routes/adminAuth";

/** Keys whose values must never be stored. Matched case-insensitively; most
 *  as substrings ("passwordHash", "metaAccessToken"…), "code"/"otp"/"jwt" as
 *  exact segment names to avoid nuking harmless keys like "postalCode". */
const REDACT_SUBSTRINGS = ["password", "token", "secret", "apikey", "api_key", "authorization"] as const;
const REDACT_EXACT = new Set(["otp", "jwt", "code"]);

const REDACTED = "[redacted]";
const MAX_JSON_CHARS = 8_192;
const MAX_USER_AGENT_CHARS = 512;
const MAX_DEPTH = 6;

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  if (REDACT_EXACT.has(normalized)) return true;
  return REDACT_SUBSTRINGS.some((fragment) => normalized.includes(fragment));
}

function redactValue(value: unknown, depth: number): unknown {
  if (value == null || depth > MAX_DEPTH) return value == null ? value : REDACTED;
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = isSensitiveKey(key) ? REDACTED : redactValue(entry, depth + 1);
    }
    return result;
  }
  return value;
}

/** Redact sensitive keys recursively and cap serialized size. */
function sanitize(payload: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (payload == null) return null;
  const redacted = redactValue(payload, 0) as Record<string, unknown>;
  try {
    if (JSON.stringify(redacted).length > MAX_JSON_CHARS) {
      return { _truncated: true, note: `payload exceeded ${MAX_JSON_CHARS} characters` };
    }
  } catch {
    return { _unserializable: true };
  }
  return redacted;
}

/**
 * Optional helper: reduce full before/after objects to only the listed keys
 * whose values actually changed — keeps jsonb rows small and reviewable.
 */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  keys: readonly string[],
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const changedBefore: Record<string, unknown> = {};
  const changedAfter: Record<string, unknown> = {};
  for (const key of keys) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changedBefore[key] = before[key];
      changedAfter[key] = after[key];
    }
  }
  return { before: changedBefore, after: changedAfter };
}

export interface ActivityLogEntry {
  /** e.g. "create" | "update" | "delete" | "activate" | "deactivate" | "cancel" | "statusChange" */
  action: string;
  /** Permission-catalog module key, e.g. "adminUsers", "roles". */
  module: string;
  /** e.g. "system_user", "role". */
  entityType: string;
  entityId?: number | string | null;
  entityLabel?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  /** Human-readable one-liner, e.g. `Created role Reception`. */
  summary: string;
}

/**
 * Record an admin action. Actor identity comes from req.adminUser (attached
 * by requireAdminAuth, DB-authoritative). Safe to call unconditionally —
 * swallows every error after reporting it to the operational logger.
 */
export async function logActivity(req: AdminRequest, entry: ActivityLogEntry): Promise<void> {
  try {
    const actor = req.adminUser;
    const userAgentHeader = req.headers["user-agent"];
    await db.insert(adminActivityLogsTable).values({
      actorId: actor?.id ?? null,
      actorName: actor?.fullName ?? "unknown",
      actorEmail: actor?.email ?? "unknown",
      action: entry.action,
      module: entry.module,
      entityType: entry.entityType,
      entityId: entry.entityId != null ? String(entry.entityId) : null,
      entityLabel: entry.entityLabel ?? null,
      before: sanitize(entry.before),
      after: sanitize(entry.after),
      summary: entry.summary,
      ipAddress: req.ip ?? null,
      userAgent: typeof userAgentHeader === "string" ? userAgentHeader.slice(0, MAX_USER_AGENT_CHARS) : null,
    });
  } catch (error) {
    logger.error({ error, action: entry.action, module: entry.module }, "Failed to write admin activity log");
  }
}
