import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { PoolClient } from "pg";
import { captureSourceFingerprint } from "./configurationVerification";
import { createPool, latestMigration, quoteIdent } from "./database";
import { scanEvidenceOutput } from "./evidenceOutputScanner";
import { freshLaunchConfigurationManifest, MANIFEST_HASH, MANIFEST_VERSION } from "./freshLaunchConfigurationManifest";
import {
  approvalBundleHash,
  deterministicJson,
  type ApprovalBundle,
  validateApprovalBundle,
} from "./productionApprovalBundle";
import {
  oneWayIdentityFingerprint,
  productionEnvironmentIdentityHash,
  type ProductionEnvironmentIdentity,
  validateProductionEnvironmentIdentity,
} from "./productionEnvironmentIdentity";
import {
  INSPECTION_TOOL_VERSION,
  type ProductionInspectionEvidence,
  validateInspectionEvidence,
} from "./productionInspectionEvidence";

export const PRODUCTION_INSPECTION_ACKNOWLEDGEMENT =
  "I_ACKNOWLEDGE_READ_ONLY_PRODUCTION_INSPECTION_REQUIRES_SEPARATE_G2B_AUTHORIZATION";

export const INSPECTION_QUERY_KEYS = [
  "migration_state",
  "configuration_inventory",
  "transaction_inventory",
  "decision_inventory",
  "readiness",
  "finance_aggregates",
  "ballet_aggregates",
  "sequence_inventory",
  "schema_integrity",
] as const;
export type InspectionQueryKey = typeof INSPECTION_QUERY_KEYS[number];

export class ProductionInspectionError extends Error {
  constructor(public readonly code: string) {
    super(`[fresh-launch-g2a:${code}]`);
  }
}

