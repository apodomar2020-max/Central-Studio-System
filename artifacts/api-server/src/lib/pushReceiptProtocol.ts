import { createHash } from "node:crypto";
export const pushTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const ERROR_CODES = new Set(["DeviceNotRegistered", "MessageTooBig", "MessageRateExceeded", "InvalidCredentials", "MismatchSenderId"]);
export function parseExpoResult(value: unknown, ticket = false): { ok: boolean; id: string | null; error: string | null } {
  const result = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const id = typeof result.id === "string" && result.id.length > 0 && result.id.length <= 200 ? result.id : null;
  const details = result.details && typeof result.details === "object" ? result.details as Record<string, unknown> : {};
  const ok = result.status === "ok" && (!ticket || id !== null);
  return { ok, id, error: ok ? null : typeof details.error === "string" && ERROR_CODES.has(details.error) ? details.error : "expo_invalid_response" };
}
export function canRetirePushToken(currentToken: string, attemptedHash: string | null, lastSeenAt: string, attemptedAt: string | null) {
  return attemptedHash !== null && attemptedAt !== null && pushTokenHash(currentToken) === attemptedHash
    && new Date(lastSeenAt).getTime() <= new Date(attemptedAt).getTime();
}
