export type NotificationRoute = "/(tabs)/bookings" | "/package-center" | "/notifications";

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

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
