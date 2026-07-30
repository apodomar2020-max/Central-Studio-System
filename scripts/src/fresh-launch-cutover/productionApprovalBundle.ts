import { createHash } from "node:crypto";
import { MANIFEST_HASH, MANIFEST_VERSION } from "./freshLaunchConfigurationManifest";
import { assertSafeReference, scanEvidenceOutput } from "./evidenceOutputScanner";

export const APPROVAL_BUNDLE_VERSION = "g2a-v1";
export const REQUIRED_APPROVAL_ROLES = [
  "business_owner",
  "engineering_owner",
  "finance_owner",
  "ballet_domain_owner",
  "security_or_data_owner",
  "database_operator",
  "release_operator",
] as const;
export const REQUIRED_DECISION_IDS = Array.from({ length: 12 }, (_, index) => `ID-${String(index + 1).padStart(2, "0")}`);

export type ApprovalRole = typeof REQUIRED_APPROVAL_ROLES[number];
export type ApprovalStatus = "approved" | "pending";

export interface ApprovalBundle {
  schemaVersion: string;
  approvedCommit: string;
  manifestVersion: string;
  manifestHash: string;
  sourceEnvironmentClassification: "production_source";
  targetEnvironmentClassification: "fresh_production_target";
  maintenanceWindowReference: string | null;
  backupEvidenceReference: string | null;
  restoreEvidenceReference: string | null;
  approvals: Array<{
    role: ApprovalRole;
    approvalReference: string;
    approvedAt: string;
    expiresAt: string;
  }>;
  decisions: Array<{
    id: string;
    status: ApprovalStatus;
    approvalReference: string | null;
    approvedAt: string | null;
  }>;
  policies: {
    identity: PolicyDecision;
    archive: PolicyDecision;
    sequence: PolicyDecision;
    media: PolicyDecision;
    auditLogs: PolicyDecision;
    balletContactSettings: PolicyDecision;
    notificationConfiguration: PolicyDecision;
    financeBackfillReportHistory: PolicyDecision;
    preWriteRollback: PolicyDecision;
    postWriteIncident: PolicyDecision;
  };
  issuedAt: string;
  expiresAt: string;
  finalStatus: "GO" | "NO_GO";
}

export interface PolicyDecision {
  status: ApprovalStatus;
  approvalReference: string | null;
}

export class ApprovalBundleError extends Error {
  constructor(public readonly code: string, detail?: string) {
    super(`[fresh-launch-g2a:${code}]${detail ? ` ${detail}` : ""}`);
  }
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stable(child)]));
  }
  return value;
}

export function deterministicJson(value: unknown): string {
  return JSON.stringify(stable(value));
}

export function approvalBundleHash(bundle: ApprovalBundle): string {
  return createHash("sha256").update(deterministicJson(bundle)).digest("hex");
}

function assertExactKeys(value: unknown, allowed: readonly string[], code: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApprovalBundleError(code);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new ApprovalBundleError("APPROVAL_BUNDLE_UNKNOWN_FIELD");
}

function parseTime(value: unknown, code: string): number {
  if (typeof value !== "string") throw new ApprovalBundleError(code);
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new ApprovalBundleError(code);
  return time;
}

