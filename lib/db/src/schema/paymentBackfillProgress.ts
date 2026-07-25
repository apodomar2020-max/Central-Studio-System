/**
 * Payment Backfill Progress — Finance Phase 2A DB foundation.
 *
 * One row per (batch, source family) pair, tracking that family's own
 * resumable scan cursor and outcome counts independently of every other
 * family in the same batch. `lastSourceId` is the highest SOURCE-table
 * primary key examined so far (a package_orders.id or bookings.id) — never
 * a payment_records.id. The destination table doesn't exist yet in this
 * repository (Phase 2A creates only the backfill foundation, not the
 * payment register), and even once it does, a row a scan correctly SKIPPED
 * (already had a payment_records row) would advance this cursor without
 * ever producing a destination row to derive a cursor from — so the source
 * table's own primary key is the only value that can serve as a resumable
 * cursor.
 *
 * Batch-level completion ("this batch is done") is a CROSS-ROW rule — it
 * depends on every expected progress row (one per source family) reaching
 * 'completed' with zero failures, which cannot be expressed as a same-row
 * CHECK constraint in PostgreSQL. This file deliberately does NOT implement
 * a finalization helper, trigger, or any other mechanism that could mark a
 * payment_backfill_batches row 'completed'/'failed':
 *
 *   - Finance Phase 2A DB Foundation — Step 2 explicitly forbids creating any
 *     backfill execution script in this task.
 *   - The finalization procedure's natural owner is that same future
 *     execution script (Phase 2D: "batch manifest creation and real batched
 *     execution"), which is the only code that will ever know when it has
 *     finished processing every source family for a batch.
 *   - Building a standalone finalization helper now, with no caller and no
 *     execution script to call it, would be exactly the kind of speculative,
 *     unowned abstraction this codebase's conventions reject — it cannot be
 *     tested against real batch-completion behavior until the script that
 *     drives it exists.
 *
 * Until that Phase 2D script exists, no code in this repository is
 * authorized to set payment_backfill_batches.status to 'completed' or
 * 'failed' directly — this table's own row-level CHECK constraints (see
 * paymentBackfillBatches.ts) are the only enforcement in place today, and
 * they intentionally say nothing about cross-row agreement between a batch
 * and its progress rows.
 */
import { check, integer, pgTable, serial, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { paymentBackfillBatchesTable } from "./paymentBackfillBatches";

export const PAYMENT_BACKFILL_SOURCE_FAMILIES = [
  "package_orders",
  "bookings",
] as const;

export type PaymentBackfillSourceFamily = (typeof PAYMENT_BACKFILL_SOURCE_FAMILIES)[number];

export const PAYMENT_BACKFILL_PROGRESS_STATUSES = [
  "running",
  "completed",
  "failed",
] as const;

export type PaymentBackfillProgressStatus = (typeof PAYMENT_BACKFILL_PROGRESS_STATUSES)[number];

export const paymentBackfillProgressTable = pgTable("payment_backfill_progress", {
  id: serial("id").primaryKey(),

  batchId: uuid("batch_id")
    .notNull()
    .references(() => paymentBackfillBatchesTable.id, { onDelete: "restrict" }),

  sourceFamily: text("source_family").notNull(),

  lastSourceId: integer("last_source_id").notNull().default(0),

  status: text("status").notNull().default("running"),

  processedCount: integer("processed_count").notNull().default(0),
  insertedCount: integer("inserted_count").notNull().default(0),
  skippedCount: integer("skipped_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),

  startedAt: timestamp("started_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true, mode: "string" }),
}, (table) => ([
  unique("payment_backfill_progress_batch_id_source_family_unique").on(table.batchId, table.sourceFamily),

  check("payment_backfill_progress_source_family_check", sql`${table.sourceFamily} in ('package_orders','bookings')`),
  check("payment_backfill_progress_status_check", sql`${table.status} in ('running','completed','failed')`),

  check("payment_backfill_progress_last_source_id_check", sql`${table.lastSourceId} >= 0`),
  check("payment_backfill_progress_counts_non_negative_check", sql`${table.processedCount} >= 0 and ${table.insertedCount} >= 0 and ${table.skippedCount} >= 0 and ${table.failedCount} >= 0`),
  check("payment_backfill_progress_count_reconciliation_check", sql`${table.processedCount} = ${table.insertedCount} + ${table.skippedCount} + ${table.failedCount}`),

  // Per-status terminal-timestamp / failure-count shape.
  check("payment_backfill_progress_running_shape_check", sql`${table.status} <> 'running' or ${table.finishedAt} is null`),
  check("payment_backfill_progress_completed_shape_check", sql`${table.status} <> 'completed' or (${table.finishedAt} is not null and ${table.failedCount} = 0)`),
  check("payment_backfill_progress_failed_shape_check", sql`${table.status} <> 'failed' or (${table.finishedAt} is not null and ${table.failedCount} > 0)`),

  check("payment_backfill_progress_finished_after_started_check", sql`${table.finishedAt} is null or ${table.finishedAt} >= ${table.startedAt}`),
]));

export type PaymentBackfillProgress = typeof paymentBackfillProgressTable.$inferSelect;
export type InsertPaymentBackfillProgress = typeof paymentBackfillProgressTable.$inferInsert;
