/**
 * Shared Ballet enums — the canonical, single-source-of-truth definitions
 * for application and payment status literals. Moved here (out of
 * lib/db/src/schema/balletApplications.ts and balletPayments.ts) so that
 * frontend packages (mobile, admin) can import the exact same values the
 * backend/schema use, instead of retyping the string literals by hand.
 */

/**
 * Status machine:
 *   pending → accepted → assignedToLevel → active
 *           ↘ rejected
 *           ↘ needsFollowUp
 *
 * (Old values "submitted"/"pendingAssessment" merged into "pending" and
 * "activeBallet" renamed to "active" — data migrated in migration 0047.)
 */
export const BALLET_APPLICATION_STATUSES = [
  "pending",
  "accepted",
  "needsFollowUp",
  "assignedToLevel",
  "active",
  "rejected",
  "cancelled",
] as const;

export type BalletApplicationStatus = (typeof BALLET_APPLICATION_STATUSES)[number];

/**
 * Status machine:
 *   pending → paid → refunded
 *           ↘ rejected
 */
export const BALLET_PAYMENT_STATUSES = [
  "pending",
  "rejected",
  "paid",
  "refunded",
] as const;

export type BalletPaymentStatus = (typeof BALLET_PAYMENT_STATUSES)[number];
