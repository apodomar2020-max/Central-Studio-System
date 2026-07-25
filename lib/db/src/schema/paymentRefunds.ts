/**
 * Payment Refunds — Finance Phase 2A DB foundation (dark register).
 *
 * No writer exists yet. No refund route, refund Admin UI, or payout logic
 * exists in this repository today — this table is locked here, dark, so a
 * future refund lifecycle write path has an exact, already-tested contract
 * to build against.
 *
 * `paymentRecordId` uses ON DELETE RESTRICT, matching payment_records' own
 * RESTRICT convention: a payment_records row that has ever had a refund
 * attached can never be deleted out from under its refund history.
 *
 * No separate payout-initiation actor exists in this phase — `processing`
 * reuses the same shape as `approved` (payout started, not yet confirmed
 * complete); only `refunded`/`failed` populate `processedByAdminId`/
 * `processedAt`, recording who attempted the payout and when, including on
 * failure.
 */
import { check, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { paymentRecordsTable } from "./paymentRecords";
import { systemUsersTable } from "./systemUsers";

export const PAYMENT_REFUND_STATUSES = [
  "underReview",
  "approved",
  "rejected",
  "processing",
  "refunded",
  "failed",
] as const;
export type PaymentRefundStatus = (typeof PAYMENT_REFUND_STATUSES)[number];

export const PAYMENT_REFUND_METHODS = [
  "cash",
  "original_payment_method",
] as const;
export type PaymentRefundMethod = (typeof PAYMENT_REFUND_METHODS)[number];

export const paymentRefundsTable = pgTable("payment_refunds", {
  id: serial("id").primaryKey(),

  paymentRecordId: integer("payment_record_id").notNull().references(() => paymentRecordsTable.id, { onDelete: "restrict" }),

  status: text("status").notNull().default("underReview"),

  requestedAmountMinor: integer("requested_amount_minor").notNull(),
  approvedAmountMinor: integer("approved_amount_minor"),
  refundedAmountMinor: integer("refunded_amount_minor"),

  refundMethod: text("refund_method").notNull(),
  requestedReason: text("requested_reason").notNull(),

  requestedByAdminId: integer("requested_by_admin_id").references(() => systemUsersTable.id, { onDelete: "set null" }),
  reviewedByAdminId: integer("reviewed_by_admin_id").references(() => systemUsersTable.id, { onDelete: "set null" }),
  processedByAdminId: integer("processed_by_admin_id").references(() => systemUsersTable.id, { onDelete: "set null" }),

  transactionReference: text("transaction_reference"),
  adminNotes: text("admin_notes"),
  failedReason: text("failed_reason"),

  reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "string" }),
  processedAt: timestamp("processed_at", { withTimezone: true, mode: "string" }),

  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => ([
  uniqueIndex("payment_refunds_open_idx")
    .on(table.paymentRecordId)
    .where(sql`${table.status} in ('underReview','approved','processing')`),

  // ── Vocabularies ─────────────────────────────────────────────────────
  check("payment_refunds_status_check", sql`${table.status} in ('underReview','approved','rejected','processing','refunded','failed')`),
  check("payment_refunds_refund_method_check", sql`${table.refundMethod} in ('cash','original_payment_method')`),

  // ── Amount rules ─────────────────────────────────────────────────────
  check("payment_refunds_requested_positive_check", sql`${table.requestedAmountMinor} > 0`),
  check("payment_refunds_approved_positive_check", sql`${table.approvedAmountMinor} is null or ${table.approvedAmountMinor} > 0`),
  check("payment_refunds_approved_lte_requested_check", sql`${table.approvedAmountMinor} is null or ${table.approvedAmountMinor} <= ${table.requestedAmountMinor}`),
  check("payment_refunds_refunded_positive_check", sql`${table.refundedAmountMinor} is null or ${table.refundedAmountMinor} > 0`),
  check("payment_refunds_refunded_requires_approved_check", sql`${table.refundedAmountMinor} is null or ${table.approvedAmountMinor} is not null`),
  check("payment_refunds_refunded_lte_approved_check", sql`${table.refundedAmountMinor} is null or ${table.refundedAmountMinor} <= ${table.approvedAmountMinor}`),

  // ── Full status matrix ───────────────────────────────────────────────
  check("payment_refunds_status_under_review_check", sql`
    ${table.status} <> 'underReview' or (
      ${table.approvedAmountMinor} is null and ${table.refundedAmountMinor} is null
      and ${table.reviewedByAdminId} is null and ${table.processedByAdminId} is null
      and ${table.reviewedAt} is null and ${table.processedAt} is null
      and ${table.failedReason} is null
    )
  `),
  check("payment_refunds_status_approved_check", sql`
    ${table.status} <> 'approved' or (
      ${table.approvedAmountMinor} is not null
      and ${table.reviewedByAdminId} is not null and ${table.reviewedAt} is not null
      and ${table.refundedAmountMinor} is null
      and ${table.processedByAdminId} is null and ${table.processedAt} is null
      and ${table.failedReason} is null
    )
  `),
  check("payment_refunds_status_rejected_check", sql`
    ${table.status} <> 'rejected' or (
      ${table.reviewedByAdminId} is not null and ${table.reviewedAt} is not null
      and ${table.approvedAmountMinor} is null and ${table.refundedAmountMinor} is null
      and ${table.processedByAdminId} is null and ${table.processedAt} is null
      and ${table.failedReason} is null
    )
  `),
  check("payment_refunds_status_processing_check", sql`
    ${table.status} <> 'processing' or (
      ${table.approvedAmountMinor} is not null
      and ${table.reviewedByAdminId} is not null and ${table.reviewedAt} is not null
      and ${table.refundedAmountMinor} is null
      and ${table.processedByAdminId} is null and ${table.processedAt} is null
      and ${table.failedReason} is null
    )
  `),
  check("payment_refunds_status_refunded_check", sql`
    ${table.status} <> 'refunded' or (
      ${table.approvedAmountMinor} is not null and ${table.refundedAmountMinor} is not null
      and ${table.reviewedByAdminId} is not null and ${table.reviewedAt} is not null
      and ${table.processedByAdminId} is not null and ${table.processedAt} is not null
      and ${table.failedReason} is null
      and ${table.refundedAmountMinor} <= ${table.approvedAmountMinor}
    )
  `),
  check("payment_refunds_status_failed_check", sql`
    ${table.status} <> 'failed' or (
      ${table.approvedAmountMinor} is not null
      and ${table.reviewedByAdminId} is not null and ${table.reviewedAt} is not null
      and ${table.processedByAdminId} is not null and ${table.processedAt} is not null
      and ${table.failedReason} is not null and ${table.failedReason} !~ '^\s*$'
      and ${table.refundedAmountMinor} is null
    )
  `),
]));

export type PaymentRefund = typeof paymentRefundsTable.$inferSelect;
export type InsertPaymentRefund = typeof paymentRefundsTable.$inferInsert;
