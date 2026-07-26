/**
 * Payment Backfill Batches — Finance Phase 2A DB foundation, extended in
 * Phase 2D-2 with the batch control lifecycle and dry-run evidence binding.
 *
 * One row per historical-backfill batch: what scope it covers, what
 * dry-run evidence it was created against, who approved it and against
 * which exact evidence/counts, and its current lifecycle state. Per-source
 * progress lives in payment_backfill_progress_items (a different grain —
 * one row per source record, not per batch), not here.
 *
 * Phase 2D-2 adds no mutating writer. No code in this repository may set
 * status to 'completed'/'failed' from a real Finance-write outcome yet —
 * see paymentBackfillProgress.ts's module doc for why that decision was
 * made; it still applies. 'running' in this phase is control-state only.
 */
import { check, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const PAYMENT_BACKFILL_BATCH_STATUSES = [
  "created",
  "dry_run_completed",
  "approved",
  "running",
  "paused",
  "cancelled",
  "completed",
  "failed",
  "rolled_back",
] as const;

export type PaymentBackfillBatchStatus = (typeof PAYMENT_BACKFILL_BATCH_STATUSES)[number];

export const paymentBackfillBatchesTable = pgTable("payment_backfill_batches", {
  id: uuid("id").primaryKey().defaultRandom(),

  status: text("status").notNull().default("created"),

  startedAt: timestamp("started_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true, mode: "string" }),
  rolledBackAt: timestamp("rolled_back_at", { withTimezone: true, mode: "string" }),

  createdBy: text("created_by").notNull(),
  dryRunSummary: jsonb("dry_run_summary"),
  sourceMainCommit: text("source_main_commit").notNull(),
  notes: text("notes"),

  // ── Phase 2D-2: dry-run evidence binding ──────────────────────────────
  classifierVersion: text("classifier_version"),
  reportSchemaVersion: text("report_schema_version"),
  filters: jsonb("filters"),
  maxRows: integer("max_rows"),
  batchSize: integer("batch_size"),
  evidenceFingerprint: text("evidence_fingerprint"),
  evidenceAggregate: jsonb("evidence_aggregate"),

  // ── Phase 2D-2: approval binding ──────────────────────────────────────
  expectedEligibleCount: integer("expected_eligible_count"),
  maxExecutionCount: integer("max_execution_count"),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),

  // ── Phase 2D-2: pause/cancel attribution ──────────────────────────────
  pausedAt: timestamp("paused_at", { withTimezone: true, mode: "string" }),
  cancelledBy: text("cancelled_by"),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "string" }),

  // Stable hash of the batch's scope (source families + filters + expected
  // classifier version/code commit), used to enforce "no overlapping active
  // batch for equivalent scope" via a partial unique index rather than a
  // raw jsonb equality comparison in every query.
  scopeKey: text("scope_key"),
}, (table) => ([
  // Only one non-terminal batch per equivalent scope.
  uniqueIndex("payment_backfill_batches_active_scope_unique")
    .on(table.scopeKey)
    .where(sql`${table.status} in ('created','dry_run_completed','approved','running','paused')`),

  check(
    "payment_backfill_batches_status_check",
    sql`${table.status} in ('created','dry_run_completed','approved','running','paused','cancelled','completed','failed','rolled_back')`,
  ),

  // Per-status terminal-timestamp shape — mirrors the locked matrix from the
  // Finance Phase 2 DDL spec exactly, restated here as enforcing constraints.
  check("payment_backfill_batches_running_shape_check", sql`${table.status} <> 'running' or (${table.finishedAt} is null and ${table.rolledBackAt} is null)`),
  check("payment_backfill_batches_completed_shape_check", sql`${table.status} <> 'completed' or (${table.finishedAt} is not null and ${table.rolledBackAt} is null)`),
  check("payment_backfill_batches_failed_shape_check", sql`${table.status} <> 'failed' or (${table.finishedAt} is not null and ${table.rolledBackAt} is null)`),
  check("payment_backfill_batches_rolled_back_shape_check", sql`${table.status} <> 'rolled_back' or (${table.finishedAt} is not null and ${table.rolledBackAt} is not null and ${table.rolledBackAt} >= ${table.finishedAt})`),

  // General timestamp ordering, independent of status.
  check("payment_backfill_batches_finished_after_started_check", sql`${table.finishedAt} is null or ${table.finishedAt} >= ${table.startedAt}`),
  check("payment_backfill_batches_rolled_back_after_started_check", sql`${table.rolledBackAt} is null or ${table.rolledBackAt} >= ${table.startedAt}`),

  check("payment_backfill_batches_max_rows_positive_check", sql`${table.maxRows} is null or ${table.maxRows} > 0`),
  check("payment_backfill_batches_batch_size_positive_check", sql`${table.batchSize} is null or ${table.batchSize} > 0`),
  check("payment_backfill_batches_expected_eligible_count_non_negative_check", sql`${table.expectedEligibleCount} is null or ${table.expectedEligibleCount} >= 0`),
  check("payment_backfill_batches_max_execution_count_non_negative_check", sql`${table.maxExecutionCount} is null or ${table.maxExecutionCount} >= 0`),

  check(
    "payment_backfill_batches_evidence_bound_check",
    sql`${table.status} in ('created','cancelled') or (${table.classifierVersion} is not null and ${table.reportSchemaVersion} is not null and ${table.filters} is not null and ${table.maxRows} is not null and ${table.batchSize} is not null and ${table.evidenceFingerprint} is not null)`,
  ),
  check(
    "payment_backfill_batches_approval_bound_check",
    sql`${table.status} in ('created','dry_run_completed','cancelled') or (${table.approvedBy} is not null and ${table.approvedAt} is not null and ${table.expectedEligibleCount} is not null and ${table.maxExecutionCount} is not null)`,
  ),
  check("payment_backfill_batches_paused_shape_check", sql`${table.status} <> 'paused' or ${table.pausedAt} is not null`),
  check(
    "payment_backfill_batches_cancelled_shape_check",
    sql`${table.status} <> 'cancelled' or (${table.cancelledBy} is not null and ${table.cancelledAt} is not null)`,
  ),
]));

export type PaymentBackfillBatch = typeof paymentBackfillBatchesTable.$inferSelect;
export type InsertPaymentBackfillBatch = typeof paymentBackfillBatchesTable.$inferInsert;
