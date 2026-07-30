import assert from "node:assert/strict";
import test from "node:test";
import {
  G2B_AUTHORIZATION_VERSION,
  g2bInspectionAuthorizationHash,
  type G2bInspectionAuthorization,
  REQUIRED_G2B_AUTHORIZATION_ROLES,
  validateG2bInspectionAuthorization,
} from "./g2bInspectionAuthorization";
import { MANIFEST_HASH, MANIFEST_VERSION } from "./freshLaunchConfigurationManifest";
import { approvalBundleHash, validateApprovalBundle } from "./productionApprovalBundle";
import {
  SYNTHETIC_APPROVED_COMMIT as commit,
  SYNTHETIC_APPROVAL_NOW as now,
  syntheticApprovalBundle,
  syntheticEnvironmentIdentity,
} from "./productionApprovalFixtures";
import { productionEnvironmentIdentityHash } from "./productionEnvironmentIdentity";

function syntheticAuthorization(): G2bInspectionAuthorization {
  const bundle = syntheticApprovalBundle();
  const identity = syntheticEnvironmentIdentity();
  return {
    schemaVersion: G2B_AUTHORIZATION_VERSION,
    status: "AUTHORIZED",
    approvedCommit: commit,
    manifestVersion: MANIFEST_VERSION,
    manifestHash: MANIFEST_HASH,
    approvalBundleHash: approvalBundleHash(bundle),
    productionSourceEnvironmentIdentityHash: productionEnvironmentIdentityHash(identity),
    readOnlyDatabaseRoleEvidenceReference: "READ-ONLY-ROLE-EVIDENCE",
    evidenceOutputLocationReference: "APPROVED-EVIDENCE-LOCATION",
    inspectionScope: "production_source_read_only_readiness",
    authorizedAt: "2029-12-20T00:00:00.000Z",
    expiresAt: "2030-02-01T00:00:00.000Z",
    approvals: REQUIRED_G2B_AUTHORIZATION_ROLES.map((role) => ({
      role,
      approvalReference: `G2B-APPROVAL-${role.toUpperCase()}`,
      approvedAt: "2029-12-20T00:00:00.000Z",
    })),
  };
}

function expected() {
  return {
    approvedCommit: commit,
    approvalBundleHash: approvalBundleHash(syntheticApprovalBundle()),
    productionSourceEnvironmentIdentityHash: productionEnvironmentIdentityHash(syntheticEnvironmentIdentity()),
    now,
  };
}

function code(work: () => unknown, expectedCode: string) {
  assert.throws(work, (error) =>
    typeof error === "object" && error !== null && "code" in error && error.code === expectedCode);
}

test("recommendations, pending decisions, and blank sign-offs never count as approval", () => {
  const draft = syntheticApprovalBundle();
  draft.decisions[0] = { id: "ID-01", status: "pending", approvalReference: null, approvedAt: null };
  code(() => validateApprovalBundle(draft, { expectedCommit: commit, now }), "BLOCKING_DECISION_UNRESOLVED");
  const blank = syntheticApprovalBundle();
  blank.approvals[0]!.approvalReference = "";
  assert.throws(() => validateApprovalBundle(blank, { expectedCommit: commit, now }));
});

test("missing decision, approver, evidence, expiry, commit, and manifest gates remain rejected", () => {
  const missingDecision = syntheticApprovalBundle();
  missingDecision.decisions.pop();
  code(() => validateApprovalBundle(missingDecision, { expectedCommit: commit, now }), "BLOCKING_DECISION_UNRESOLVED");
  const missingApprover = syntheticApprovalBundle();
  missingApprover.approvals.pop();
  code(() => validateApprovalBundle(missingApprover, { expectedCommit: commit, now }), "REQUIRED_APPROVER_MISSING");
  const missingEvidence = syntheticApprovalBundle();
  missingEvidence.backupEvidenceReference = null;
  code(() => validateApprovalBundle(missingEvidence, { expectedCommit: commit, now }), "BACKUP_EVIDENCE_MISSING");
  const expired = syntheticApprovalBundle();
  expired.expiresAt = "2029-01-01T00:00:00.000Z";
  code(() => validateApprovalBundle(expired, { expectedCommit: commit, now }), "APPROVAL_EXPIRED");
  const commitMismatch = syntheticApprovalBundle();
  commitMismatch.approvedCommit = "a".repeat(40);
  code(() => validateApprovalBundle(commitMismatch, { expectedCommit: commit, now }), "APPROVED_COMMIT_MISMATCH");
  const manifestMismatch = syntheticApprovalBundle();
  manifestMismatch.manifestHash = "0".repeat(64);
  code(() => validateApprovalBundle(manifestMismatch, { expectedCommit: commit, now }), "MANIFEST_HASH_MISMATCH");
});

test("missing and NOT AUTHORIZED G2B records are denied", () => {
  code(() => validateG2bInspectionAuthorization(undefined, expected()), "G2B_AUTHORIZATION_MISSING");
  const denied = syntheticAuthorization();
  denied.status = "NOT_AUTHORIZED";
  code(() => validateG2bInspectionAuthorization(denied, expected()), "G2B_NOT_AUTHORIZED");
});

test("G2B authorization requires references, expiry, exact hashes, and every role", () => {
  const missingEvidence = syntheticAuthorization();
  missingEvidence.readOnlyDatabaseRoleEvidenceReference = null;
  code(() => validateG2bInspectionAuthorization(missingEvidence, expected()), "G2B_READ_ONLY_ROLE_EVIDENCE_MISSING");
  const expired = syntheticAuthorization();
  expired.expiresAt = "2029-01-01T00:00:00.000Z";
  code(() => validateG2bInspectionAuthorization(expired, expected()), "G2B_AUTHORIZATION_EXPIRED");
  const wrongHash = syntheticAuthorization();
  wrongHash.approvalBundleHash = "0".repeat(64);
  code(() => validateG2bInspectionAuthorization(wrongHash, expected()), "G2B_APPROVAL_BUNDLE_HASH_MISMATCH");
  const missingRole = syntheticAuthorization();
  missingRole.approvals.pop();
  code(() => validateG2bInspectionAuthorization(missingRole, expected()), "G2B_REQUIRED_APPROVER_MISSING");
});

test("synthetic fully approved records pass and hash deterministically without PII fields", () => {
  const bundle = syntheticApprovalBundle();
  validateApprovalBundle(bundle, { expectedCommit: commit, now });
  const authorization = syntheticAuthorization();
  validateG2bInspectionAuthorization(authorization, expected());
  assert.equal(g2bInspectionAuthorizationHash(authorization), g2bInspectionAuthorizationHash(structuredClone(authorization)));
  const serialized = JSON.stringify({ bundle, authorization });
  for (const forbidden of ["personalName", "emailAddress", "phoneNumber", "databaseUrl", "password", "credential"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});
