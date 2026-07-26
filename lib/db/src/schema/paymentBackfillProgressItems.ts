/**
 * Payment Backfill Progress Items — Finance Phase 2D-2.
 *
 * One row per individual source record considered by a batch — a genuinely
 * different grain from payment_backfill_progress (Phase 2A), which tracks
 * one aggregate row per (batch, source_family) pair. That table's shape
 * cannot represent a per-record status, so this is a new table rather than
 * an alteration of it; payment_backfill_progress is left untouched.
 *
 * No writer exists in Phase 2D-2 — 'succeeded' and 'processing' are
 * rejected by this table's own CHECK constraint (see the migration), not
 * merely by application code, so a row can never legitimately reach either
 * status until the Phase 2D-3 writer exists and this constraint is
 * deliberately relaxed alongside it.
 */
import {
  check,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { paymentBackfillBatchesTable } from "./paymentBackfillBatches";

export const PAYMENT_BACKFILL_PROGRESS_ITEM_SOURCE_FAMILIES = [
  "package_orders",
  "bookings",
  "studio_walkins",
] as const;

export type PaymentBackfillProgressItemSourceFamily =
  (typeof PAYMENT_BACKFILL_PROGRESS_ITEM_SOURCE_FAMILIES)[number];

export const PAYMENT_BACKFILL_PROGRESS_ITEM_STATUSES = [
  "pending",
  "already_canonical",
  "manual_review",
  "excluded",
  "corrupt",
  "eligible_not_executed",
  "processing",
  "succeeded",
  "failed",
  "cancelled",
] as const;

export type PaymentBackfillProgressItemStatus =
  (typeof PAYMENT_BACKFILL_PROGRESS_ITEM_STATUSES)[number];

export const paymentBackfillProgressItemsTable = pgTable("payment_backfill_progress_items", {
  id: serial("id").primaryKey(),

  batchId: uuid("batch_id")
    .notNull()
    .references(() => paymentBackfillBatchesTable.id, { onDelete: "restrict" }),

  sourceFamily: text("source_family").notNull(),
  sourceId: integer("source_id").notNull(),

  classifierVersion: text("classifier_version").notNull(),
  codeCommit: text("code_commit").notNull(),

  classificationCode: text("classification_code").notNull(),
  eligibility: text("eligibility").notNull(),

  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  lastErrorCode: text("last_error_code"),
  lastSafeCursor: integer("last_safe_cursor"),

  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date().toISOString()),
}, (table) => ([
  unique("payment_backfill_progress_items_unique").on(table.batchId, table.sourceFamily, table.sourceId),

  check(
    "payment_backfill_progress_items_source_family_check",
    sql`${table.sourceFamily} in ('package_orders','bookings','studio_walkins')`,
  ),
  check(
    "payment_backfill_progress_items_status_check",
    sql`${table.status} in ('pending','already_canonical','manual_review','excluded','corrupt','eligible_not_executed','processing','succeeded','failed','cancelled')`,
  ),
  check("payment_backfill_progress_items_attempts_non_negative_check", sql`${table.attempts} >= 0`),
  check("payment_backfill_progress_items_source_id_non_negative_check", sql`${table.sourceId} >= 0`),
  check("payment_backfill_progress_items_no_writer_yet_check", sql`${table.status} not in ('succeeded','processing')`),
  check("payment_backfill_progress_items_failed_shape_check", sql`${table.status} <> 'failed' or ${table.lastErrorCode} is not null`),

  index("payment_backfill_progress_items_batch_id_idx").on(table.batchId),
]));

export type PaymentBackfillProgressItem = typeof paymentBackfillProgressItemsTable.$inferSelect;
export type InsertPaymentBackfillProgressItem = typeof paymentBackfillProgressItemsTable.$inferInsert;
