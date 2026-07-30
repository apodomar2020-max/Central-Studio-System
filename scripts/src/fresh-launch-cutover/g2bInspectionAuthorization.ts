import { createHash } from "node:crypto";
import { assertSafeReference, scanEvidenceOutput } from "./evidenceOutputScanner";
import { MANIFEST_HASH, MANIFEST_VERSION } from "./freshLaunchConfigurationManifest";
import { deterministicJson } from "./productionApprovalBundle";

export const G2B_AUTHORIZATION_VERSION = "g2b-auth-v1";
export const REQUIRED_G2B_AUTHORIZATION_ROLES = [
  "engineering_owner",
  "security_or_data_owner",
  "database_operator",
  "release_operator",
] as const;

export interface G2bInspectionAuthorization {
  schemaVersion: string;
  status: "AUTHORIZED" | "NOT_AUTHORIZED";
  approvedCommit: string;
  manifestVersion: string;
  manifestHash: string;
  approvalBundleHash: string;
  productionSourceEnvironmentIdentityHash: string;
  readOnlyDatabaseRoleEvidenceReference: string | null;
  evidenceOutputLocationReference: string | null;
  inspectionScope: "production_source_read_only_readiness";
  authorizedAt: string | null;
  expiresAt: string | null;
  approvals: Array<{
    role: typeof REQUIRED_G2B_AUTHORIZATION_ROLES[number];
    approvalReference: string;
    approvedAt: string;
  }>;
}

export class G2bAuthorizationError extends Error {
  constructor(public readonly code: string, detail?: string) {
    super(`[fresh-launch-g2a-closure:${code}]${detail ? ` ${detail}` : ""}`);
  }
}

function assertHash(value: unknown, code: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new G2bAuthorizationError(code);
}

function parseTime(value: unknown, code: string): number {
  if (typeof value !== "string") throw new G2bAuthorizationError(code);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new G2bAuthorizationError(code);
  return parsed;
}

export function validateG2bInspectionAuthorization(
  input: unknown,
  expected: {
    approvedCommit: string;
    approvalBundleHash: string;
    productionSourceEnvironmentIdentityHash: string;
    now?: Date;
  },
): G2bInspectionAuthorization {
  if (!input) throw new G2bAuthorizationError("G2B_AUTHORIZATION_MISSING");
  if (typeof input !== "object" || Array.isArray(input)) throw new G2bAuthorizationError("G2B_AUTHORIZATION_INVALID");
  const allowed = [
    "schemaVersion", "status", "approvedCommit", "manifestVersion", "manifestHash",
    "approvalBundleHash", "productionSourceEnvironmentIdentityHash",
    "readOnlyDatabaseRoleEvidenceReference", "evidenceOutputLocationReference",
    "inspectionScope", "authorizedAt", "expiresAt", "approvals",
  ];
  if (Object.keys(input).some((key) => !allowed.includes(key))) throw new G2bAuthorizationError("G2B_AUTHORIZATION_UNKNOWN_FIELD");
  const authorization = input as G2bInspectionAuthorization;
  if (authorization.schemaVersion !== G2B_AUTHORIZATION_VERSION) throw new G2bAuthorizationError("G2B_AUTHORIZATION_VERSION_UNSUPPORTED");
  if (authorization.status !== "AUTHORIZED") throw new G2bAuthorizationError("G2B_NOT_AUTHORIZED");
  if (authorization.approvedCommit !== expected.approvedCommit) throw new G2bAuthorizationError("G2B_APPROVED_COMMIT_MISMATCH");
  if (authorization.manifestVersion !== MANIFEST_VERSION) throw new G2bAuthorizationError("G2B_MANIFEST_VERSION_MISMATCH");
  if (authorization.manifestHash !== MANIFEST_HASH) throw new G2bAuthorizationError("G2B_MANIFEST_HASH_MISMATCH");
  if (authorization.approvalBundleHash !== expected.approvalBundleHash) throw new G2bAuthorizationError("G2B_APPROVAL_BUNDLE_HASH_MISMATCH");
  if (authorization.productionSourceEnvironmentIdentityHash !== expected.productionSourceEnvironmentIdentityHash) {
    throw new G2bAuthorizationError("G2B_ENVIRONMENT_IDENTITY_HASH_MISMATCH");
  }
  assertHash(authorization.approvalBundleHash, "G2B_APPROVAL_BUNDLE_HASH_INVALID");
  assertHash(authorization.productionSourceEnvironmentIdentityHash, "G2B_ENVIRONMENT_IDENTITY_HASH_INVALID");
  if (!authorization.readOnlyDatabaseRoleEvidenceReference) throw new G2bAuthorizationError("G2B_READ_ONLY_ROLE_EVIDENCE_MISSING");
  if (!authorization.evidenceOutputLocationReference) throw new G2bAuthorizationError("G2B_EVIDENCE_OUTPUT_LOCATION_MISSING");
  assertSafeReference(authorization.readOnlyDatabaseRoleEvidenceReference, "G2B_READ_ONLY_ROLE_EVIDENCE_INVALID");
  assertSafeReference(authorization.evidenceOutputLocationReference, "G2B_EVIDENCE_OUTPUT_LOCATION_INVALID");
  if (authorization.inspectionScope !== "production_source_read_only_readiness") throw new G2bAuthorizationError("G2B_INSPECTION_SCOPE_INVALID");
  const now = (expected.now ?? new Date()).getTime();
  const authorizedAt = parseTime(authorization.authorizedAt, "G2B_AUTHORIZATION_TIMESTAMP_MISSING");
  const expiresAt = parseTime(authorization.expiresAt, "G2B_AUTHORIZATION_EXPIRY_MISSING");
  if (authorizedAt > now || expiresAt <= now || authorizedAt >= expiresAt) throw new G2bAuthorizationError("G2B_AUTHORIZATION_EXPIRED");
  if (!Array.isArray(authorization.approvals)) throw new G2bAuthorizationError("G2B_REQUIRED_APPROVER_MISSING");
  const roles = new Set<string>();
  for (const approval of authorization.approvals) {
    if (!approval || typeof approval !== "object"
      || Object.keys(approval).some((key) => !["role", "approvalReference", "approvedAt"].includes(key))) {
      throw new G2bAuthorizationError("G2B_APPROVAL_INVALID");
    }
    if (!REQUIRED_G2B_AUTHORIZATION_ROLES.includes(approval.role)) throw new G2bAuthorizationError("G2B_APPROVER_ROLE_INVALID");
    if (roles.has(approval.role)) throw new G2bAuthorizationError("G2B_DUPLICATE_APPROVER_ROLE", approval.role);
    roles.add(approval.role);
    assertSafeReference(approval.approvalReference, "G2B_APPROVAL_REFERENCE_INVALID");
    parseTime(approval.approvedAt, "G2B_APPROVAL_TIMESTAMP_INVALID");
  }
  for (const role of REQUIRED_G2B_AUTHORIZATION_ROLES) {
    if (!roles.has(role)) throw new G2bAuthorizationError("G2B_REQUIRED_APPROVER_MISSING", role);
  }
  scanEvidenceOutput(authorization);
  return authorization;
}

export function g2bInspectionAuthorizationHash(authorization: G2bInspectionAuthorization): string {
  return createHash("sha256").update(deterministicJson(authorization)).digest("hex");
}
