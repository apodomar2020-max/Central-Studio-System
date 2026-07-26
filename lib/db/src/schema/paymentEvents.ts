/**
 * Payment Events — Finance Phase 2A DB foundation (dark, append-only ledger).
 *
 * No writer exists yet. No payment/refund route, live event writer, or
 * dual-write path exists in this repository today — this table is locked
 * here, dark, so a future write path has an exact, already-tested contract
 * to build against.
 *
 * Append-only: `payment_events_append_only` rejects every UPDATE and DELETE
 * unconditionally — there is no bypass marker, unlike payment_records'
 * source-tombstone guard. A payment event, once written, is permanent.
 *
 * The composite FK (paymentRefundId, paymentRecordId) -> payment_refunds
 * (id, paymentRecordId) guarantees a payment event can never reference a
 * refund row belonging to a DIFFERENT payment record than the event's own
 * paymentRecordId — a plain single-column FK to payment_refunds(id) alone
 * could not express that cross-column agreement. drizzle-orm@0.45.2's
 * `foreignKey()` helper supports true multi-column composite FKs (confirmed
 * directly against this repo's installed version), so this is a genuine
 * composite FK here, not two independent single-column FKs standing in for
 * one — the literal migration SQL and this Drizzle definition express the
 * identical constraint.
 */
