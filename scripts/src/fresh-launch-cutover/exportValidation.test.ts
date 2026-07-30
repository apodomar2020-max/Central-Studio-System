import assert from "node:assert/strict";
import test from "node:test";
import { deterministicHash, validateExportArtifact } from "./configurationExport";
import { MANIFEST_HASH, MANIFEST_VERSION } from "./freshLaunchConfigurationManifest";
import type { FreshLaunchExport } from "./types";

function artifactWith(group: FreshLaunchExport["groups"][number]): FreshLaunchExport {
  const base: FreshLaunchExport = {
    format: "central-studio-fresh-launch-configuration",
    version: 1,
    manifestVersion: MANIFEST_VERSION,
    manifestHash: MANIFEST_HASH,
    sourceMigration: "0091_participant_aware_attendance",
    groups: [group],
    contentHash: "",
  };
  return { ...base, contentHash: deterministicHash(base) };
}

test("rejects excluded transaction groups even when structurally valid", () => {
  const artifact = artifactWith({ key: "package_orders", table: "package_orders", columns: ["id"], rows: [], hash: deterministicHash([]) });
  assert.throws(() => validateExportArtifact(artifact), /EXPORT_GROUP_FORBIDDEN/);
});

test("rejects sensitive fields by actual column name", () => {
  const rows = [{ id: 1, email: "synthetic@example.invalid" }];
  const artifact = artifactWith({
    key: "danceTypes",
    table: "dance_types",
    columns: ["id", "email"],
    rows,
    hash: deterministicHash(rows),
  });
  assert.throws(() => validateExportArtifact(artifact), /SENSITIVE_EXPORT_COLUMN/);
});

test("rejects unknown row fields and modified group content", () => {
  const rows = [{ id: 1, unexpected: "value" }];
  const artifact = artifactWith({
    key: "danceTypes",
    table: "dance_types",
    columns: ["id"],
    rows,
    hash: deterministicHash(rows),
  });
  assert.throws(() => validateExportArtifact(artifact), /UNKNOWN_EXPORT_FIELD/);
});
