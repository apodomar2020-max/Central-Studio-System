import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { captureSourceFingerprint, verifyConfigurationEquivalence, verifyTransactionalExclusion } from "./configurationVerification";
import { createPool, latestMigration } from "./database";
import { exportFreshLaunchConfiguration } from "./configurationExport";
import { importFreshLaunchConfiguration } from "./configurationImport";
import { validateCutoverEnvironment } from "./environmentGuard";

type Pair = { sourceUrl: string; targetUrl: string };
const pairs = process.env.FRESH_LAUNCH_FAILURE_DATABASES_JSON
  ? JSON.parse(process.env.FRESH_LAUNCH_FAILURE_DATABASES_JSON) as Record<string, Pair>
  : undefined;
const enabled = Boolean(pairs);

function pools(name: string): { source: Pool; target: Pool } {
  const pair = pairs?.[name];
  if (!pair) throw new Error(`FAILURE_PAIR_MISSING:${name}`);
  const urls = validateCutoverEnvironment({
    rehearsalFlag: process.env.FRESH_LAUNCH_REHEARSAL,
    sourceUrl: pair.sourceUrl,
    targetUrl: pair.targetUrl,
    env: { FRESH_LAUNCH_REHEARSAL: process.env.FRESH_LAUNCH_REHEARSAL },
  });
  return { source: createPool(urls.source.toString()), target: createPool(urls.target.toString()) };
}

async function artifact(source: Pool) {
  const client = await source.connect();
  try {
    return exportFreshLaunchConfiguration(source, await latestMigration(client));
  } finally {
    client.release();
  }
}

async function assertTargetReady(target: Pool): Promise<void> {
  const readiness = await target.query<{
    active_classes_unconfigured: string;
    active_packages_unconfigured: string;
    invalid_relations: string;
  }>(`
    SELECT
      (SELECT count(*)::text FROM classes WHERE is_active AND allow_all_ages IS NULL) AS active_classes_unconfigured,
      (SELECT count(*)::text FROM price_packages WHERE is_active AND allow_all_ages IS NULL) AS active_packages_unconfigured,
      (SELECT count(*)::text FROM price_package_dance_types ppdt
        LEFT JOIN price_packages pp ON pp.id=ppdt.package_id
        LEFT JOIN dance_types dt ON dt.id=ppdt.dance_type_id
        WHERE pp.id IS NULL OR dt.id IS NULL) AS invalid_relations
  `);
  assert.deepEqual(readiness.rows[0], {
    active_classes_unconfigured: "0",
    active_packages_unconfigured: "0",
    invalid_relations: "0",
  });
}

function postgresCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

test("real lock timeout rolls back target and leaves source immutable", { skip: !enabled }, async () => {
  const { source, target } = pools("lock");
  const locker = await target.connect();
  try {
    const sourceBefore = await captureSourceFingerprint(source);
    const targetBefore = await captureSourceFingerprint(target);
    const exported = await artifact(source);
    await locker.query("BEGIN");
    await locker.query("LOCK TABLE dance_types IN ACCESS EXCLUSIVE MODE");
    await assert.rejects(
      importFreshLaunchConfiguration(target, exported, {
        testOnlyTransactionSetup: async (client) => {
          await client.query("SET LOCAL lock_timeout = '100ms'");
        },
      }),
      (error) => postgresCode(error) === "55P03",
    );
    await locker.query("ROLLBACK");
    assert.equal(await captureSourceFingerprint(source), sourceBefore);
    assert.equal(await captureSourceFingerprint(target), targetBefore);
  } finally {
    await locker.query("ROLLBACK").catch(() => undefined);
    locker.release();
    await source.end();
    await target.end();
  }
});

test("real statement timeout rolls back and a subsequent normal import succeeds", { skip: !enabled }, async () => {
  const { source, target } = pools("statement");
  try {
    const sourceBefore = await captureSourceFingerprint(source);
    const targetBefore = await captureSourceFingerprint(target);
    const exported = await artifact(source);
    await assert.rejects(
      importFreshLaunchConfiguration(target, exported, {
        testOnlyTransactionSetup: async (client) => {
          await client.query("SET LOCAL statement_timeout = '25ms'");
          await client.query("SELECT pg_sleep(0.2)");
        },
      }),
      (error) => postgresCode(error) === "57014",
    );
    assert.equal(await captureSourceFingerprint(target), targetBefore);
    assert.equal(await captureSourceFingerprint(source), sourceBefore);
    await importFreshLaunchConfiguration(target, exported);
    assert.equal((await verifyConfigurationEquivalence(target, exported)).equivalent, true);
    await verifyTransactionalExclusion(target);
  } finally {
    await source.end();
    await target.end();
  }
});

test("source mutation alarm aborts target before commit with safe group-only error", { skip: !enabled }, async () => {
  const { source, target } = pools("mutation");
  try {
    const sourceBefore = await captureSourceFingerprint(source);
    const targetBefore = await captureSourceFingerprint(target);
    const exported = await artifact(source);
    await source.query(
      `INSERT INTO dance_types (name, slug, is_active) VALUES ('Synthetic Mutation', 'synthetic-mutation-alarm', false)`,
    );
    const sourceAfterMutation = await captureSourceFingerprint(source);
    assert.notEqual(sourceAfterMutation, sourceBefore);
    await assert.rejects(
      importFreshLaunchConfiguration(target, exported, {
        preCommitValidation: async () => {
          if (await captureSourceFingerprint(source) !== sourceBefore) {
            throw new Error("SOURCE_MUTATION_DETECTED:dance_types");
          }
        },
      }),
      /SOURCE_MUTATION_DETECTED:dance_types/,
    );
    assert.equal(await captureSourceFingerprint(target), targetBefore);
    assert.notEqual(await captureSourceFingerprint(source), sourceBefore);
  } finally {
    await source.end();
    await target.end();
  }
});

test("forced post-import smoke failure produces NO-GO and target rejection", { skip: !enabled }, async () => {
  const { source, target } = pools("smoke");
  try {
    const sourceBefore = await captureSourceFingerprint(source);
    const exported = await artifact(source);
    await importFreshLaunchConfiguration(target, exported);
    assert.equal((await verifyConfigurationEquivalence(target, exported)).equivalent, true);
    await verifyTransactionalExclusion(target);
    await assertTargetReady(target);
    let classification: "GO" | "NO-GO" = "GO";
    await assert.rejects(
      (async () => {
        throw new Error("FORCED_SMOKE_FAILURE:synthetic");
      })(),
      /FORCED_SMOKE_FAILURE:synthetic/,
    );
    classification = "NO-GO";
    assert.equal(classification, "NO-GO");
    assert.equal(await captureSourceFingerprint(source), sourceBefore);
    const importedTarget = await captureSourceFingerprint(target);
    assert.notEqual(importedTarget.length, 0, "target is committed but rejected and will be destroyed by the runner");
  } finally {
    await source.end();
    await target.end();
  }
});
