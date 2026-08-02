import { check, index, integer, pgTable, serial, text, timestamp, type AnyPgColumn, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { packageOrdersTable } from "./packageOrders";
import { creditTransactionsTable } from "./creditTransactions";
import { packageCreditAllocationsTable } from "./packageCreditAllocations";

export const PACKAGE_CREDIT_LOT_SOURCE_TYPES = [
  "purchased",
  "bonus",
  "manual_complimentary",
  "manual_paid",
  "restored",
  "legacy_unknown",
] as const;

export const PACKAGE_CREDIT_VALUE_BASES = [
  "recorded_purchase_price",
  "estimated_catalog_price",
  "unknown",
] as const;

/**
 * Dark Finance foundation: origin lots for package credits. No application
 * writer exists in Phase A; credit_transactions remains the operational
 * balance ledger.
 */
export const packageCreditLotsTable = pgTable("package_credit_lots", {
  id: serial("id").primaryKey(),
  packageOrderId: integer("package_order_id").notNull().references(() => packageOrdersTable.id, { onDelete: "restrict" }),
  sourceType: text("source_type").notNull(),
  creditsIssued: integer("credits_issued").notNull(),
  creditsRemaining: integer("credits_remaining").notNull(),
  totalValueMinor: integer("total_value_minor"),
  valueBasis: text("value_basis").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }),
  issuingCreditTransactionId: integer("issuing_credit_transaction_id").notNull().references(() => creditTransactionsTable.id, { onDelete: "restrict" }),
  restoredFromAllocationId: integer("restored_from_allocation_id").references((): AnyPgColumn => packageCreditAllocationsTable.id, { onDelete: "restrict" }),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  notes: text("notes"),
}, (table) => ([
  uniqueIndex("package_credit_lots_issuing_transaction_unique").on(table.issuingCreditTransactionId),
  index("package_credit_lots_package_order_id_idx").on(table.packageOrderId),
  index("package_credit_lots_source_type_idx").on(table.sourceType),
  index("package_credit_lots_remaining_idx").on(table.creditsRemaining).where(sql`${table.creditsRemaining} > 0`),
  index("package_credit_lots_expires_at_remaining_idx").on(table.expiresAt).where(sql`${table.creditsRemaining} > 0`),
  check("package_credit_lots_source_type_check", sql`${table.sourceType} in ('purchased','bonus','manual_complimentary','manual_paid','restored','legacy_unknown')`),
  check("package_credit_lots_credits_issued_positive_check", sql`${table.creditsIssued} > 0`),
  check("package_credit_lots_credits_remaining_range_check", sql`${table.creditsRemaining} >= 0 and ${table.creditsRemaining} <= ${table.creditsIssued}`),
  check("package_credit_lots_total_value_non_negative_check", sql`${table.totalValueMinor} is null or ${table.totalValueMinor} >= 0`),
  check("package_credit_lots_value_basis_check", sql`${table.valueBasis} in ('recorded_purchase_price','estimated_catalog_price','unknown')`),
]));

export type PackageCreditLot = typeof packageCreditLotsTable.$inferSelect;
export type InsertPackageCreditLot = typeof packageCreditLotsTable.$inferInsert;
