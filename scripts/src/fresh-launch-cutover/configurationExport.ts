import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { listColumns, quoteIdent, withReadOnlyTransaction } from "./database";
import {
  freshLaunchConfigurationManifest,
  MANIFEST_HASH,
  MANIFEST_VERSION,
  validateManifest,
} from "./freshLaunchConfigurationManifest";
import type { ExportGroup, FreshLaunchExport, TransferGroup } from "./types";

const SENSITIVE_COLUMN = /(^|_)(email|phone|password|password_hash|token|secret|date_of_birth|birthday|address|medical_notes)(_|$)/i;
const TRANSACTION_TABLES = new Set(
  freshLaunchConfigurationManifest.filter((entry) => entry.classification !== "transfer").map((entry) => entry.table),
);

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

async function exportGroup(client: PoolClient, group: TransferGroup): Promise<ExportGroup> {
  const allColumns = await listColumns(client, group.table);
  const excluded = new Set(group.excludedColumns ?? []);
  const columns = allColumns.filter((column) => !excluded.has(column));
  const sensitive = columns.filter((column) => SENSITIVE_COLUMN.test(column));
  if (sensitive.length) throw new Error(`SENSITIVE_EXPORT_COLUMN:${group.table}:${sensitive.join(",")}`);
  const orderColumns = columns.includes("id") ? ["id"] : columns;
  const result = await client.query<Record<string, unknown>>(
    `SELECT ${columns.map(quoteIdent).join(", ")} FROM ${quoteIdent(group.table)}
     ${group.predicate ? `WHERE ${group.predicate}` : ""}
     ORDER BY ${orderColumns.map(quoteIdent).join(", ")}`,
  );
  return { key: group.key, table: group.table, columns, rows: result.rows, hash: hash(result.rows) };
}

export function validateExportArtifact(artifact: FreshLaunchExport): void {
  if (artifact.format !== "central-studio-fresh-launch-configuration" || artifact.version !== 1) {
    throw new Error("EXPORT_VERSION_UNSUPPORTED");
  }
  if (artifact.manifestVersion !== MANIFEST_VERSION || artifact.manifestHash !== MANIFEST_HASH) {
    throw new Error("EXPORT_MANIFEST_MISMATCH");
  }
  const allowed = new Map(freshLaunchConfigurationManifest.filter((entry) => entry.classification === "transfer").map((entry) => [entry.key, entry]));
  for (const group of artifact.groups) {
    const manifest = allowed.get(group.key);
    if (!manifest || manifest.table !== group.table || TRANSACTION_TABLES.has(group.table)) throw new Error(`EXPORT_GROUP_FORBIDDEN:${group.key}`);
    if (group.columns.some((column) => SENSITIVE_COLUMN.test(column))) throw new Error(`SENSITIVE_EXPORT_COLUMN:${group.table}`);
    for (const row of group.rows) {
      const unknown = Object.keys(row).filter((key) => !group.columns.includes(key));
      if (unknown.length) throw new Error(`UNKNOWN_EXPORT_FIELD:${group.table}:${unknown.join(",")}`);
    }
    if (hash(group.rows) !== group.hash) throw new Error(`EXPORT_GROUP_HASH_MISMATCH:${group.key}`);
  }
  const withoutHash = { ...artifact, contentHash: "" };
  if (hash(withoutHash) !== artifact.contentHash) throw new Error("EXPORT_CONTENT_HASH_MISMATCH");
}

export async function exportFreshLaunchConfiguration(pool: Pool, migration: string): Promise<FreshLaunchExport> {
  validateManifest();
  const groups = await withReadOnlyTransaction(pool, async (client) => {
    const ordered = freshLaunchConfigurationManifest
      .filter((entry) => entry.classification === "transfer")
      .sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
    const output: ExportGroup[] = [];
    for (const group of ordered) output.push(await exportGroup(client, group));
    return output;
  });
  const base = {
    format: "central-studio-fresh-launch-configuration" as const,
    version: 1 as const,
    manifestVersion: MANIFEST_VERSION,
    manifestHash: MANIFEST_HASH,
    sourceMigration: migration,
    groups,
    contentHash: "",
  };
  const artifact = { ...base, contentHash: hash(base) };
  validateExportArtifact(artifact);
  return artifact;
}

export { hash as deterministicHash };
