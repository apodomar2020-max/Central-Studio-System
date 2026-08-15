/**
 * Notification source/origin classification (Wave 1).
 *
 * The canonical, single-source-of-truth definition for `notifications.source`
 * — mirrors the pattern used for Ballet's shared status enums (see ballet.ts)
 * so frontend/backend packages import the exact same values rather than
 * retyping string literals by hand.
 *
 * Semantics:
 *   manual_admin — created through the Admin manual notification composer/API.
 *                  Assigned server-side only (routes/notifications.ts); never
 *                  accepted from client input, so it cannot be spoofed.
 *   system       — a direct transactional/domain event (booking, attendance,
 *                  package lifecycle, Ballet application/cancellation/refund,
 *                  schedule changed/cancelled, ...).
 *   automation   — created by a scheduled/worker process (class/post-class
 *                  reminders, package expiry/low-credit reminders, Ballet
 *                  automatic absence detection).
 *
 * Nullable at the column level: historical rows created before this
 * classification existed are left unclassified (NULL), not backfilled.
 */
export const NOTIFICATION_SOURCES = [
  "manual_admin",
  "system",
  "automation",
] as const;

export type NotificationSource = (typeof NOTIFICATION_SOURCES)[number];
