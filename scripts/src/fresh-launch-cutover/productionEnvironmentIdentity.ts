import { createHash } from "node:crypto";
import { deterministicJson } from "./productionApprovalBundle";
import { scanEvidenceOutput } from "./evidenceOutputScanner";

export const ENVIRONMENT_IDENTITY_VERSION = "g2a-v1";

export interface ProductionEnvironmentIdentity {
  schemaVersion: string;
  environmentRole: "production";
  serviceRole: "database" | "api" | "worker";
  databaseRole: "source" | "target";
  providerClassification: "managed_postgresql" | "self_managed_postgresql";
  regionClassification: "regional" | "multi_region";
  databaseServerFingerprintHash: string;
  databaseNameFingerprintHash: string;
  postgresqlVersion: string;
  migrationCount: number;
  latestMigration: string;
  readWriteRoleClassification: "read_only" | "writer";
  applicationCommit: string;
  apiCommit: string;
  workerCommit: string;
  inspectedAt: string;
  expiresAt: string;
}

export class EnvironmentIdentityError extends Error {
  constructor(public readonly code: string) {
    super(`[fresh-launch-g2a:${code}]`);
  }
}

export function oneWayIdentityFingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function validateProductionEnvironmentIdentity(
  input: unknown,
  options: { expectedCommit: string; now?: Date; requiredDatabaseRole?: "source" | "target"; requireReadOnly?: boolean },
): ProductionEnvironmentIdentity {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new EnvironmentIdentityError("ENVIRONMENT_IDENTITY_MISSING");
  const identity = input as ProductionEnvironmentIdentity;
  const expectedKeys = [
    "schemaVersion", "environmentRole", "serviceRole", "databaseRole", "providerClassification",
    "regionClassification", "databaseServerFingerprintHash", "databaseNameFingerprintHash",
    "postgresqlVersion", "migrationCount", "latestMigration", "readWriteRoleClassification",
    "applicationCommit", "apiCommit", "workerCommit", "inspectedAt", "expiresAt",
  ];
  if (Object.keys(identity).some((key) => !expectedKeys.includes(key))) throw new EnvironmentIdentityError("ENVIRONMENT_IDENTITY_UNKNOWN_FIELD");
  if (identity.schemaVersion !== ENVIRONMENT_IDENTITY_VERSION) throw new EnvironmentIdentityError("ENVIRONMENT_IDENTITY_VERSION_UNSUPPORTED");
  if (identity.environmentRole !== "production" || identity.serviceRole !== "database") throw new EnvironmentIdentityError("ENVIRONMENT_ROLE_INVALID");
  if (!["source", "target"].includes(identity.databaseRole)) throw new EnvironmentIdentityError("DATABASE_ROLE_INVALID");
  if (!["managed_postgresql", "self_managed_postgresql"].includes(identity.providerClassification)) {
    throw new EnvironmentIdentityError("PROVIDER_CLASSIFICATION_INVALID");
  }
  if (!["regional", "multi_region"].includes(identity.regionClassification)) throw new EnvironmentIdentityError("REGION_CLASSIFICATION_INVALID");
  if (options.requiredDatabaseRole && identity.databaseRole !== options.requiredDatabaseRole) throw new EnvironmentIdentityError("DATABASE_ROLE_MISMATCH");
  if (options.requireReadOnly && identity.readWriteRoleClassification !== "read_only") throw new EnvironmentIdentityError("DATABASE_ROLE_NOT_READ_ONLY");
  if (!["read_only", "writer"].includes(identity.readWriteRoleClassification)) throw new EnvironmentIdentityError("DATABASE_ACCESS_CLASSIFICATION_INVALID");
  if (![identity.applicationCommit, identity.apiCommit, identity.workerCommit].every((commit) => commit === options.expectedCommit)) {
    throw new EnvironmentIdentityError("DEPLOYED_COMMIT_MISMATCH");
  }
  if (!/^[a-f0-9]{64}$/.test(identity.databaseServerFingerprintHash)
    || !/^[a-f0-9]{64}$/.test(identity.databaseNameFingerprintHash)) {
    throw new EnvironmentIdentityError("ENVIRONMENT_FINGERPRINT_INVALID");
  }
  if (!Number.isInteger(identity.migrationCount) || identity.migrationCount < 1) throw new EnvironmentIdentityError("MIGRATION_COUNT_INVALID");
  if (typeof identity.postgresqlVersion !== "string" || !identity.postgresqlVersion.startsWith("PostgreSQL ")) {
    throw new EnvironmentIdentityError("POSTGRESQL_VERSION_INVALID");
  }
  if (typeof identity.latestMigration !== "string" || !/^0091(?:_|$)/.test(identity.latestMigration)) {
    throw new EnvironmentIdentityError("LATEST_MIGRATION_INVALID");
  }
  const now = (options.now ?? new Date()).getTime();
  const inspectedAt = Date.parse(identity.inspectedAt);
  const expiresAt = Date.parse(identity.expiresAt);
  if (!Number.isFinite(inspectedAt) || !Number.isFinite(expiresAt) || inspectedAt > now || expiresAt <= now || inspectedAt >= expiresAt) {
    throw new EnvironmentIdentityError("ENVIRONMENT_EVIDENCE_EXPIRED");
  }
  scanEvidenceOutput(identity);
  return identity;
}

export function productionEnvironmentIdentityHash(identity: ProductionEnvironmentIdentity): string {
  return createHash("sha256").update(deterministicJson(identity)).digest("hex");
}
