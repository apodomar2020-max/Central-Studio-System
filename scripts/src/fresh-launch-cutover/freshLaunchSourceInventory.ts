import type { Pool } from "pg";
import { createPool, latestMigration, quoteIdent, withReadOnlyTransaction } from "./database";
import { validateCutoverEnvironment } from "./environmentGuard";
import { freshLaunchConfigurationManifest, MANIFEST_HASH, MANIFEST_VERSION, validateManifest } from "./freshLaunchConfigurationManifest";

export interface SourceInventory {
  manifestVersion: string;
  manifestHash: string;
  migration: string;
  counts: { transfer: Record<string, number>; exclude: Record<string, number>; decisionRequired: Record<string, number> };
  domains: { generalStudioTransfer: number; balletTransfer: number; balletTransactions: number };
  dependencies: Record<string, string[]>;
  sequenceStates: { sequenceCount: number; uninitializedCount: number };
  blockers: { configuration: number; integrity: number; excludedIdentityReferences: number };
  readiness: "ready" | "review_required";
}

export async function readFreshLaunchSourceInventory(pool: Pool): Promise<SourceInventory> {
  validateManifest();
  return withReadOnlyTransaction(pool, async (client) => {
    const counts = { transfer: {} as Record<string, number>, exclude: {} as Record<string, number>, decisionRequired: {} as Record<string, number> };
    for (const group of freshLaunchConfigurationManifest) {
      const result = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${quoteIdent(group.table)}`);
      const bucket = group.classification === "transfer" ? counts.transfer
        : group.classification === "exclude" ? counts.exclude : counts.decisionRequired;
      bucket[group.key] = Number(result.rows[0]?.count ?? 0);
    }
    const sum = (bucket: Record<string, number>, predicate: (key: string) => boolean) =>
      Object.entries(bucket).filter(([key]) => predicate(key)).reduce((total, [, count]) => total + count, 0);
    const blockerResult = await client.query<{
      configuration: string;
      integrity: string;
      excluded_identity_references: string;
    }>(`
      SELECT
        ((SELECT count(*) FROM classes WHERE is_active AND allow_all_ages IS NULL)
          + (SELECT count(*) FROM price_packages WHERE is_active AND allow_all_ages IS NULL))::text AS configuration,
        ((SELECT count(*) FROM price_package_dance_types ppdt
          LEFT JOIN price_packages pp ON pp.id=ppdt.package_id
          LEFT JOIN dance_types dt ON dt.id=ppdt.dance_type_id
          WHERE pp.id IS NULL OR dt.id IS NULL))::text AS integrity,
        ((SELECT count(*) FROM class_capacity_settings WHERE updated_by_admin_id IS NOT NULL)
          + (SELECT count(*) FROM class_reminder_settings WHERE updated_by_admin_id IS NOT NULL)
          + (SELECT count(*) FROM background_music_settings WHERE updated_by_admin_id IS NOT NULL)
          + (SELECT count(*) FROM app_content_pages WHERE updated_by IS NOT NULL))::text AS excluded_identity_references
    `);
    const sequenceResult = await client.query<{ count: string; uninitialized: string }>(
      `SELECT count(*)::text AS count,
        count(*) FILTER (WHERE last_value IS NULL)::text AS uninitialized
       FROM pg_sequences WHERE schemaname='public'`,
    );
    const blockers = {
      configuration: Number(blockerResult.rows[0]?.configuration ?? 0),
      integrity: Number(blockerResult.rows[0]?.integrity ?? 0),
      excludedIdentityReferences: Number(blockerResult.rows[0]?.excluded_identity_references ?? 0),
    };
    return {
      manifestVersion: MANIFEST_VERSION,
      manifestHash: MANIFEST_HASH,
      migration: await latestMigration(client),
      counts,
      domains: {
        generalStudioTransfer: sum(counts.transfer, (key) => freshLaunchConfigurationManifest.find((entry) => entry.key === key)?.scope === "general_studio"),
        balletTransfer: sum(counts.transfer, (key) => freshLaunchConfigurationManifest.find((entry) => entry.key === key)?.scope === "ballet"),
        balletTransactions: sum(counts.exclude, (key) => freshLaunchConfigurationManifest.find((entry) => entry.key === key)?.scope === "ballet"),
      },
      dependencies: Object.fromEntries(
        freshLaunchConfigurationManifest
          .filter((entry) => entry.classification === "transfer")
          .map((entry) => [entry.key, entry.dependencies]),
      ),
      sequenceStates: {
        sequenceCount: Number(sequenceResult.rows[0]?.count ?? 0),
        uninitializedCount: Number(sequenceResult.rows[0]?.uninitialized ?? 0),
      },
      blockers,
      readiness: Object.values(blockers).some((count) => count > 0) ? "review_required" : "ready",
    };
  });
}

async function main(): Promise<void> {
  const urls = validateCutoverEnvironment({
    rehearsalFlag: process.env.FRESH_LAUNCH_REHEARSAL,
    sourceUrl: process.env.FRESH_LAUNCH_SOURCE_DATABASE_URL,
    targetUrl: process.env.FRESH_LAUNCH_TARGET_DATABASE_URL,
  });
  const pool = createPool(urls.source.toString());
  try {
    process.stdout.write(`${JSON.stringify(await readFreshLaunchSourceInventory(pool), null, 2)}\n`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith("freshLaunchSourceInventory.ts")) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "inventory failed"}\n`);
    process.exitCode = 1;
  });
}
