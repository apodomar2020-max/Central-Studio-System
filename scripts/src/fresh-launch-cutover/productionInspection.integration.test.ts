import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { captureSourceFingerprint } from "./configurationVerification";
import { createPool } from "./database";
import { scanEvidenceOutput } from "./evidenceOutputScanner";
import {
  SYNTHETIC_APPROVED_COMMIT as commit,
  SYNTHETIC_APPROVAL_NOW as now,
  syntheticApprovalBundle,
  syntheticEnvironmentIdentity,
} from "./productionApprovalFixtures";
import { oneWayIdentityFingerprint } from "./productionEnvironmentIdentity";
import {
  executeInspectionQuery,
  PRODUCTION_INSPECTION_ACKNOWLEDGEMENT,
  runApprovedProductionReadinessInspection,
} from "./runApprovedProductionReadinessInspection";

const databaseUrl = process.env.G2A_DISPOSABLE_DATABASE_URL;
const enabled = Boolean(databaseUrl);

async function databaseIdentity() {
  const identity = syntheticEnvironmentIdentity();
  const parsed = new URL(databaseUrl!);
  const pool = createPool(databaseUrl!);
  try {
    identity.databaseServerFingerprintHash = oneWayIdentityFingerprint(parsed.hostname);
    identity.databaseNameFingerprintHash = oneWayIdentityFingerprint(decodeURIComponent(parsed.pathname.replace(/^\/+/, "")));
    identity.postgresqlVersion = (await pool.query<{ version: string }>("SELECT version() AS version")).rows[0]!.version;
    return identity;
  } finally {
    await pool.end();
  }
}

async function proveReadOnlyWriteRejected() {
  const pool = createPool(databaseUrl!);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET TRANSACTION READ ONLY");
    await client.query("SET LOCAL statement_timeout = '10s'");
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '30s'");
    assert.equal(
      (await client.query<{ read_only: string }>("SELECT current_setting('transaction_read_only') AS read_only")).rows[0]?.read_only,
      "on",
    );
    await assert.rejects(
      client.query("INSERT INTO dance_types (name, slug, is_active) VALUES ('Rejected Proof', 'rejected-read-only-proof', false)"),
      (error) => typeof error === "object" && error !== null && "code" in error && error.code === "25006",
    );
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.end();
  }
}

test("real PostgreSQL read-only transaction rejects writes, rolls back, and preserves fingerprint", { skip: !enabled }, async () => {
  const pool = createPool(databaseUrl!);
  try {
    const before = await captureSourceFingerprint(pool);
    await proveReadOnlyWriteRejected();
    assert.equal(await captureSourceFingerprint(pool), before);
  } finally {
    await pool.end();
  }
});

test("approved inspection is allowlisted, deterministic, PII-free, and source-immutable", { skip: !enabled }, async () => {
  const firstDirectory = await mkdtemp(join(tmpdir(), "central-g2a-evidence-a-"));
  const secondDirectory = await mkdtemp(join(tmpdir(), "central-g2a-evidence-b-"));
  const pool = createPool(databaseUrl!);
  const before = await captureSourceFingerprint(pool);
  await pool.end();
  try {
    const common = {
      mode: "g2a_local_test" as const,
      databaseUrl: databaseUrl!,
      approvalBundle: syntheticApprovalBundle(),
      environmentIdentity: await databaseIdentity(),
      expectedCommit: commit,
      acknowledgement: PRODUCTION_INSPECTION_ACKNOWLEDGEMENT,
      sourceRoleDeclaration: "source" as const,
      now,
      env: {},
    };
    const first = await runApprovedProductionReadinessInspection({ ...common, evidenceOutputDirectory: firstDirectory });
    const second = await runApprovedProductionReadinessInspection({ ...common, evidenceOutputDirectory: secondDirectory });
    assert.deepEqual(first.evidence, second.evidence);
    assert.equal(await readFile(first.evidencePath, "utf8"), await readFile(second.evidencePath, "utf8"));
    scanEvidenceOutput(first.evidence);
    const afterPool = createPool(databaseUrl!);
    assert.equal(await captureSourceFingerprint(afterPool), before);
    await afterPool.end();
  } finally {
    await rm(firstDirectory, { recursive: true, force: true });
    await rm(secondDirectory, { recursive: true, force: true });
  }
});

test("approval validation occurs before connection and unknown query keys are rejected", { skip: !enabled }, async () => {
  const output = await mkdtemp(join(tmpdir(), "central-g2a-evidence-c-"));
  try {
    await assert.rejects(
      runApprovedProductionReadinessInspection({
        mode: "g2a_local_test",
        databaseUrl: "postgresql://127.0.0.1:1/central_g2a_disposable",
        approvalBundle: undefined,
        environmentIdentity: syntheticEnvironmentIdentity(),
        expectedCommit: commit,
        acknowledgement: PRODUCTION_INSPECTION_ACKNOWLEDGEMENT,
        sourceRoleDeclaration: "source",
        evidenceOutputDirectory: output,
        now,
        env: {},
      }),
      (error) => typeof error === "object" && error !== null && "code" in error && error.code === "APPROVAL_BUNDLE_MISSING",
    );
    await assert.rejects(
      runApprovedProductionReadinessInspection({
        mode: "g2a_local_test",
        databaseUrl: databaseUrl!,
        approvalBundle: syntheticApprovalBundle(),
        environmentIdentity: await databaseIdentity(),
        expectedCommit: commit,
        acknowledgement: PRODUCTION_INSPECTION_ACKNOWLEDGEMENT,
        sourceRoleDeclaration: "source",
        evidenceOutputDirectory: output,
        queryKeys: ["arbitrary_sql" as never],
        now,
        env: {},
      }),
      (error) => typeof error === "object" && error !== null && "code" in error && error.code === "INSPECTION_QUERY_NOT_ALLOWLISTED",
    );
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test("query executor has no arbitrary SQL path", async () => {
  await assert.rejects(
    executeInspectionQuery({} as never, "SELECT * FROM students" as never),
    (error) => typeof error === "object" && error !== null && "code" in error && error.code === "INSPECTION_QUERY_NOT_ALLOWLISTED",
  );
});
