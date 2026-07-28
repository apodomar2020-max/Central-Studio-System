/**
 * Credit Transactions Ledger
 *
 * Every change to a package's credit balance is recorded here as an immutable
 * row. The `packageOrders.remainingCredits` column is the fast read path;
 * this table is the authoritative audit trail.
 *
 * Types:
 *   package_activated    – credits granted when admin activates an order
 *   attendance_deduction – 1 credit removed on a confirmed check-in
 *   manual_adjustment    – admin override (add or remove arbitrary credits)
 *   package_bonus        – promotional credits added (e.g. referral reward)
 *   package_refund       – credits restored when a booking is cancelled
 */

import { check, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { childrenTable } from "./children";
import { bookingsTable } from "./bookings";
import { attendanceTable } from "./attendance";

export const creditTransactionsTable = pgTable("credit_transactions", {
  id: serial("id").primaryKey(),

  // Which package order this transaction belongs to
  packageOrderId: integer("package_order_id").notNull(),

  // The student who owns the package (nullable for legacy / admin-created orders
  // where studentId wasn't captured at order time)
  studentId: integer("student_id"),
  participantType: text("participant_type"),
  participantChildId: integer("participant_child_id").references(() => childrenTable.id, { onDelete: "set null" }),

  // Transaction type (see jsdoc above)
  type: text("type").notNull(),

  // Signed credit change. Positive = credits added, negative = credits removed.
  // Examples: +8 for package activation, -1 for attendance deduction, +1 for refund.
  delta: integer("delta").notNull(),

  // Snapshot of remainingCredits immediately before and after this transaction.
  // Allows reconstructing the full balance history and detecting drift.
  balanceBefore: integer("balance_before").notNull(),
  balanceAfter: integer("balance_after").notNull(),

  // Optional back-reference to the record that caused the transaction
  // (e.g. attendance.id for deductions, bookings.id for refunds)
  referenceId: integer("reference_id"),
  referenceType: text("reference_type"), // "attendance" | "booking" | null
  bookingId: integer("booking_id").references(() => bookingsTable.id, { onDelete: "set null" }),
  attendanceId: integer("attendance_id").references(() => attendanceTable.id, { onDelete: "set null" }),

  // Human-readable context (admin note, system event name, etc.)
  notes: text("notes"),

  // Who triggered this: admin email, "system", or "mobile:check-in"
  createdBy: text("created_by").notNull().default("system"),

  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
}, (table) => ([
  // Finance Phase 2A DB hardening: at most one package_activated row per
  // package order, enforced at the database level (independent of the
  // application-level FOR UPDATE guard in packageOrders.ts).
  uniqueIndex("credit_transactions_one_package_activation_idx")
    .on(table.packageOrderId)
    .where(sql`${table.type} = 'package_activated'`),
  check("credit_transactions_participant_shape_check", sql`
    (${table.participantType} is null and ${table.participantChildId} is null)
    or (${table.participantType} is not null and ${table.participantType} = 'self' and ${table.participantChildId} is null)
    or (${table.participantType} is not null and ${table.participantType} = 'child' and ${table.participantChildId} is not null)
  `),
  index("credit_transactions_package_created_at_idx").on(table.packageOrderId, table.createdAt),
  index("credit_transactions_participant_child_created_at_idx").on(table.participantChildId, table.createdAt),
  index("credit_transactions_booking_id_idx").on(table.bookingId),
  index("credit_transactions_attendance_id_idx").on(table.attendanceId),
]));

export type CreditTransaction = typeof creditTransactionsTable.$inferSelect;
export type InsertCreditTransaction = typeof creditTransactionsTable.$inferInsert;
