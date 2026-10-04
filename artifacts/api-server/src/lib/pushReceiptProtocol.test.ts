import assert from "node:assert/strict";
import { test } from "node:test";
import { parseExpoResult, pushTokenHash, canRetirePushToken } from "./pushReceiptProtocol";
test("missing or malformed Expo tickets cannot count as success", () => {
  for (const value of [null, {}, { status: "ok" }, { status: "error", message: "secret" }]) assert.equal(parseExpoResult(value, true).ok, false);
  assert.equal(parseExpoResult({ status: "ok", id: "id" }, true).ok, true);
  assert.equal(parseExpoResult({ status: "ok" }).ok, true);
  assert.equal(parseExpoResult({ status: "error", details: { error: "DeviceNotRegistered" } }).error, "DeviceNotRegistered");
  assert.equal(parseExpoResult({ status: "error", details: { error: "private-token" } }).error, "expo_invalid_response");
});
test("stale token errors cannot retire a rotated or newer registration", () => {
  const attempted = "2026-10-04T10:00:00Z", earlier = "2026-10-04T09:59:00Z", later = "2026-10-04T10:01:00Z";
  assert.equal(canRetirePushToken("old", pushTokenHash("old"), earlier, attempted), true);
  assert.equal(canRetirePushToken("new", pushTokenHash("old"), earlier, attempted), false);
  assert.equal(canRetirePushToken("old", pushTokenHash("old"), later, attempted), false);
  assert.equal(canRetirePushToken("old", null, earlier, attempted), false);
});
