import type { Pool, PoolClient } from "pg";
import { freshLaunchConfigurationManifest, MANIFEST_HASH } from "./freshLaunchConfigurationManifest";
import { latestMigration, quoteIdent, withImportTransaction } from "./database";
import { validateExportArtifact } from "./configurationExport";
import type { FreshLaunchExport, TransferGroup } from "./types";

const MIGRATION_DEFAULT_TABLES = new Set([
  "app_content_pages",
  "app_faq_items",
  "background_music_settings",
  "ballet_levels",
  "class_capacity_settings",
  "class_pricing_settings",
  "class_reminder_settings",
  "dance_types",
]);

async function assertTargetReady(client: PoolClient, artifact: FreshLaunchExport): Promise<void> {
  for (const group of freshLaunchConfigurationManifest.filter((entry) => entry.classification === "transfer")) {
    const result = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${quoteIdent(group.table)}`);
    const count = Number(result.rows[0]?.count ?? 0);
    if (count > 0 && !MIGRATION_DEFAULT_TABLES.has(group.table)) throw new Error(`TARGET_NOT_EMPTY:${group.table}`);
    if (count > 0) {
      const exported = artifact.groups.find((item) => item.key === group.key);
      if (!exported) throw new Error(`TARGET_DEFAULT_WITHOUT_EXPORT:${group.table}`);
      const ids = new Set(exported.rows.map((row) => String(row.id)).filter((id) => id !== "undefined"));
      const targetIds = await client.query<{ id: unknown }>(`SELECT id FROM ${quoteIdent(group.table)} ORDER BY id`);
      if (targetIds.rows.some((row) => !ids.has(String(row.id)))) throw new Error(`TARGET_UNEXPECTED_DEFAULT:${group.table}`);
    }
  }
}

async function writeRow(client: PoolClient, group: TransferGroup, columns: string[], row: Record<string, unknown>): Promise<void> {
  const values = columns.map((column) => row[column]);
  const table = quoteIdent(group.table);
  if (MIGRATION_DEFAULT_TABLES.has(group.table) && row.id !== undefined) {
    const existing = await client.query(`SELECT 1 FROM ${table} WHERE id = $1`, [row.id]);
    if (existing.rowCount) {
      const updated = columns.filter((column) => column !== "id");
      await client.query(
        `UPDATE ${table} SET ${updated.map((column, index) => `${quoteIdent(column)} = $${index + 1}`).join(", ")} WHERE id = $${updated.length + 1}`,
        [...updated.map((column) => row[column]), row.id],
      );
      return;
    }
  }
  await client.query(
    `INSERT INTO ${table} (${columns.map(quoteIdent).join(", ")}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(", ")})`,
    values,
  );
}

async function advanceSequence(client: PoolClient, group: TransferGroup): Promise<string | null> {
  if (group.sequence !== "advance") return null;
  const idColumn = await client.query<{ present: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1 AND column_name='id'
     ) AS present`,
    [group.table],
  );
  if (!idColumn.rows[0]?.present) return null;
  const result = await client.query<{ sequence_name: string | null }>(
    `SELECT pg_get_serial_sequence($1, 'id') AS sequence_name`,
    [group.table],
  );
  const sequence = result.rows[0]?.sequence_name;
  if (!sequence) return null;
  await client.query(
    `SELECT setval($1::regclass, GREATEST(COALESCE((SELECT max(id) FROM ${quoteIdent(group.table)}), 0), 1), COALESCE((SELECT max(id) FROM ${quoteIdent(group.table)}), 0) > 0)`,
    [sequence],
  );
  return sequence;
}

export async function importFreshLaunchConfiguration(
  pool: Pool,
  artifact: FreshLaunchExport,
): Promise<{ imported: Record<string, number>; advancedSequences: string[] }> {
  validateExportArtifact(artifact);
  if (artifact.manifestHash !== MANIFEST_HASH) throw new Error("TARGET_MANIFEST_MISMATCH");
  return withImportTransaction(pool, async (client) => {
    const targetMigration = await latestMigration(client);
    if (targetMigration !== artifact.sourceMigration) throw new Error("TARGET_MIGRATION_MISMATCH");
    await assertTargetReady(client, artifact);
    const imported: Record<string, number> = {};
    const advancedSequences: string[] = [];
    const groups = [...freshLaunchConfigurationManifest]
      .filter((entry) => entry.classification === "transfer")
      .sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
    for (const group of groups) {
      const exported = artifact.groups.find((item) => item.key === group.key);
      if (!exported) throw new Error(`EXPORT_GROUP_MISSING:${group.key}`);
      for (const row of exported.rows) await writeRow(client, group, exported.columns, row);
      imported[group.key] = exported.rows.length;
      const sequence = await advanceSequence(client, group);
      if (sequence) advancedSequences.push(sequence);
    }
    return { imported, advancedSequences };
  });
}
