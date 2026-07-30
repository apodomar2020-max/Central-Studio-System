import assert from "node:assert/strict";
import test from "node:test";
import { scanEvidenceOutput } from "./evidenceOutputScanner";
import { MANIFEST_HASH, MANIFEST_VERSION } from "./freshLaunchConfigurationManifest";
import { approvalBundleHash, validateApprovalBundle } from "./productionApprovalBundle";
import {
  SYNTHETIC_APPROVED_COMMIT as commit,
  SYNTHETIC_APPROVAL_NOW as now,
  syntheticApprovalBundle,
  syntheticEnvironmentIdentity,
} from "./productionApprovalFixtures";
import {
  productionEnvironmentIdentityHash,
  validateProductionEnvironmentIdentity,
} from "./productionEnvironmentIdentity";
import {
  productionInspectionEvidenceHash,
  type ProductionInspectionEvidence,
  validateInspectionEvidence,
} from "./productionInspectionEvidence";
import { validateG2aLocalInspectionTransport } from "./runApprovedProductionReadinessInspection";

function errorCode(work: () => unknown, code: string) {
  assert.throws(work, (error) => typeof error === "object" && error !== null && "code" in error && error.code === code);
}

test("accepts a complete synthetic approval bundle and hashes it deterministically", () => {
  const bundle = syntheticApprovalBundle();
  assert.equal(validateApprovalBundle(bundle, { expectedCommit: commit, now }), bundle);
  assert.equal(approvalBundleHash(bundle), approvalBundleHash(structuredClone(bundle)));
});

test("rejects missing bundle, role, duplicate role, and expired approvals", () => {
  errorCode(() => validateApprovalBundle(undefined, { expectedCommit: commit, now }), "APPROVAL_BUNDLE_MISSING");
  const missing = syntheticApprovalBundle();
  missing.approvals.pop();
  errorCode(() => validateApprovalBundle(missing, { expectedCommit: commit, now }), "REQUIRED_APPROVER_MISSING");
  const duplicate = syntheticApprovalBundle();
  duplicate.approvals.push({ ...duplicate.approvals[0]! });
  errorCode(() => validateApprovalBundle(duplicate, { expectedCommit: commit, now }), "DUPLICATE_APPROVER_ROLE");
  const expired = syntheticApprovalBundle();
  expired.expiresAt = "2029-01-01T00:00:00.000Z";
  errorCode(() => validateApprovalBundle(expired, { expectedCommit: commit, now }), "APPROVAL_EXPIRED");
});

test("rejects commit and manifest mismatches", () => {
  const commitMismatch = syntheticApprovalBundle();
  commitMismatch.approvedCommit = "a".repeat(40);
  errorCode(() => validateApprovalBundle(commitMismatch, { expectedCommit: commit, now }), "APPROVED_COMMIT_MISMATCH");
  const versionMismatch = syntheticApprovalBundle();
  versionMismatch.manifestVersion = "other";
  errorCode(() => validateApprovalBundle(versionMismatch, { expectedCommit: commit, now }), "MANIFEST_VERSION_MISMATCH");
  const hashMismatch = syntheticApprovalBundle();
  hashMismatch.manifestHash = "0".repeat(64);
  errorCode(() => validateApprovalBundle(hashMismatch, { expectedCommit: commit, now }), "MANIFEST_HASH_MISMATCH");
});

test("rejects missing backup, restore, and maintenance evidence", () => {
  for (const [field, code] of [
    ["backupEvidenceReference", "BACKUP_EVIDENCE_MISSING"],
    ["restoreEvidenceReference", "RESTORE_EVIDENCE_MISSING"],
    ["maintenanceWindowReference", "MAINTENANCE_WINDOW_MISSING"],
  ] as const) {
    const bundle = syntheticApprovalBundle();
    bundle[field] = null;
    errorCode(() => validateApprovalBundle(bundle, { expectedCommit: commit, now }), code);
  }
  const invalidWindow = syntheticApprovalBundle();
  invalidWindow.maintenanceWindowReference = "postgresql://fake:credential@remote.invalid/db";
  assert.throws(() => validateApprovalBundle(invalidWindow, { expectedCommit: commit, now }));
});

test("rejects invalid, duplicate, missing, and unresolved decisions", () => {
  const invalid = syntheticApprovalBundle();
  invalid.decisions[0]!.id = "ID-99";
  errorCode(() => validateApprovalBundle(invalid, { expectedCommit: commit, now }), "INVALID_DECISION_ID");
  const duplicate = syntheticApprovalBundle();
  duplicate.decisions[1]!.id = "ID-01";
  errorCode(() => validateApprovalBundle(duplicate, { expectedCommit: commit, now }), "DUPLICATE_DECISION_ID");
  const unresolved = syntheticApprovalBundle();
  unresolved.decisions[0]!.status = "pending";
  errorCode(() => validateApprovalBundle(unresolved, { expectedCommit: commit, now }), "BLOCKING_DECISION_UNRESOLVED");
});

