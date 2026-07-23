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
  "withdrawn",
] as const;

export type BalletApplicationStatus = (typeof BALLET_APPLICATION_STATUSES)[number];

export const BALLET_APPLICATION_STATUS_LABELS: Record<BalletApplicationStatus, string> = {
  pending: "Pending",
  accepted: "Accepted",
  needsFollowUp: "Needs Follow-up",
  assignedToLevel: "Assigned to Level",
  active: "Active",
  rejected: "Rejected",
  cancelled: "Cancelled",
  withdrawn: "Withdrawn",
};

export const BALLET_ACTIVE_APPLICATION_STATUSES = BALLET_APPLICATION_STATUSES.filter(
  (status) => status !== "rejected" && status !== "cancelled" && status !== "withdrawn",
);

export const BALLET_TERMINAL_APPLICATION_STATUSES = [
  "rejected",
  "cancelled",
  "withdrawn",
] as const satisfies readonly BalletApplicationStatus[];

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

export const BALLET_PAYMENT_STATUS_LABELS: Record<BalletPaymentStatus, string> = {
  pending: "Pending",
  rejected: "Rejected",
  paid: "Paid",
  refunded: "Refunded",
};

/**
 * Payment methods — a small fixed set treated as an enum at the application
 * layer only (no DB CHECK). Records HOW a payment is/was taken; NOT a
 * payment-gateway integration. Introduced (A7) for the admin-recorded
 * ballet_payments.paymentMethod, and reused (C1) for the parent-facing
 * ballet_applications.preferredPaymentMethod chosen at intake. Hoisted here so
 * schema, mobile, and admin all import the same three values.
 */
export const BALLET_PAYMENT_METHODS = [
  "bankTransfer",
  "kashier",
  "inPerson",
] as const;

export type BalletPaymentMethod = (typeof BALLET_PAYMENT_METHODS)[number];

export const BALLET_PAYMENT_METHOD_LABELS: Record<BalletPaymentMethod, string> = {
  bankTransfer: "Bank Transfer",
  kashier: "Kashier",
  inPerson: "In Person",
};

export const BALLET_SUBSCRIPTION_STATUSES = [
  "pending",
  "active",
  "renewed",
  "expired",
] as const;

export type BalletSubscriptionStatus = (typeof BALLET_SUBSCRIPTION_STATUSES)[number];

export const BALLET_SUBSCRIPTION_STATUS_LABELS: Record<BalletSubscriptionStatus, string> = {
  pending: "Pending Payment",
  active: "Active",
  renewed: "Renewed — Active",
  expired: "Expired",
};

export const BALLET_SUBSCRIPTION_FILTERS = [
  "pending",
  "active",
  "expiringSoon",
  "expired",
  "renewed",
] as const;

export type BalletSubscriptionFilter = (typeof BALLET_SUBSCRIPTION_FILTERS)[number];

export const BALLET_SUBSCRIPTION_FILTER_LABELS: Record<BalletSubscriptionFilter, string> = {
  pending: "Pending Payment",
  active: "Active Subscription",
  expiringSoon: "Expiring Soon",
  expired: "Expired",
  renewed: "Renewed",
};

export const BALLET_ATTENDANCE_STATUSES = [
  "checked_in",
  "late",
  "absent",
  "cancelled",
] as const;

export type BalletAttendanceStatus = (typeof BALLET_ATTENDANCE_STATUSES)[number];

export const BALLET_ATTENDANCE_STATUS_LABELS: Record<BalletAttendanceStatus, string> = {
  checked_in: "Checked In",
  late: "Late",
  absent: "Absent",
  cancelled: "Cancelled",
};

export const BALLET_ATTENDED_ATTENDANCE_STATUSES = [
  "checked_in",
  "late",
] as const satisfies readonly BalletAttendanceStatus[];

export const BALLET_CHECKED_IN_ATTENDANCE_STATUS = "checked_in" satisfies BalletAttendanceStatus;
export const BALLET_ABSENT_ATTENDANCE_STATUS = "absent" satisfies BalletAttendanceStatus;
export const BALLET_CANCELLED_ATTENDANCE_STATUS = "cancelled" satisfies BalletAttendanceStatus;

export const BALLET_LEVEL_ASSIGNMENT_STATUSES = [
  "active",
  "paused",
  "graduated",
  "withdrawn",
] as const;

export type BalletLevelAssignmentStatus = (typeof BALLET_LEVEL_ASSIGNMENT_STATUSES)[number];

export const BALLET_LEVEL_ASSIGNMENT_STATUS_LABELS: Record<BalletLevelAssignmentStatus, string> = {
  active: "Active",
  paused: "Paused",
  graduated: "Graduated",
  withdrawn: "Withdrawn",
};

// ─── Status Lifecycle & Allowed Transitions ────────────────────────────────────

export const BALLET_STATUS_TRANSITIONS: Record<BalletApplicationStatus, readonly BalletApplicationStatus[]> = {
  pending:         ["accepted", "rejected", "needsFollowUp", "cancelled"],
  needsFollowUp:   ["accepted", "rejected", "cancelled"],
  accepted:        ["cancelled"],
  assignedToLevel: ["active", "cancelled"],
  active:          [],
  rejected:        [],
  cancelled:       [],
  withdrawn:       [],
};

export function isTransitionAllowed(from: BalletApplicationStatus, to: BalletApplicationStatus): boolean {
  return BALLET_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

// ─── Assessment Booking Window ──────────────────────────────────────────────────

export const BALLET_ASSESSMENT_BOOKING_WINDOW_DAYS = 28;
