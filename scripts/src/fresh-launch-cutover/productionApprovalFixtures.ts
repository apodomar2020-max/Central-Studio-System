import { MANIFEST_HASH, MANIFEST_VERSION } from "./freshLaunchConfigurationManifest";
import {
  APPROVAL_BUNDLE_VERSION,
  type ApprovalBundle,
  REQUIRED_APPROVAL_ROLES,
  REQUIRED_DECISION_IDS,
} from "./productionApprovalBundle";
import {
  ENVIRONMENT_IDENTITY_VERSION,
  oneWayIdentityFingerprint,
  type ProductionEnvironmentIdentity,
} from "./productionEnvironmentIdentity";

export const SYNTHETIC_APPROVED_COMMIT = "07b9369421dba5087eb8c4b4dbd57b21c76dceb0";
export const SYNTHETIC_APPROVAL_NOW = new Date("2030-01-01T00:00:00.000Z");

function policy(reference: string) {
  return { status: "approved" as const, approvalReference: reference };
}

export function syntheticApprovalBundle(): ApprovalBundle {
  return {
    schemaVersion: APPROVAL_BUNDLE_VERSION,
    approvedCommit: SYNTHETIC_APPROVED_COMMIT,
    manifestVersion: MANIFEST_VERSION,
    manifestHash: MANIFEST_HASH,
    sourceEnvironmentClassification: "production_source",
    targetEnvironmentClassification: "fresh_production_target",
    maintenanceWindowReference: "CHANGE-WINDOW-REF",
    backupEvidenceReference: "BACKUP-EVIDENCE-REF",
    restoreEvidenceReference: "RESTORE-EVIDENCE-REF",
    approvals: REQUIRED_APPROVAL_ROLES.map((role) => ({
      role,
      approvalReference: `APPROVAL-${role.toUpperCase()}`,
      approvedAt: "2029-12-20T00:00:00.000Z",
      expiresAt: "2030-02-01T00:00:00.000Z",
    })),
    decisions: REQUIRED_DECISION_IDS.map((id) => ({
      id,
      status: "approved",
      approvalReference: `DECISION-${id}`,
      approvedAt: "2029-12-20T00:00:00.000Z",
    })),
    policies: {
      identity: policy("POLICY-IDENTITY"),
      archive: policy("POLICY-ARCHIVE"),
      sequence: policy("POLICY-SEQUENCE"),
      media: policy("POLICY-MEDIA"),
      auditLogs: policy("POLICY-AUDIT"),
      balletContactSettings: policy("POLICY-BALLET-CONTACT"),
      notificationConfiguration: policy("POLICY-NOTIFICATION"),
      financeBackfillReportHistory: policy("POLICY-FINANCE-HISTORY"),
      preWriteRollback: policy("POLICY-PRE-WRITE"),
      postWriteIncident: policy("POLICY-POST-WRITE"),
    },
    issuedAt: "2029-12-20T00:00:00.000Z",
    expiresAt: "2030-02-01T00:00:00.000Z",
    finalStatus: "GO",
  };
}

export function syntheticEnvironmentIdentity(): ProductionEnvironmentIdentity {
  return {
    schemaVersion: ENVIRONMENT_IDENTITY_VERSION,
    environmentRole: "production",
    serviceRole: "database",
    databaseRole: "source",
    providerClassification: "managed_postgresql",
    regionClassification: "regional",
    databaseServerFingerprintHash: oneWayIdentityFingerprint("synthetic-server"),
    databaseNameFingerprintHash: oneWayIdentityFingerprint("synthetic-database"),
    postgresqlVersion: "PostgreSQL synthetic",
    migrationCount: 91,
    latestMigration: "0091_participant_aware_attendance",
    readWriteRoleClassification: "read_only",
    applicationCommit: SYNTHETIC_APPROVED_COMMIT,
    apiCommit: SYNTHETIC_APPROVED_COMMIT,
    workerCommit: SYNTHETIC_APPROVED_COMMIT,
    inspectedAt: "2029-12-20T00:00:00.000Z",
    expiresAt: "2030-02-01T00:00:00.000Z",
  };
}
