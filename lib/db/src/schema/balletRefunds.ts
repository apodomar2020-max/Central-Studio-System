import { check, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { balletApplicationsTable } from "./balletApplications";
import { balletEnrollmentCancellationRequestsTable } from "./balletEnrollmentCancellations";
import { balletLevelAssignmentsTable } from "./balletLevelAssignments";
import { balletPaymentsTable } from "./balletPayments";
import { studentsTable } from "./students";
import { systemUsersTable } from "./systemUsers";

export const BALLET_REFUND_STATUSES = [
  "underReview",
  "approved",
  "rejected",
  "processing",
  "refunded",
  "failed",
  "withdrawn",
] as const;

export type BalletRefundStatus = (typeof BALLET_REFUND_STATUSES)[number];

export const BALLET_REFUND_METHODS = [
  "cash",
  "originalPaymentMethod",
] as const;

export type BalletRefundMethod = (typeof BALLET_REFUND_METHODS)[number];

export const balletRefundsTable = pgTable("ballet_refunds", {
  id: serial("id").primaryKey(),
  cancellationRequestId: integer("cancellation_request_id").references(() => balletEnrollmentCancellationRequestsTable.id, { onDelete: "set null" }),
  applicationId: integer("application_id").notNull().references(() => balletApplicationsTable.id, { onDelete: "restrict" }),
  levelAssignmentId: integer("level_assignment_id").references(() => balletLevelAssignmentsTable.id, { onDelete: "set null" }),
  paymentId: integer("payment_id").notNull().references(() => balletPaymentsTable.id, { onDelete: "restrict" }),
  parentStudentId: integer("parent_student_id").references(() => studentsTable.id, { onDelete: "set null" }),
  status: text("status").notNull().default("underReview"),
  refundMethod: text("refund_method").notNull(),
  requestedReason: text("requested_reason").notNull(),
  requestedAmountEgp: integer("requested_amount_egp"),
  approvedAmountEgp: integer("approved_amount_egp"),
  refundedAmountEgp: integer("refunded_amount_egp"),
  transactionReference: text("transaction_reference"),
  adminNotes: text("admin_notes"),
  failedReason: text("failed_reason"),
  reviewedByAdminId: integer("reviewed_by_admin_id").references(() => systemUsersTable.id, { onDelete: "set null" }),
  processedByAdminId: integer("processed_by_admin_id").references(() => systemUsersTable.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "string" }),
  processedAt: timestamp("processed_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
}, (table) => ([
  uniqueIndex("ballet_refunds_open_payment_idx")
    .on(table.paymentId)
    .where(sql`${table.status} in ('underReview','approved','processing')`),
  index("ballet_refunds_cancellation_request_idx").on(table.cancellationRequestId),
  index("ballet_refunds_application_idx").on(table.applicationId),
  index("ballet_refunds_payment_idx").on(table.paymentId),
  index("ballet_refunds_status_idx").on(table.status),
  check("ballet_refunds_requested_amount_positive", sql`${table.requestedAmountEgp} is null or ${table.requestedAmountEgp} > 0`),
  check("ballet_refunds_approved_amount_positive", sql`${table.approvedAmountEgp} is null or ${table.approvedAmountEgp} > 0`),
  check("ballet_refunds_refunded_amount_positive", sql`${table.refundedAmountEgp} is null or ${table.refundedAmountEgp} > 0`),
  check("ballet_refunds_status_check", sql`${table.status} in ('underReview','approved','rejected','processing','refunded','failed','withdrawn')`),
  check("ballet_refunds_supported_method", sql`${table.refundMethod} in ('cash','originalPaymentMethod')`),
]));

export type BalletRefund = typeof balletRefundsTable.$inferSelect;