export function validateApprovalBundle(
  input: unknown,
  options: { expectedCommit: string; now?: Date; expectedManifestVersion?: string; expectedManifestHash?: string },
): ApprovalBundle {
  if (!input) throw new ApprovalBundleError("APPROVAL_BUNDLE_MISSING");
  assertExactKeys(input, [
    "schemaVersion", "approvedCommit", "manifestVersion", "manifestHash",
    "sourceEnvironmentClassification", "targetEnvironmentClassification",
    "maintenanceWindowReference", "backupEvidenceReference", "restoreEvidenceReference",
    "approvals", "decisions", "policies", "issuedAt", "expiresAt", "finalStatus",
  ], "APPROVAL_BUNDLE_INVALID");
  const bundle = input as unknown as ApprovalBundle;
  if (bundle.schemaVersion !== APPROVAL_BUNDLE_VERSION) throw new ApprovalBundleError("APPROVAL_BUNDLE_VERSION_UNSUPPORTED");
  if (bundle.approvedCommit !== options.expectedCommit) throw new ApprovalBundleError("APPROVED_COMMIT_MISMATCH");
  if (bundle.manifestVersion !== (options.expectedManifestVersion ?? MANIFEST_VERSION)) throw new ApprovalBundleError("MANIFEST_VERSION_MISMATCH");
  if (bundle.manifestHash !== (options.expectedManifestHash ?? MANIFEST_HASH)) throw new ApprovalBundleError("MANIFEST_HASH_MISMATCH");
  if (bundle.sourceEnvironmentClassification !== "production_source"
    || bundle.targetEnvironmentClassification !== "fresh_production_target") {
    throw new ApprovalBundleError("ENVIRONMENT_CLASSIFICATION_INVALID");
  }
  if (!bundle.backupEvidenceReference) throw new ApprovalBundleError("BACKUP_EVIDENCE_MISSING");
  if (!bundle.restoreEvidenceReference) throw new ApprovalBundleError("RESTORE_EVIDENCE_MISSING");
  if (!bundle.maintenanceWindowReference) throw new ApprovalBundleError("MAINTENANCE_WINDOW_MISSING");
  assertSafeReference(bundle.backupEvidenceReference, "BACKUP_EVIDENCE_INVALID");
  assertSafeReference(bundle.restoreEvidenceReference, "RESTORE_EVIDENCE_INVALID");
  assertSafeReference(bundle.maintenanceWindowReference, "MAINTENANCE_WINDOW_INVALID");
  const now = (options.now ?? new Date()).getTime();
  const bundleExpiry = parseTime(bundle.expiresAt, "APPROVAL_EXPIRY_INVALID");
  parseTime(bundle.issuedAt, "APPROVAL_TIMESTAMP_INVALID");
  if (bundleExpiry <= now) throw new ApprovalBundleError("APPROVAL_EXPIRED");
  if (!Array.isArray(bundle.approvals)) throw new ApprovalBundleError("REQUIRED_APPROVER_MISSING");
  const roles = new Set<string>();
  for (const approval of bundle.approvals) {
    assertExactKeys(approval, ["role", "approvalReference", "approvedAt", "expiresAt"], "APPROVAL_INVALID");
    if (!REQUIRED_APPROVAL_ROLES.includes(approval.role)) throw new ApprovalBundleError("APPROVER_ROLE_INVALID");
    if (roles.has(approval.role)) throw new ApprovalBundleError("DUPLICATE_APPROVER_ROLE", approval.role);
    roles.add(approval.role);
    assertSafeReference(approval.approvalReference, "APPROVAL_REFERENCE_INVALID");
    parseTime(approval.approvedAt, "APPROVAL_TIMESTAMP_INVALID");
    if (parseTime(approval.expiresAt, "APPROVAL_EXPIRY_INVALID") <= now) {
      throw new ApprovalBundleError("APPROVAL_EXPIRED", approval.role);
    }
  }
  for (const role of REQUIRED_APPROVAL_ROLES) {
    if (!roles.has(role)) throw new ApprovalBundleError("REQUIRED_APPROVER_MISSING", role);
  }
  if (!Array.isArray(bundle.decisions)) throw new ApprovalBundleError("BLOCKING_DECISION_UNRESOLVED");
  const decisionIds = new Set<string>();
  for (const decision of bundle.decisions) {
    assertExactKeys(decision, ["id", "status", "approvalReference", "approvedAt"], "DECISION_INVALID");
    if (!REQUIRED_DECISION_IDS.includes(decision.id)) throw new ApprovalBundleError("INVALID_DECISION_ID");
    if (decisionIds.has(decision.id)) throw new ApprovalBundleError("DUPLICATE_DECISION_ID", decision.id);
    decisionIds.add(decision.id);
    if (decision.status !== "approved" || !decision.approvalReference || !decision.approvedAt) {
      throw new ApprovalBundleError("BLOCKING_DECISION_UNRESOLVED", decision.id);
    }
    assertSafeReference(decision.approvalReference, "DECISION_REFERENCE_INVALID");
    parseTime(decision.approvedAt, "DECISION_TIMESTAMP_INVALID");
  }
  for (const id of REQUIRED_DECISION_IDS) {
    if (!decisionIds.has(id)) throw new ApprovalBundleError("BLOCKING_DECISION_UNRESOLVED", id);
  }
  assertExactKeys(bundle.policies, [
    "identity", "archive", "sequence", "media", "auditLogs", "balletContactSettings",
    "notificationConfiguration", "financeBackfillReportHistory", "preWriteRollback", "postWriteIncident",
  ], "POLICIES_INVALID");
  for (const [name, policy] of Object.entries(bundle.policies)) {
    assertExactKeys(policy, ["status", "approvalReference"], "POLICY_INVALID");
    if (policy.status !== "approved" || !policy.approvalReference) {
      throw new ApprovalBundleError(name === "postWriteIncident" ? "POST_WRITE_POLICY_MISSING" : "BLOCKING_POLICY_UNRESOLVED", name);
    }
    assertSafeReference(policy.approvalReference, "POLICY_REFERENCE_INVALID");
  }
  if (bundle.finalStatus !== "GO") throw new ApprovalBundleError("FINAL_GO_APPROVAL_MISSING");
  scanEvidenceOutput(bundle);
  return bundle;
}
