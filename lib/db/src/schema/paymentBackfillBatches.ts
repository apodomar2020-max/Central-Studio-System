/**
 * Payment Backfill Batches — Finance Phase 2A DB foundation.
 *
 * One row per invocation of the (future, Phase 2D) historical-backfill
 * script. This is the batch manifest: what ran, when, who ran it, and
 * whether it completed, failed, or was rolled back. Per-source-family
 * progress (row counts, resumable cursor) lives in the separate
 * payment_backfill_progress table, not here — a batch spans multiple
 * independently-progressing source families, so counters belong there.
 *
 * No code in this repository may set status to 'completed'/'failed' yet —
 * there is no backfill execution script, and no batch finalization helper is
 * implemented in Phase 2A (see paymentBackfillProgress.ts's module doc for
 * why that decision was made). This table exists only so its shape and
 * constraints are locked before the script that populates it is written.
 */
import { check, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const PAYMENT_BACKFILL_BATCH_STATUSES = [
  "running",
  "completed",
  "failed",
  "rolled_back",
] as const;

export type PaymentBackfillBatchStatus = (typeof PAYMENT_BACKFILL_BATCH_STATUSES)[number];

export const paymentBackfillBatchesTable = pgTable("payment_backfill_batches", {
  id: uuid("id").primaryKey().defaultRandom(),

  status: text("status").notNull().default("running"),

  startedAt: timestamp("started_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true, mode: "string" }),
  rolledBackAt: timestamp("rolled_back_at", { withTimezone: true, mode: "string" }),

  createdBy: text("created_by").notNull(),
  dryRunSummary: jsonb("dry_run_summary"),
  sourceMainCommit: text("source_main_commit").notNull(),
  notes: text("notes"),
}, (table) => ([
  check("payment_backfill_batches_status_check", sql`${table.status} in ('running','completed','failed','rolled_back')`),

  // Per-status terminal-timestamp shape — mirrors the locked matrix from the
  // Finance Phase 2 DDL spec exactly, restated here as enforcing constraints.
  check("payment_backfill_batches_running_shape_check", sql`${table.status} <> 'running' or (${table.finishedAt} is null and ${table.rolledBackAt} is null)`),
  check("payment_backfill_batches_completed_shape_check", sql`${table.status} <> 'completed' or (${table.finishedAt} is not null and ${table.rolledBackAt} is null)`),
  check("payment_backfill_batches_failed_shape_check", sql`${table.status} <> 'failed' or (${table.finishedAt} is not null and ${table.rolledBackAt} is null)`),
  check("payment_backfill_batches_rolled_back_shape_check", sql`${table.status} <> 'rolled_back' or (${table.finishedAt} is not null and ${table.rolledBackAt} is not null and ${table.rolledBackAt} >= ${table.finishedAt})`),

  // General timestamp ordering, independent of status.
  check("payment_backfill_batches_finished_after_started_check", sql`${table.finishedAt} is null or ${table.finishedAt} >= ${table.startedAt}`),
  check("payment_backfill_batches_rolled_back_after_started_check", sql`${table.rolledBackAt} is null or ${table.rolledBackAt} >= ${table.startedAt}`),
]));

export type PaymentBackfillBatch = typeof paymentBackfillBatchesTable.$inferSelect;
export type InsertPaymentBackfillBatch = typeof paymentBackfillBatchesTable.$inferInsert;
