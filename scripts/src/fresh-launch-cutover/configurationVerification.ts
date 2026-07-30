import type { Pool } from "pg";
import { deterministicHash, exportFreshLaunchConfiguration } from "./configurationExport";
import { freshLaunchConfigurationManifest } from "./freshLaunchConfigurationManifest";
import { latestMigration, quoteIdent, withReadOnlyTransaction } from "./database";
import type { FreshLaunchExport } from "./types";

export async function verifyConfigurationEquivalence(
  target: Pool,
  sourceArtifact: FreshLaunchExport,
): Promise<{ equivalent: boolean; sourceHash: string; targetHash: string; differences: string[] }> {
  const targetArtifact = await exportFreshLaunchConfiguration(target, sourceArtifact.sourceMigration);
  const sourceCanonical = sourceArtifact.groups.map(({ key, table, columns, rows }) => ({ key, table, columns, rows }));
  const targetCanonical = targetArtifact.groups.map(({ key, table, columns, rows }) => ({ key, table, columns, rows }));
  const sourceHash = deterministicHash(sourceCanonical);
  const targetHash = deterministicHash(targetCanonical);
  const differences = sourceArtifact.groups
    .filter((source) => targetArtifact.groups.find((targetGroup) => targetGroup.key === source.key)?.hash !== source.hash)
    .map((group) => group.key);
  return { equivalent: sourceHash === targetHash && differences.length === 0, sourceHash, targetHash, differences };
}

export async function verifyTransactionalExclusion(pool: Pool): Promise<Record<string, number>> {
  return withReadOnlyTransaction(pool, async (client) => {
    const counts: Record<string, number> = {};
    for (const group of freshLaunchConfigurationManifest.filter((entry) => entry.classification === "exclude")) {
      const result = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${quoteIdent(group.table)}`);
      counts[group.table] = Number(result.rows[0]?.count ?? 0);
      if (counts[group.table] !== 0) throw new Error(`TRANSACTION_TRANSFER_DETECTED:${group.table}`);
    }
    return counts;
  });
}

export async function captureSourceFingerprint(pool: Pool): Promise<string> {
  return withReadOnlyTransaction(pool, async (client) => {
    const tables = [...freshLaunchConfigurationManifest].map((entry) => entry.table).sort();
    const counts: Record<string, string> = {};
    const dataHashes: Record<string, string> = {};
    for (const table of tables) {
      const result = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${quoteIdent(table)}`);
      counts[table] = result.rows[0]?.count ?? "0";
      const content = await client.query<{ hash: string }>(
        `SELECT md5(COALESCE(string_agg(md5(row_to_json(source_row)::text), ',' ORDER BY md5(row_to_json(source_row)::text)), '')) AS hash
         FROM ${quoteIdent(table)} source_row`,
      );
      dataHashes[table] = content.rows[0]?.hash ?? "";
    }
    const sequenceResult = await client.query<{ schemaname: string; sequencename: string; last_value: string }>(
      `SELECT schemaname, sequencename, last_value::text FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename`,
    );
    const schemaResult = await client.query<{ definition: string }>(
      `SELECT pg_get_viewdef(c.oid, true) AS definition FROM pg_class c
       JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='v' ORDER BY c.relname`,
    );
    const migration = await latestMigration(client);
    return deterministicHash({ counts, dataHashes, sequences: sequenceResult.rows, views: schemaResult.rows, migration });
  });
}
