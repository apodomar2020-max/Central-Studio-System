import { check, index, integer, pgTable, serial, text, timestamp, type AnyPgColumn, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { packageCreditLotsTable } from "./packageCreditLots";
import { creditTransactionsTable } from "./creditTransactions";
import { packageOrdersTable } from "./packageOrders";
import { attendanceTable } from "./attendance";
import { bookingsTable } from "./bookings";
import { schedulesTable } from "./schedules";
import { studioBranchesTable, studioRoomsTable } from "./studioBranches";
import { paymentRefundsTable } from "./paymentRefunds";

export const PACKAGE_CREDIT_ALLOCATION_EVENT_TYPES = [
  "consumption",
  "expiration",
  "reversal",
  "refund_retirement",
] as const;

/**
 * Dark Finance foundation: append-only allocation event shape. Phase A adds
 * no writer and no database trigger; append-only write behavior begins in a
 * later explicitly approved phase.
 */
export const packageCreditAllocationsTable = pgTable("package_credit_allocations", {
  id: serial("id").primaryKey(),
  lotId: integer("lot_id").notNull().references(() => packageCreditLotsTable.id, { onDelete: "restrict" }),
  eventType: text("event_type").notNull(),
  creditTransactionId: integer("credit_transaction_id").notNull().references(() => creditTransactionsTable.id, { onDelete: "restrict" }),
  packageOrderId: integer("package_order_id").notNull().references(() => packageOrdersTable.id, { onDelete: "restrict" }),
  paymentRefundId: integer("payment_refund_id").references(() => paymentRefundsTable.id, { onDelete: "restrict" }),
  attendanceId: integer("attendance_id").references(() => attendanceTable.id, { onDelete: "restrict" }),
  bookingId: integer("booking_id").references(() => bookingsTable.id, { onDelete: "restrict" }),
  scheduleId: integer("schedule_id").references(() => schedulesTable.id, { onDelete: "restrict" }),
  branchId: integer("branch_id").references(() => studioBranchesTable.id, { onDelete: "restrict" }),
  roomId: integer("room_id").references(() => studioRoomsTable.id, { onDelete: "restrict" }),
  credits: integer("credits").notNull(),
  unitValueMinor: integer("unit_value_minor"),
  totalValueMinor: integer("total_value_minor").notNull().default(0),
  valueBasis: text("value_basis").notNull(),
  policyVersion: text("policy_version").notNull(),
  reversesAllocationId: integer("reverses_allocation_id").references((): AnyPgColumn => packageCreditAllocationsTable.id, { onDelete: "restrict" }),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  notes: text("notes"),
}, (table) => ([
  uniqueIndex("package_credit_allocations_credit_transaction_unique").on(table.creditTransactionId),
  uniqueIndex("package_credit_allocations_consumption_attendance_unique")
    .on(table.attendanceId)
    .where(sql`${table.eventType} = 'consumption' and ${table.attendanceId} is not null`),
  uniqueIndex("package_credit_allocations_refund_lot_unique")
    .on(table.paymentRefundId, table.lotId)
    .where(sql`${table.eventType} = 'refund_retirement'`),
  index("package_credit_allocations_lot_id_idx").on(table.lotId),
  index("package_credit_allocations_package_order_id_idx").on(table.packageOrderId),
  index("package_credit_allocations_schedule_id_idx").on(table.scheduleId),
  index("package_credit_allocations_branch_id_idx").on(table.branchId),
  check("package_credit_allocations_event_type_check", sql`${table.eventType} in ('consumption','expiration','reversal','refund_retirement')`),
  check("package_credit_allocations_credits_positive_check", sql`${table.credits} > 0`),
  check("package_credit_allocations_total_value_non_negative_check", sql`${table.totalValueMinor} >= 0`),
  check("package_credit_allocations_value_basis_check", sql`${table.valueBasis} in ('recorded_purchase_price','estimated_catalog_price','unknown')`),
  check("package_credit_allocations_refund_linkage_check", sql`
    (${table.eventType} = 'refund_retirement' and ${table.paymentRefundId} is not null)
    or (${table.eventType} <> 'refund_retirement' and ${table.paymentRefundId} is null)
  `),
]));

export type PackageCreditAllocation = typeof packageCreditAllocationsTable.$inferSelect;
export type InsertPackageCreditAllocation = typeof packageCreditAllocationsTable.$inferInsert;
