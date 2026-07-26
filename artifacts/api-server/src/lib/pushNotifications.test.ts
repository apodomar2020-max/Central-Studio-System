import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.DATABASE_URL = process.env.DISPOSABLE_ROUTES_DATABASE_URL
  ?? "postgresql://postgres@127.0.0.1:5602/central_studio_disposable_routes";

// Static imports are hoisted above this file's own DATABASE_URL assignment
// above, so pushNotifications.ts (which statically imports @workspace/db,
// throwing at module-eval time if DATABASE_URL isn't already set) must be
// imported dynamically, after the assignment runs — same pattern used by
// attendanceResolver.integration.test.ts's before() hook.
let sendPushNotification: typeof import("./pushNotifications").sendPushNotification;

before(async () => {
  ({ sendPushNotification } = await import("./pushNotifications"));
});

test("sendPushNotification: skips cleanly when push is disabled without unhandled rejection on log insert error", async () => {
  const prevEnv = process.env.PUSH_NOTIFICATIONS_ENABLED;
  delete process.env.PUSH_NOTIFICATIONS_ENABLED;
  try {
    const res = await sendPushNotification({
      studentId: 999999,
      notificationId: 999999,
      title: "Test Push",
      body: "Test Body",
    });
    assert.equal(res.skipped, true);
    assert.equal(res.reason, "push_disabled");
  } finally {
    if (prevEnv !== undefined) {
      process.env.PUSH_NOTIFICATIONS_ENABLED = prevEnv;
    }
  }
});
