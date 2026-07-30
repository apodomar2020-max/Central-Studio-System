import assert from "node:assert/strict";
import test from "node:test";
import { freshLaunchConfigurationManifest, MANIFEST_HASH, validateManifest } from "./freshLaunchConfigurationManifest";

test("manifest is valid, stable, and defaults sensitive groups to exclusion", () => {
  assert.doesNotThrow(validateManifest);
  assert.match(MANIFEST_HASH, /^[a-f0-9]{64}$/);
  assert.equal(freshLaunchConfigurationManifest.find((entry) => entry.table === "students")?.classification, "decision_required");
  assert.equal(freshLaunchConfigurationManifest.find((entry) => entry.table === "payment_events")?.classification, "exclude");
  assert.equal(freshLaunchConfigurationManifest.find((entry) => entry.table === "ballet_levels")?.classification, "transfer");
});

test("every table occurs once and transfer dependencies precede children", () => {
  assert.equal(new Set(freshLaunchConfigurationManifest.map((entry) => entry.table)).size, freshLaunchConfigurationManifest.length);
  for (const group of freshLaunchConfigurationManifest.filter((entry) => entry.classification === "transfer")) {
    for (const dependency of group.dependencies) {
      const parent = freshLaunchConfigurationManifest.find((entry) => entry.key === dependency);
      assert.ok(parent);
      assert.ok(parent!.order <= group.order);
    }
  }
});
