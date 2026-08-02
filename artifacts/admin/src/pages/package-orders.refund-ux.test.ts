import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = readFileSync(
  resolve(process.cwd(), "artifacts/admin/src/pages/package-orders.tsx"),
  "utf8",
);

test("refund request keeps the existing eligibility and reason gates with visible disabled feedback", () => {
  assert.match(source, /const requestDisabled = pending \|\| !eligibility\.eligible \|\| reasonMissing/);
  assert.match(source, /disabled:cursor-not-allowed disabled:opacity-50/);
  assert.match(source, /Refund reason is required\./);
  assert.match(source, /Refund eligibility requirements are not met\./);
});

test("refund eligibility warnings and excluded-lot reasons are rendered", () => {
  assert.match(source, /eligibility\.integrityWarnings\.map/);
  assert.match(source, /eligibility\.excludedLots\.map/);
  assert.match(source, /Refund cannot be requested:/);
  assert.match(source, /no_refundable_value: "No refundable purchased credit value remains\."/);
  assert.match(source, /unknown_value: "The purchase value for these credits is unknown\."/);
});

test("refund request exposes pending, success, and error states without changing its API call", () => {
  assert.match(source, /pending \? "Requesting…" : "Request refund"/);
  assert.match(source, /Refund request submitted for review\./);
  assert.match(source, /role="status"/);
  assert.match(source, /role="alert"/);
  assert.match(source, /admin\/package-orders\/\$\{order\.id\}\/refunds/);
  assert.match(source, /idempotencyKey: requestKey\.current/);
});
