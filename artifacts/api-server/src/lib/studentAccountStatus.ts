/**
 * Student account lifecycle domain (Phase B1B).
 *
 * Three states exist in the schema (`students.account_status`), but only
 * "active" and "deactivated" are operationally reachable this phase — no
 * route in this phase can set an account to "deleted". It is included here
 * only so callers fail closed instead of accidentally treating an unknown
 * future status as active.
 */

export const STUDENT_ACCOUNT_STATUSES = ["active", "deactivated", "deleted"] as const;

export type StudentAccountStatus = (typeof STUDENT_ACCOUNT_STATUSES)[number];

export function isActiveAccountStatus(status: string | null | undefined): status is "active" {
  return status === "active";
}

export function isDeactivatedAccountStatus(status: string | null | undefined): status is "deactivated" {
  return status === "deactivated";
}

/** True for anything that is not the known-good "active" state — the fail-closed check. */
export function isBlockedAccountStatus(status: string | null | undefined): boolean {
  return !isActiveAccountStatus(status);
}

export const ACCOUNT_DEACTIVATED_BODY = {
  error: "This account has been deactivated.",
  code: "ACCOUNT_DEACTIVATED",
} as const;