export function validateApprovedInspectionTransport(
  raw: string,
  mode: "g2a_local_test" | "g2b_approved_read_only",
  env: NodeJS.ProcessEnv = process.env,
): URL {
  if (Object.keys(env).some((key) => key.startsWith("RAILWAY_") && Boolean(env[key]))) {
    throw new ProductionInspectionError("REMOTE_ENVIRONMENT_MARKER");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ProductionInspectionError("INSPECTION_DATABASE_URL_MALFORMED");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new ProductionInspectionError("INSPECTION_DATABASE_PROTOCOL_INVALID");
  const forbiddenParameters = ["host", "hostaddr", "service", "passfile", "sslkey", "sslcert", "sslpassword"];
  if (forbiddenParameters.some((name) => url.searchParams.has(name))) {
    throw new ProductionInspectionError("G2A_CONNECTION_OVERRIDE_FORBIDDEN");
  }
  const host = url.hostname.toLowerCase();
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  const database = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  if (mode === "g2a_local_test" && !local) throw new ProductionInspectionError("G2A_REMOTE_CONNECTION_FORBIDDEN");
  if (mode === "g2a_local_test"
    && (!/disposable|test|local/i.test(database) || /prod|production|stage|staging|preview|railway|rlwy/i.test(database))) {
    throw new ProductionInspectionError("G2A_DISPOSABLE_DATABASE_REQUIRED");
  }
  return url;
}

export function validateG2aLocalInspectionTransport(raw: string, env: NodeJS.ProcessEnv = process.env): URL {
  return validateApprovedInspectionTransport(raw, "g2a_local_test", env);
}

function checksum(value: unknown): string {
  return createHash("sha256").update(deterministicJson(value)).digest("hex");
}

async function groupedCounts(client: PoolClient, classification: "transfer" | "exclude" | "decision_required") {
  const counts: Record<string, number> = {};
  for (const group of freshLaunchConfigurationManifest.filter((item) => item.classification === classification)) {
    const result = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${quoteIdent(group.table)}`);
    counts[group.key] = Number(result.rows[0]?.count ?? 0);
  }
  return counts;
}

export async function executeInspectionQuery(client: PoolClient, key: InspectionQueryKey): Promise<unknown> {
  if (!INSPECTION_QUERY_KEYS.includes(key)) throw new ProductionInspectionError("INSPECTION_QUERY_NOT_ALLOWLISTED");
  switch (key) {
    case "migration_state":
      return {
        postgresqlVersion: (await client.query<{ version: string }>("SELECT version() AS version")).rows[0]?.version ?? "unknown",
        latestMigration: await latestMigration(client),
      };
    case "configuration_inventory":
      return groupedCounts(client, "transfer");
    case "transaction_inventory":
      return groupedCounts(client, "exclude");
    case "decision_inventory":
      return groupedCounts(client, "decision_required");
    case "readiness": {
      const result = await client.query<{
        configuration_blockers: string;
        integrity_blockers: string;
        excluded_identity_references: string;
      }>(`
        SELECT
          ((SELECT count(*) FROM classes WHERE is_active AND allow_all_ages IS NULL)
            + (SELECT count(*) FROM price_packages WHERE is_active AND allow_all_ages IS NULL))::text AS configuration_blockers,
          (SELECT count(*)::text FROM price_package_dance_types ppdt
            LEFT JOIN price_packages pp ON pp.id=ppdt.package_id
            LEFT JOIN dance_types dt ON dt.id=ppdt.dance_type_id
            WHERE pp.id IS NULL OR dt.id IS NULL) AS integrity_blockers,
          ((SELECT count(*) FROM class_capacity_settings WHERE updated_by_admin_id IS NOT NULL)
            + (SELECT count(*) FROM class_reminder_settings WHERE updated_by_admin_id IS NOT NULL)
            + (SELECT count(*) FROM background_music_settings WHERE updated_by_admin_id IS NOT NULL)
            + (SELECT count(*) FROM app_content_pages WHERE updated_by IS NOT NULL))::text AS excluded_identity_references
      `);
      return Object.fromEntries(Object.entries(result.rows[0] ?? {}).map(([name, value]) => [name, Number(value)]));
    }
    case "finance_aggregates": {
      const result = await client.query<{
        records: string;
        gross_minor: string;
        paid_minor: string;
        refunded_minor: string;
        refund_rows: string;
        event_rows: string;
      }>(`
        SELECT
          (SELECT count(*)::text FROM payment_records) AS records,
          (SELECT coalesce(sum(gross_amount_minor), 0)::text FROM payment_records) AS gross_minor,
          (SELECT coalesce(sum(paid_amount_minor), 0)::text FROM payment_records) AS paid_minor,
          (SELECT coalesce(sum(refunded_amount_minor), 0)::text FROM payment_records) AS refunded_minor,
          (SELECT count(*)::text FROM payment_refunds) AS refund_rows,
          (SELECT count(*)::text FROM payment_events) AS event_rows
      `);
      return result.rows[0];
    }
    case "ballet_aggregates": {
      const result = await client.query<{
        packages: string;
        payments: string;
        refunds: string;
        applications: string;
      }>(`
        SELECT
          (SELECT count(*)::text FROM ballet_packages) AS packages,
          (SELECT count(*)::text FROM ballet_payments) AS payments,
          (SELECT count(*)::text FROM ballet_refunds) AS refunds,
          (SELECT count(*)::text FROM ballet_applications) AS applications
      `);
      return result.rows[0];
    }
    case "sequence_inventory": {
      const result = await client.query<{ sequence_count: string; state_checksum: string }>(`
        SELECT count(*)::text AS sequence_count,
          md5(coalesce(string_agg(sequencename || ':' || coalesce(last_value::text, 'null'), ',' ORDER BY sequencename), '')) AS state_checksum
        FROM pg_sequences WHERE schemaname='public'
      `);
      return result.rows[0];
    }
    case "schema_integrity": {
      const result = await client.query<{ foreign_keys: string; views: string }>(`
        SELECT
          (SELECT count(*)::text FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace) AS foreign_keys,
          (SELECT count(*)::text FROM pg_views WHERE schemaname='public') AS views
      `);
      return result.rows[0];
    }
  }
}

export async function runApprovedProductionReadinessInspection(input: {
  mode: "g2a_local_test" | "g2b_approved_read_only";
  databaseUrl: string;
  approvalBundle: unknown;
  environmentIdentity: unknown;
  expectedCommit: string;
  acknowledgement: string;
  sourceRoleDeclaration: "source";
  evidenceOutputDirectory: string;
  queryKeys?: readonly InspectionQueryKey[];
  now?: Date;
  env?: NodeJS.ProcessEnv;
}): Promise<{ evidence: ProductionInspectionEvidence; evidencePath: string }> {
  if (!["g2a_local_test", "g2b_approved_read_only"].includes(input.mode)) {
    throw new ProductionInspectionError("READ_ONLY_INSPECTION_MODE_REQUIRED");
  }
  if (input.acknowledgement !== PRODUCTION_INSPECTION_ACKNOWLEDGEMENT) throw new ProductionInspectionError("PRODUCTION_INSPECTION_ACKNOWLEDGEMENT_REQUIRED");
  if (input.sourceRoleDeclaration !== "source") throw new ProductionInspectionError("SOURCE_ROLE_DECLARATION_REQUIRED");
  const outputDirectory = resolve(input.evidenceOutputDirectory);
  const systemTemporaryDirectory = `${resolve(tmpdir())}/`;
  if (input.mode === "g2a_local_test"
    && !`${outputDirectory}/`.startsWith(systemTemporaryDirectory)
    && !outputDirectory.startsWith("/tmp/")
    && !outputDirectory.startsWith("/private/tmp/")) {
    throw new ProductionInspectionError("G2A_TEMP_EVIDENCE_DIRECTORY_REQUIRED");
  }
  if (!input.evidenceOutputDirectory.startsWith("/")) throw new ProductionInspectionError("ABSOLUTE_EVIDENCE_DIRECTORY_REQUIRED");
  const now = input.now ?? new Date();
  const bundle = validateApprovalBundle(input.approvalBundle, { expectedCommit: input.expectedCommit, now });
  const identity = validateProductionEnvironmentIdentity(input.environmentIdentity, {
    expectedCommit: input.expectedCommit,
    now,
    requiredDatabaseRole: "source",
    requireReadOnly: true,
  });
  const url = validateApprovedInspectionTransport(input.databaseUrl, input.mode, input.env ?? {});
  if (identity.databaseServerFingerprintHash !== oneWayIdentityFingerprint(url.hostname)
    || identity.databaseNameFingerprintHash !== oneWayIdentityFingerprint(decodeURIComponent(url.pathname.replace(/^\/+/, "")))) {
    throw new ProductionInspectionError("ENVIRONMENT_FINGERPRINT_MISMATCH");
  }
  const queryKeys = input.queryKeys ?? INSPECTION_QUERY_KEYS;
  for (const key of queryKeys) {
    if (!INSPECTION_QUERY_KEYS.includes(key)) throw new ProductionInspectionError("INSPECTION_QUERY_NOT_ALLOWLISTED");
  }
  const pool = createPool(url.toString());
  const startedAt = now.toISOString();
  try {
    const before = await captureSourceFingerprint(pool);
    const client = await pool.connect();
    let results: Record<string, unknown> = {};
    try {
      await client.query("BEGIN");
      await client.query("SET TRANSACTION READ ONLY");
      await client.query("SET LOCAL statement_timeout = '60s'");
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '120s'");
      const readOnly = await client.query<{ read_only: string }>("SELECT current_setting('transaction_read_only') AS read_only");
      if (readOnly.rows[0]?.read_only !== "on") throw new ProductionInspectionError("DATABASE_READ_ONLY_NOT_ENFORCED");
      for (const key of queryKeys) results[key] = await executeInspectionQuery(client, key);
      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    const after = await captureSourceFingerprint(pool);
    if (before !== after) throw new ProductionInspectionError("SOURCE_FINGERPRINT_CHANGED");
    const migration = results.migration_state as { postgresqlVersion?: string; latestMigration?: string } | undefined;
    if (migration?.postgresqlVersion !== identity.postgresqlVersion
      || migration?.latestMigration !== identity.latestMigration
      || identity.migrationCount !== 91) {
      throw new ProductionInspectionError("ENVIRONMENT_DATABASE_STATE_MISMATCH");
    }
    const readiness = results.readiness as Record<string, number> | undefined;
    const transactions = results.transaction_inventory as Record<string, number> | undefined;
    const evidence: ProductionInspectionEvidence = {
      toolVersion: INSPECTION_TOOL_VERSION,
      approvedCommit: input.expectedCommit,
      manifestVersion: MANIFEST_VERSION,
      manifestHash: MANIFEST_HASH,
      approvalBundleHash: approvalBundleHash(bundle),
      environmentIdentityHash: productionEnvironmentIdentityHash(identity),
      inspectionStartedAt: startedAt,
      inspectionEndedAt: startedAt,
      postgresqlVersion: migration?.postgresqlVersion ?? identity.postgresqlVersion,
      migrationCount: identity.migrationCount,
      latestMigration: migration?.latestMigration ?? identity.latestMigration,
      readinessStatus: (readiness?.configuration_blockers ?? 0) + (readiness?.integrity_blockers ?? 0) === 0 ? "ready" : "review_required",
      configurationBlockers: readiness?.configuration_blockers ?? 0,
      integrityBlockers: readiness?.integrity_blockers ?? 0,
      resetInventoryCounts: transactions ?? {},
      financeAggregateChecksum: checksum(results.finance_aggregates ?? {}),
      balletAggregateChecksum: checksum(results.ballet_aggregates ?? {}),
      sourceFingerprint: before,
      outputScannerResult: "passed",
      readOnlyProofResult: "passed",
      finalInspectionResult: (readiness?.configuration_blockers ?? 0) + (readiness?.integrity_blockers ?? 0) === 0
        ? "PRODUCTION_SOURCE_INSPECTION_READY"
        : "PRODUCTION_SOURCE_INSPECTION_READY_WITH_DECISIONS",
    };
    scanEvidenceOutput(evidence);
    validateInspectionEvidence(evidence);
    await mkdir(input.evidenceOutputDirectory, { recursive: true, mode: 0o700 });
    const evidencePath = resolve(input.evidenceOutputDirectory, "production-inspection-evidence.json");
    await writeFile(evidencePath, `${deterministicJson(evidence)}\n`, { encoding: "utf8", mode: 0o600 });
    return { evidence, evidencePath };
  } finally {
    await pool.end();
  }
}
