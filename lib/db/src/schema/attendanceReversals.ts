import { check, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { attendanceTable } from "./attendance";
import { bookingsTable } from "./bookings";
import { creditTransactionsTable } from "./creditTransactions";
import { packageCreditAllocationsTable } from "./packageCreditAllocations";
import { packageCreditLotsTable } from "./packageCreditLots";
import { packageOrdersTable } from "./packageOrders";

export const ATTENDANCE_REVERSAL_STATUSES = ["requested", "approved", "rejected", "completed", "failed"] as const;

/** Audit/idempotency foundation only. Phase F1 adds no reversal writer. */
export const attendanceReversalsTable = pgTable("attendance_reversals", {
  id: serial("id").primaryKey(),
  attendanceId: integer("attendance_id").notNull().references(() => attendanceTable.id, { onDelete: "restrict" }),
  originalConsumptionAllocationId: integer("original_consumption_allocation_id").notNull().references(() => packageCreditAllocationsTable.id, { onDelete: "restrict" }),
  packageOrderId: integer("package_order_id").notNull().references(() => packageOrdersTable.id, { onDelete: "restrict" }),
  bookingId: integer("booking_id").references(() => bookingsTable.id, { onDelete: "restrict" }),
  status: text("status").notNull(),
  requestIdempotencyKey: text("request_idempotency_key").notNull(),
  reasonCode: text("reason_code").notNull(),
  reason: text("reason").notNull(),
  requestedBy: text("requested_by").notNull(),
  approvedBy: text("approved_by"),
  completedBy: text("completed_by"),
  rejectedBy: text("rejected_by"),
  failedBy: text("failed_by"),
  requestedAt: timestamp("requested_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
  rejectedAt: timestamp("rejected_at", { withTimezone: true, mode: "string" }),
  failedAt: timestamp("failed_at", { withTimezone: true, mode: "string" }),
  resultingCreditTransactionId: integer("resulting_credit_transaction_id").references(() => creditTransactionsTable.id, { onDelete: "restrict" }),
  resultingReversalAllocationId: integer("resulting_reversal_allocation_id").references(() => packageCreditAllocationsTable.id, { onDelete: "restrict" }),
  resultingRestoredLotId: integer("resulting_restored_lot_id").references(() => packageCreditLotsTable.id, { onDelete: "restrict" }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
}, (table) => ([
  uniqueIndex("attendance_reversals_request_idempotency_unique").on(table.requestIdempotencyKey),
  uniqueIndex("attendance_reversals_completed_attendance_unique").on(table.attendanceId).where(sql`${table.status} = 'completed'`),
  uniqueIndex("attendance_reversals_completed_consumption_unique").on(table.originalConsumptionAllocationId).where(sql`${table.status} = 'completed'`),
  uniqueIndex("attendance_reversals_resulting_transaction_unique").on(table.resultingCreditTransactionId).where(sql`${table.resultingCreditTransactionId} is not null`),
  uniqueIndex("attendance_reversals_resulting_allocation_unique").on(table.resultingReversalAllocationId).where(sql`${table.resultingReversalAllocationId} is not null`),
  uniqueIndex("attendance_reversals_resulting_lot_unique").on(table.resultingRestoredLotId).where(sql`${table.resultingRestoredLotId} is not null`),
  check("attendance_reversals_status_check", sql`${table.status} in ('requested','approved','rejected','completed','failed')`),
  check("attendance_reversals_reason_code_not_blank_check", sql`btrim(${table.reasonCode}) <> ''`),
  check("attendance_reversals_reason_not_blank_check", sql`btrim(${table.reason}) <> ''`),
  check("attendance_reversals_requested_by_not_blank_check", sql`btrim(${table.requestedBy}) <> ''`),
  check("attendance_reversals_approved_shape_check", sql`${table.status} <> 'approved' or (${table.approvedBy} is not null and ${table.approvedAt} is not null)`),
  check("attendance_reversals_rejected_shape_check", sql`${table.status} <> 'rejected' or (${table.rejectedBy} is not null and ${table.rejectedAt} is not null)`),
  check("attendance_reversals_failed_shape_check", sql`${table.status} <> 'failed' or (${table.failedBy} is not null and ${table.failedAt} is not null)`),
  check("attendance_reversals_completed_shape_check", sql`${table.status} <> 'completed' or (
    ${table.completedBy} is not null and ${table.completedAt} is not null
    and ${table.resultingCreditTransactionId} is not null
    and ${table.resultingReversalAllocationId} is not null
    and ${table.resultingRestoredLotId} is not null
  )`),
  check("attendance_reversals_results_completed_only_check", sql`${table.status} = 'completed' or (
    ${table.resultingCreditTransactionId} is null
    and ${table.resultingReversalAllocationId} is null
    and ${table.resultingRestoredLotId} is null
  )`),
]));

export type AttendanceReversal = typeof attendanceReversalsTable.$inferSelect;
export type InsertAttendanceReversal = typeof attendanceReversalsTable.$inferInsert;
