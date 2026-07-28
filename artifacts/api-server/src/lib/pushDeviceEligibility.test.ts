import assert from "node:assert/strict";
import test from "node:test";
import { isPushDeviceEligible } from "./pushDeviceEligibility";

test("inactive and non-Expo devices are excluded from Push delivery", () => {
  assert.equal(isPushDeviceEligible({ provider: "expo", isActive: true }), true);
  assert.equal(isPushDeviceEligible({ provider: "expo", isActive: false }), false);
  assert.equal(isPushDeviceEligible({ provider: "other", isActive: true }), false);
});
