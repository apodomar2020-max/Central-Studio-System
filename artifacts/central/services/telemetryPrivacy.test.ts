import assert from "node:assert/strict";
import test from "node:test";
import { scrubCrashEvent } from "./telemetryPrivacy";
test("crash events retain stack structure but remove arbitrary payloads and account information", () => {
  const event = { message: "synthetic sensitive message", contexts: { private: "synthetic" }, user: { email: "test@example.com" },
    request: { headers: { authorization: "synthetic" } }, extra: { medicalNotes: "synthetic" }, breadcrumbs: [{ message: "synthetic" }],
    exception: { values: [{ type: "Error", value: "synthetic private error", stacktrace: { frames: [{ filename: "app.ts" }] } }] } };
  const cleaned = scrubCrashEvent(event);
  for (const key of ["message", "contexts", "user", "request", "extra", "breadcrumbs"]) assert.equal(key in cleaned, false);
  assert.equal(cleaned.exception.values[0].type, "Error");
  assert.deepEqual(cleaned.exception.values[0].stacktrace.frames, [{ filename: "app.ts" }]);
  assert.equal(JSON.stringify(cleaned).includes("synthetic"), false);
});
