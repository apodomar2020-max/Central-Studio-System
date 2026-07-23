export type NotificationRoute = "/(tabs)/bookings" | "/package-center" | "/notifications" | `/ballet/application-status${string}`;

const BOOKING_NOTIFICATION_TYPES = new Set([
  "booking_confirmed",
  "booking_rejected",
  "booking_cancelled",
  "schedule_changed",
  "schedule_cancelled",
  "class_reminder_24h",
  "class_reminder_1h",
]);

const PACKAGE_NOTIFICATION_TYPES = new Set([
  "package_created",
  "package_activated",
  "package_expiry_7d",
  "package_low_credits_1",
  "package_cancelled",
  "package_rejected",
]);

const BALLET_NOTIFICATION_TYPES = new Set([
  "ballet_application_cancelled",
  "ballet_cancellation_requested",
  "ballet_cancellation_withdrawn",
  "ballet_cancellation_completed",
  "ballet_cancellation_scheduled",
  "ballet_cancellation_rejected",
  "ballet_refund_approved",
  "ballet_refund_rejected",
  "ballet_refund_processing",
  "ballet_refund_completed",
  "ballet_refund_failed",
  "ballet_absence_recorded",
]);

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function idValue(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return String(value);
  return stringValue(value);
}

export function resolveNotificationRoute(data: unknown): NotificationRoute {
  const payload = data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : {};
  const type = stringValue(payload.type);

  if (type && BOOKING_NOTIFICATION_TYPES.has(type)) {
    return "/(tabs)/bookings";
  }

  if (type && PACKAGE_NOTIFICATION_TYPES.has(type)) {
    return "/package-center";
  }

  if (type && BALLET_NOTIFICATION_TYPES.has(type)) {
    const metadata = payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata)
      ? payload.metadata as Record<string, unknown>
      : {};
    const applicationId = idValue(metadata.applicationId) ?? idValue(payload.applicationId);
    return applicationId
      ? `/ballet/application-status?id=${encodeURIComponent(applicationId)}`
      : "/ballet/application-status";
  }

  return "/notifications";
}

export const NOTIFICATION_ROUTE_BY_TYPE = {
  booking_confirmed: "/(tabs)/bookings",
  booking_rejected: "/(tabs)/bookings",
  booking_cancelled: "/(tabs)/bookings",
  schedule_changed: "/(tabs)/bookings",
  schedule_cancelled: "/(tabs)/bookings",
  class_reminder_24h: "/(tabs)/bookings",
  class_reminder_1h: "/(tabs)/bookings",
  package_created: "/package-center",
  package_activated: "/package-center",
  package_expiry_7d: "/package-center",
  package_low_credits_1: "/package-center",
  package_cancelled: "/package-center",
  package_rejected: "/package-center",
  default: "/notifications",
} as const satisfies Record<string, NotificationRoute>;
