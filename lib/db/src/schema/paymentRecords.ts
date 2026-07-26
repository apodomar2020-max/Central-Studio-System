/**
 * Payment Records — Finance Phase 2A DB foundation (dark register).
 *
 * No writer exists yet. Every column, FK, and CHECK constraint is locked
 * here so a future write path (Phase 2B) has an exact, already-tested
 * contract to build against — but nothing in this repository creates a row
 * in this table today.
 *
 * Both source FKs (packageOrderId, bookingId) use ON DELETE RESTRICT, not
 * SET NULL — see 0078_payment_records_foundation.sql's header comment and
 * guard_payment_record_source_integrity() for why a plain cascade cannot be
 * used here. `sourceDeletedAt` is the tombstone marker set only by the
 * controlled booking-delete transaction in bookings.ts's
 * `DELETE /bookings/:id` handler.
 *
 * A `package_purchase` row can never become a source tombstone: it has no
 * booking-side deletion path, and `package_order_id`'s RESTRICT FK means a
 * package-order delete is rejected outright rather than producing a
 * tombstone this schema never designed for.
 */
import { check, integer, pgTable, serial, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { packageOrdersTable } from "./packageOrders";
import { bookingsTable } from "./bookings";
import { paymentBackfillBatchesTable } from "./paymentBackfillBatches";
import { systemUsersTable } from "./systemUsers";
import { studentsTable } from "./students";
import { childrenTable } from "./children";

export const PAYMENT_RECORD_FLOW_TYPES = [
  "package_purchase",
  "single_class_booking",
  "studio_walkin",
] as const;
export type PaymentRecordFlowType = (typeof PAYMENT_RECORD_FLOW_TYPES)[number];

export const PAYMENT_RECORD_CAPTURE_ORIGINS = [
  "live_capture",
  "historical_backfill",
] as const;
export type PaymentRecordCaptureOrigin = (typeof PAYMENT_RECORD_CAPTURE_ORIGINS)[number];

export const PAYMENT_RECORD_EVIDENCE_CLASSES = [
  "confirmed",
  "legacy_operational_status",
  "unknown",
] as const;
export type PaymentRecordEvidenceClass = (typeof PAYMENT_RECORD_EVIDENCE_CLASSES)[number];

export const PAYMENT_RECORD_AMOUNT_AVAILABILITIES = [
  "exact",
  "estimated_backfill",
  "unknown",
] as const;
export type PaymentRecordAmountAvailability = (typeof PAYMENT_RECORD_AMOUNT_AVAILABILITIES)[number];

export const PAYMENT_RECORD_AMOUNT_SOURCES = [
  "creation_snapshot",
  "catalog_price_at_backfill_time",
  "unresolvable",
] as const;
export type PaymentRecordAmountSource = (typeof PAYMENT_RECORD_AMOUNT_SOURCES)[number];

export const PAYMENT_RECORD_REQUESTED_CHANNELS = [
  "pay_at_studio",
  "online",
  "internal_credit",
  "complimentary",
  "unknown",
] as const;
export type PaymentRecordRequestedChannel = (typeof PAYMENT_RECORD_REQUESTED_CHANNELS)[number];

export const PAYMENT_RECORD_CONFIRMED_METHODS = [
  "cash",
  "card",
  "kashier",
  "bank_transfer",
  "unknown",
] as const;
export type PaymentRecordConfirmedMethod = (typeof PAYMENT_RECORD_CONFIRMED_METHODS)[number];

export const PAYMENT_RECORD_STATUSES = [
  "unpaid",
  "pending_confirmation",
  "paid",
  "partially_refunded",
  "refunded",
  "waived",
  "failed",
  "cancelled",
  "legacy_unverified",
] as const;
export type PaymentRecordStatus = (typeof PAYMENT_RECORD_STATUSES)[number];

export const paymentRecordsTable = pgTable("payment_records", {
  id: serial("id").primaryKey(),

  flowType: text("flow_type").notNull(),
  packageOrderId: integer("package_order_id").references(() => packageOrdersTable.id, { onDelete: "restrict" }),
  bookingId: integer("booking_id").references(() => bookingsTable.id, { onDelete: "restrict" }),
  sourceDeletedAt: timestamp("source_deleted_at", { withTimezone: true, mode: "string" }),

  captureOrigin: text("capture_origin").notNull(),
  backfillBatchId: uuid("backfill_batch_id").references(() => paymentBackfillBatchesTable.id, { onDelete: "restrict" }),
  capturedAt: timestamp("captured_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),

  evidenceClass: text("evidence_class").notNull(),
  amountAvailability: text("amount_availability").notNull(),
  amountSource: text("amount_source").notNull(),

  grossAmountMinor: integer("gross_amount_minor"),
  discountAmountMinor: integer("discount_amount_minor"),
  finalPayableAmountMinor: integer("final_payable_amount_minor"),
  paidAmountMinor: integer("paid_amount_minor").notNull().default(0),
  refundedAmountMinor: integer("refunded_amount_minor").notNull().default(0),
  currency: text("currency").notNull().default("EGP"),

  requestedPaymentChannel: text("requested_payment_channel"),
  rawRequestedChannel: text("raw_requested_channel"),
  confirmedPaymentMethod: text("confirmed_payment_method"),
  rawConfirmedMethod: text("raw_confirmed_method"),

  status: text("status").notNull().default("unpaid"),
  paidAt: timestamp("paid_at", { withTimezone: true, mode: "string" }),
  confirmingAdminId: integer("confirming_admin_id").references(() => systemUsersTable.id, { onDelete: "set null" }),

  providerReference: text("provider_reference"),
  internalReceiptRef: text("internal_receipt_ref"),

  studentId: integer("student_id").references(() => studentsTable.id, { onDelete: "set null" }),
  childId: integer("child_id").references(() => childrenTable.id, { onDelete: "set null" }),

  creationIdempotencyKey: text("creation_idempotency_key"),

  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => ([
  unique("payment_records_flow_package_order_unique").on(table.flowType, table.packageOrderId),
  unique("payment_records_flow_booking_unique").on(table.flowType, table.bookingId),
  unique("payment_records_creation_idempotency_key_unique").on(table.creationIdempotencyKey),

  // ── Enum vocabularies ────────────────────────────────────────────────
  check("payment_records_flow_type_check", sql`${table.flowType} in ('package_purchase','single_class_booking','studio_walkin')`),
  check("payment_records_capture_origin_check", sql`${table.captureOrigin} in ('live_capture','historical_backfill')`),
  check("payment_records_evidence_class_check", sql`${table.evidenceClass} in ('confirmed','legacy_operational_status','unknown')`),
  check("payment_records_amount_availability_check", sql`${table.amountAvailability} in ('exact','estimated_backfill','unknown')`),
  check("payment_records_amount_source_check", sql`${table.amountSource} in ('creation_snapshot','catalog_price_at_backfill_time','unresolvable')`),
  check("payment_records_requested_channel_check", sql`${table.requestedPaymentChannel} is null or ${table.requestedPaymentChannel} in ('pay_at_studio','online','internal_credit','complimentary','unknown')`),
  check("payment_records_confirmed_method_check", sql`${table.confirmedPaymentMethod} is null or ${table.confirmedPaymentMethod} in ('cash','card','kashier','bank_transfer','unknown')`),
  check("payment_records_status_check", sql`${table.status} in ('unpaid','pending_confirmation','paid','partially_refunded','refunded','waived','failed','cancelled','legacy_unverified')`),
  check("payment_records_currency_check", sql`${table.currency} = 'EGP'`),

  // ── Source-to-flow-type binding, including the tombstone shape ────────
  check("payment_records_source_fk_matches_flow_type_check", sql`
    (${table.flowType} = 'package_purchase' and ${table.packageOrderId} is not null and ${table.bookingId} is null and ${table.sourceDeletedAt} is null)
    or (${table.flowType} in ('single_class_booking','studio_walkin') and ${table.bookingId} is not null and ${table.packageOrderId} is null and ${table.sourceDeletedAt} is null)
    or (${table.flowType} in ('single_class_booking','studio_walkin') and ${table.packageOrderId} is null and ${table.bookingId} is null and ${table.sourceDeletedAt} is not null)
  `),

  // ── Provenance ─────────────────────────────────────────────────────────
  check("payment_records_live_capture_confirmed_evidence_check", sql`${table.captureOrigin} <> 'live_capture' or ${table.evidenceClass} = 'confirmed'`),
  check("payment_records_backfill_not_confirmed_check", sql`${table.captureOrigin} <> 'historical_backfill' or ${table.evidenceClass} <> 'confirmed'`),
  check("payment_records_live_capture_no_batch_check", sql`${table.captureOrigin} <> 'live_capture' or ${table.backfillBatchId} is null`),
  check("payment_records_backfill_requires_batch_check", sql`${table.captureOrigin} <> 'historical_backfill' or ${table.backfillBatchId} is not null`),
  check("payment_records_live_capture_exact_check", sql`${table.captureOrigin} <> 'live_capture' or ${table.amountAvailability} = 'exact'`),
  check("payment_records_live_capture_snapshot_source_check", sql`${table.captureOrigin} <> 'live_capture' or ${table.amountSource} = 'creation_snapshot'`),

  // ── Amount provenance pairing ───────────────────────────────────────────
  check("payment_records_amount_provenance_pairing_check", sql`
    (${table.amountAvailability} = 'exact' and ${table.amountSource} = 'creation_snapshot')
    or (${table.amountAvailability} = 'estimated_backfill' and ${table.amountSource} = 'catalog_price_at_backfill_time')
    or (${table.amountAvailability} = 'unknown' and ${table.amountSource} = 'unresolvable')
  `),

  // ── Amount presence ──────────────────────────────────────────────────────
  check("payment_records_amounts_present_when_known_check", sql`
    ${table.amountAvailability} not in ('exact','estimated_backfill')
    or (${table.grossAmountMinor} is not null and ${table.discountAmountMinor} is not null and ${table.finalPayableAmountMinor} is not null)
  `),
  check("payment_records_amounts_null_when_unknown_check", sql`
    ${table.amountAvailability} <> 'unknown'
    or (${table.grossAmountMinor} is null and ${table.discountAmountMinor} is null and ${table.finalPayableAmountMinor} is null)
  `),

  // ── Arithmetic ─────────────────────────────────────────────────────────
  check("payment_records_gross_non_negative_check", sql`${table.grossAmountMinor} is null or ${table.grossAmountMinor} >= 0`),
  check("payment_records_discount_non_negative_check", sql`${table.discountAmountMinor} is null or ${table.discountAmountMinor} >= 0`),
  check("payment_records_discount_lte_gross_check", sql`${table.discountAmountMinor} is null or ${table.grossAmountMinor} is null or ${table.discountAmountMinor} <= ${table.grossAmountMinor}`),
  check("payment_records_final_payable_arithmetic_check", sql`
    ${table.finalPayableAmountMinor} is null
    or (${table.grossAmountMinor} is not null and ${table.discountAmountMinor} is not null
        and ${table.finalPayableAmountMinor} = ${table.grossAmountMinor} - ${table.discountAmountMinor})
  `),
  check("payment_records_paid_non_negative_check", sql`${table.paidAmountMinor} >= 0`),
  check("payment_records_refunded_non_negative_check", sql`${table.refundedAmountMinor} >= 0`),
  check("payment_records_paid_lte_final_payable_check", sql`${table.finalPayableAmountMinor} is null or ${table.paidAmountMinor} <= ${table.finalPayableAmountMinor}`),
  check("payment_records_refunded_lte_paid_check", sql`${table.refundedAmountMinor} <= ${table.paidAmountMinor}`),

  // ── Payment status matrix ────────────────────────────────────────────
  check("payment_records_status_inert_group_check", sql`
    ${table.status} not in ('unpaid','pending_confirmation','failed','cancelled') or (
      ${table.paidAmountMinor} = 0 and ${table.refundedAmountMinor} = 0
      and ${table.paidAt} is null and ${table.confirmingAdminId} is null and ${table.confirmedPaymentMethod} is null
    )
  `),
  check("payment_records_status_paid_check", sql`
    ${table.status} <> 'paid' or (
      ${table.captureOrigin} = 'live_capture' and ${table.evidenceClass} = 'confirmed' and ${table.amountAvailability} = 'exact'
      and ${table.finalPayableAmountMinor} > 0 and ${table.paidAmountMinor} = ${table.finalPayableAmountMinor}
      and ${table.refundedAmountMinor} = 0 and ${table.paidAt} is not null and ${table.confirmedPaymentMethod} is not null
    )
  `),
  check("payment_records_status_partially_refunded_check", sql`
    ${table.status} <> 'partially_refunded' or (
      ${table.captureOrigin} = 'live_capture' and ${table.evidenceClass} = 'confirmed' and ${table.amountAvailability} = 'exact'
      and ${table.paidAt} is not null and ${table.confirmedPaymentMethod} is not null
      and ${table.paidAmountMinor} = ${table.finalPayableAmountMinor}
      and ${table.refundedAmountMinor} > 0 and ${table.refundedAmountMinor} < ${table.paidAmountMinor}
    )
  `),
  check("payment_records_status_refunded_check", sql`
    ${table.status} <> 'refunded' or (
      ${table.captureOrigin} = 'live_capture' and ${table.evidenceClass} = 'confirmed' and ${table.amountAvailability} = 'exact'
      and ${table.paidAt} is not null and ${table.confirmedPaymentMethod} is not null
      and ${table.paidAmountMinor} = ${table.finalPayableAmountMinor}
      and ${table.paidAmountMinor} > 0 and ${table.refundedAmountMinor} = ${table.paidAmountMinor}
    )
  `),
  check("payment_records_status_waived_check", sql`
    ${table.status} <> 'waived' or (
      ${table.captureOrigin} = 'live_capture' and ${table.evidenceClass} = 'confirmed' and ${table.amountAvailability} = 'exact'
      and ${table.requestedPaymentChannel} = 'complimentary'
      and ${table.grossAmountMinor} = ${table.discountAmountMinor} and ${table.finalPayableAmountMinor} = 0
      and ${table.paidAmountMinor} = 0 and ${table.refundedAmountMinor} = 0
      and ${table.paidAt} is null and ${table.confirmingAdminId} is null and ${table.confirmedPaymentMethod} is null
    )
  `),
  check("payment_records_status_legacy_unverified_check", sql`
    ${table.status} <> 'legacy_unverified' or (
      ${table.captureOrigin} = 'historical_backfill' and ${table.evidenceClass} = 'legacy_operational_status'
      and ${table.paidAmountMinor} = 0 and ${table.refundedAmountMinor} = 0
      and ${table.paidAt} is null and ${table.confirmingAdminId} is null and ${table.confirmedPaymentMethod} is null
      and ${table.amountAvailability} in ('exact','estimated_backfill','unknown')
    )
  `),
  check("payment_records_backfill_excludes_paid_waived_check", sql`${table.captureOrigin} <> 'historical_backfill' or ${table.status} not in ('paid','waived')`),
  check("payment_records_paid_waived_require_live_capture_check", sql`${table.status} not in ('paid','waived') or ${table.captureOrigin} = 'live_capture'`),
]));

export type PaymentRecord = typeof paymentRecordsTable.$inferSelect;
export type InsertPaymentRecord = typeof paymentRecordsTable.$inferInsert;