test("rejects missing post-write policy, unknown fields, and sensitive values", () => {
  const policyMissing = syntheticApprovalBundle();
  policyMissing.policies.postWriteIncident.status = "pending";
  errorCode(() => validateApprovalBundle(policyMissing, { expectedCommit: commit, now }), "POST_WRITE_POLICY_MISSING");
  const unknown = { ...syntheticApprovalBundle(), unexpected: true };
  errorCode(() => validateApprovalBundle(unknown, { expectedCommit: commit, now }), "APPROVAL_BUNDLE_UNKNOWN_FIELD");
  const sensitive = syntheticApprovalBundle();
  sensitive.approvals[0]!.approvalReference = "postgresql://fake:credential@remote.invalid/db";
  assert.throws(() => validateApprovalBundle(sensitive, { expectedCommit: commit, now }));
  assert.throws(() => scanEvidenceOutput({ password: "synthetic" }));
});

test("approval expiry and evidence hash linkage are deterministic", () => {
  const bundle = syntheticApprovalBundle();
  validateApprovalBundle(bundle, { expectedCommit: commit, now: new Date("2030-01-31T23:59:59.000Z") });
  errorCode(() => validateApprovalBundle(bundle, { expectedCommit: commit, now: new Date("2030-02-01T00:00:00.000Z") }), "APPROVAL_EXPIRED");
  const evidence = {
    toolVersion: "g2a-v1",
    approvedCommit: commit,
    manifestVersion: MANIFEST_VERSION,
    manifestHash: MANIFEST_HASH,
    approvalBundleHash: approvalBundleHash(bundle),
    environmentIdentityHash: "1".repeat(64),
    inspectionStartedAt: now.toISOString(),
    inspectionEndedAt: now.toISOString(),
    postgresqlVersion: "PostgreSQL synthetic",
    migrationCount: 91,
    latestMigration: "0091_participant_aware_attendance",
    readinessStatus: "ready",
    configurationBlockers: 0,
    integrityBlockers: 0,
    resetInventoryCounts: {},
    financeAggregateChecksum: "2".repeat(64),
    balletAggregateChecksum: "3".repeat(64),
    sourceFingerprint: "4".repeat(64),
    outputScannerResult: "passed",
    readOnlyProofResult: "passed",
    finalInspectionResult: "PRODUCTION_SOURCE_INSPECTION_READY",
  } satisfies ProductionInspectionEvidence;
  validateInspectionEvidence(evidence);
  assert.equal(productionInspectionEvidenceHash(evidence), productionInspectionEvidenceHash(structuredClone(evidence)));
});

test("environment identity uses hashes, rejects raw identity fields, and binds commits", () => {
  const identity = syntheticEnvironmentIdentity();
  validateProductionEnvironmentIdentity(identity, { expectedCommit: commit, now, requiredDatabaseRole: "source", requireReadOnly: true });
  assert.equal(productionEnvironmentIdentityHash(identity), productionEnvironmentIdentityHash(structuredClone(identity)));
  const raw = { ...identity, hostname: "remote.invalid" };
  assert.throws(() => validateProductionEnvironmentIdentity(raw, { expectedCommit: commit, now }));
  const mismatch = syntheticEnvironmentIdentity();
  mismatch.workerCommit = "a".repeat(40);
  errorCode(() => validateProductionEnvironmentIdentity(mismatch, { expectedCommit: commit, now }), "DEPLOYED_COMMIT_MISMATCH");
});

test("G2A transport permits disposable loopback only and redacts fake remote attempts by stable code", () => {
  assert.equal(validateG2aLocalInspectionTransport("postgresql://tester:fake@127.0.0.1/central_g2a_disposable", {}).hostname, "127.0.0.1");
  for (const value of [
    "postgresql://tester:fake@db.example.invalid/central_g2a_disposable",
    "postgresql://tester:fake@10.0.0.1/central_g2a_disposable",
    "postgresql://tester:fake@[2001:db8::1]/central_g2a_disposable",
  ]) {
    errorCode(() => validateG2aLocalInspectionTransport(value, {}), "G2A_REMOTE_CONNECTION_FORBIDDEN");
  }
  errorCode(
    () => validateG2aLocalInspectionTransport("postgresql://tester:fake@127.0.0.1/central_g2a_disposable", { RAILWAY_PROJECT_ID: "synthetic" }),
    "REMOTE_ENVIRONMENT_MARKER",
  );
  errorCode(
    () => validateG2aLocalInspectionTransport("postgresql://tester:fake@127.0.0.1/central_g2a_disposable?host=remote.invalid", {}),
    "G2A_CONNECTION_OVERRIDE_FORBIDDEN",
  );
});
