import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveNotificationRoute } from "./notificationNavigation";

test("ballet_absence_recorded routes to Application Status with the applicationId", () => {
  const route = resolveNotificationRoute({
    type: "ballet_absence_recorded",
    metadata: { applicationId: 42, attendanceId: 7, childName: "Roda" },
  });
  assert.equal(route, "/ballet/application-status?id=42");
});

test("ballet_absence_recorded with no applicationId falls back to the bare Application Status route (never a broken link)", () => {
  const route = resolveNotificationRoute({ type: "ballet_absence_recorded", metadata: {} });
  assert.equal(route, "/ballet/application-status");
});

test("an unrecognized type falls back to the generic notifications screen", () => {
  const route = resolveNotificationRoute({ type: "totally_unknown_type" });
  assert.equal(route, "/notifications");
});

test("existing booking/package/ballet routing is unaffected by the new type", () => {
  assert.equal(resolveNotificationRoute({ type: "class_reminder_1h" }), "/(tabs)/bookings");
  assert.equal(resolveNotificationRoute({ type: "package_expiry_7d" }), "/package-center");
  assert.equal(
    resolveNotificationRoute({ type: "ballet_cancellation_completed", metadata: { applicationId: 5 } }),
    "/ballet/application-status?id=5",
  );
});