import { check, foreignKey, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { paymentRecordsTable } from "./paymentRecords";
import { paymentRefundsTable } from "./paymentRefunds";
import { creditTransactionsTable } from "./creditTransactions";
import { systemUsersTable } from "./systemUsers";

export const PAYMENT_EVENT_TYPES = [
  "created",
  "created_and_confirmed",
  "confirmed",
  "method_changed",
  "activation_credits_issued",
  "waived",
  "failed",
  "cancelled",
  "voided",
  "refund_payout_completed",
  "legacy_created",
] as const;
export type PaymentEventType = (typeof PAYMENT_EVENT_TYPES)[number];

export const PAYMENT_EVENT_ACTOR_TYPES = [
  "admin",
  "system",
  "student",
] as const;
export type PaymentEventActorType = (typeof PAYMENT_EVENT_ACTOR_TYPES)[number];

/** Mirrors PAYMENT_RECORD_STATUSES in paymentRecords.ts. */
export const PAYMENT_EVENT_STATUS_VALUES = [
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

export const paymentEventsTable = pgTable("payment_events", {
  id: serial("id").primaryKey(),

  paymentRecordId: integer("payment_record_id").notNull().references(() => paymentRecordsTable.id, { onDelete: "restrict" }),

  paymentRefundId: integer("payment_refund_id"),

  eventType: text("event_type").notNull(),
  amountMinor: integer("amount_minor"),
  previousStatus: text("previous_status"),
  newStatus: text("new_status").notNull(),

  creditTransactionId: integer("credit_transaction_id").references(() => creditTransactionsTable.id, { onDelete: "restrict" }),

  actorAdminId: integer("actor_admin_id").references(() => systemUsersTable.id, { onDelete: "set null" }),
  actorType: text("actor_type").notNull().default("admin"),
  reason: text("reason"),
  providerReference: text("provider_reference"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),

  idempotencyKey: text("idempotency_key"),

  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => ([
  foreignKey({
    name: "payment_events_refund_payment_fk",
    columns: [table.paymentRefundId, table.paymentRecordId],
    foreignColumns: [paymentRefundsTable.id, paymentRefundsTable.paymentRecordId],
  }).onDelete("restrict"),

  uniqueIndex("payment_events_idempotency_key_idx")
    .on(table.idempotencyKey)
    .where(sql`${table.idempotencyKey} is not null`),
  uniqueIndex("payment_events_provider_reference_idx")
    .on(table.eventType, table.providerReference)
    .where(sql`${table.providerReference} is not null`),

  // ── Vocabularies ─────────────────────────────────────────────────────
  check("payment_events_event_type_check", sql`${table.eventType} in ('created','created_and_confirmed','confirmed','method_changed','activation_credits_issued','waived','failed','cancelled','voided','refund_payout_completed','legacy_created')`),
  check("payment_events_actor_type_check", sql`${table.actorType} in ('admin','system','student')`),
  check("payment_events_previous_status_check", sql`${table.previousStatus} is null or ${table.previousStatus} in ('unpaid','pending_confirmation','paid','partially_refunded','refunded','waived','failed','cancelled','legacy_unverified')`),
  check("payment_events_new_status_check", sql`${table.newStatus} in ('unpaid','pending_confirmation','paid','partially_refunded','refunded','waived','failed','cancelled','legacy_unverified')`),
  check("payment_events_amount_non_negative_check", sql`${table.amountMinor} is null or ${table.amountMinor} >= 0`),

  // ── Reference exclusivity ────────────────────────────────────────────
  check("payment_events_credit_transaction_exclusive_check", sql`
    (${table.eventType} = 'activation_credits_issued' and ${table.creditTransactionId} is not null)
    or (${table.eventType} <> 'activation_credits_issued' and ${table.creditTransactionId} is null)
  `),
  check("payment_events_refund_reference_exclusive_check", sql`
    (${table.eventType} = 'refund_payout_completed' and ${table.paymentRefundId} is not null)
    or (${table.eventType} <> 'refund_payout_completed' and ${table.paymentRefundId} is null)
  `),

  // ── Full event-shape matrix ──────────────────────────────────────────
  check("payment_events_created_shape_check", sql`
    ${table.eventType} <> 'created' or (
      ${table.previousStatus} is null and ${table.amountMinor} is null
      and ${table.newStatus} in ('unpaid','pending_confirmation')
    )
  `),
  check("payment_events_created_and_confirmed_shape_check", sql`
    ${table.eventType} <> 'created_and_confirmed' or (
      ${table.previousStatus} is null and ${table.amountMinor} is not null and ${table.amountMinor} > 0 and ${table.newStatus} = 'paid'
    )
  `),
  check("payment_events_confirmed_shape_check", sql`
    ${table.eventType} <> 'confirmed' or (
      ${table.previousStatus} in ('unpaid','pending_confirmation','failed')
      and ${table.amountMinor} is not null and ${table.amountMinor} > 0 and ${table.newStatus} = 'paid'
    )
  `),
  check("payment_events_method_changed_shape_check", sql`
    ${table.eventType} <> 'method_changed' or (
      ${table.previousStatus} is not null and ${table.previousStatus} = ${table.newStatus}
      and ${table.amountMinor} is null
    )
  `),
  check("payment_events_activation_credits_issued_shape_check", sql`
    ${table.eventType} <> 'activation_credits_issued' or (
      ${table.previousStatus} = 'paid' and ${table.newStatus} = 'paid' and ${table.amountMinor} is null
    )
  `),
  check("payment_events_waived_shape_check", sql`
    ${table.eventType} <> 'waived' or (
      ${table.previousStatus} is null and ${table.amountMinor} is not null and ${table.amountMinor} = 0 and ${table.newStatus} = 'waived'
    )
  `),
  check("payment_events_failed_shape_check", sql`
    ${table.eventType} <> 'failed' or (
      ${table.previousStatus} in ('unpaid','pending_confirmation')
      and ${table.amountMinor} is null and ${table.newStatus} = 'failed'
    )
  `),
  check("payment_events_cancelled_shape_check", sql`
    ${table.eventType} <> 'cancelled' or (
      ${table.previousStatus} in ('unpaid','pending_confirmation','failed')
      and ${table.amountMinor} is null and ${table.newStatus} = 'cancelled'
    )
  `),
  check("payment_events_voided_shape_check", sql`
    ${table.eventType} <> 'voided' or (
      ${table.previousStatus} in ('unpaid','pending_confirmation','failed','waived')
      and ${table.amountMinor} is null and ${table.newStatus} = 'cancelled'
    )
  `),
  check("payment_events_refund_payout_completed_shape_check", sql`
    ${table.eventType} <> 'refund_payout_completed' or (
      ${table.previousStatus} in ('paid','partially_refunded')
      and ${table.amountMinor} is not null and ${table.amountMinor} > 0 and ${table.newStatus} in ('partially_refunded','refunded')
    )
  `),
  // Finance Phase 2D: dedicated event for historical-backfill record
  // creation. Kept fully separate from `created` — see migration 0081.
  check("payment_events_legacy_created_shape_check", sql`
    ${table.eventType} <> 'legacy_created' or (
      ${table.previousStatus} is null and ${table.amountMinor} is null
      and ${table.newStatus} = 'legacy_unverified'
    )
  `),
]));

export type PaymentEvent = typeof paymentEventsTable.$inferSelect;
export type InsertPaymentEvent = typeof paymentEventsTable.$inferInsert;
