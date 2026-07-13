import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { BALLET_PAYMENT_STATUSES, type BalletPaymentStatus } from "@workspace/api-zod";
import { balletApplicationsTable } from "./balletApplications";
import { balletLevelAssignmentsTable } from "./balletLevelAssignments";
import { balletPackagesTable } from "./balletPackages";
import { packageOrdersTable } from "./packageOrders";

// Canonical source of truth moved to @workspace/api-zod (Phase A / P0-2b) so
// frontend packages can import the same literals instead of retyping them.
// Re-exported here so existing `from "@workspace/db/schema/balletPayments"`
// imports keep working unchanged.
export { BALLET_PAYMENT_STATUSES };
export type { BalletPaymentStatus };

/**
 * Payment methods (A7) — a small fixed set treated as an enum at the
 * application layer only (no DB CHECK constraint, matching this table's
 * existing convention). This records HOW a manually-entered payment was
 * taken; it is NOT a payment-gateway integration.
 */
export const BALLET_PAYMENT_METHODS = ["bankTransfer", "kashier", "inPerson"] as const;
export type BalletPaymentMethod = (typeof BALLET_PAYMENT_METHODS)[number];

/**
 * ballet_payments — one row per payment tied to a ballet application.
 *
 * Status machine:
 *   pending → paid → refunded
 *           ↘ rejected
 */
export const balletPaymentsTable = pgTable("ballet_payments", {
  id:                serial("id").primaryKey(),
  applicationId:     integer("application_id").notNull().references(() => balletApplicationsTable.id, { onDelete: "cascade" }),
  levelAssignmentId: integer("level_assignment_id").references(() => balletLevelAssignmentsTable.id, { onDelete: "set null" }),
  packageId:         integer("package_id").references(() => balletPackagesTable.id, { onDelete: "set null" }),
  packageOrderId:    integer("package_order_id").references(() => packageOrdersTable.id, { onDelete: "set null" }),
  amountEgp:         integer("amount_egp").notNull(),
  status:            text("status").notNull().default("pending"), // pending | rejected | paid | refunded
  // A7: how the payment was taken. App-layer enum (BALLET_PAYMENT_METHODS):
  // bankTransfer | kashier | inPerson. Nullable, no DB CHECK.
  paymentMethod:     text("payment_method"),
  paidAt:            timestamp("paid_at", { withTimezone: true, mode: "string" }),
  refundedAt:        timestamp("refunded_at", { withTimezone: true, mode: "string" }),
  notes:             text("notes"),
  createdAt:         timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
});

export const insertBalletPaymentSchema = createInsertSchema(balletPaymentsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});

export const updateBalletPaymentSchema = insertBalletPaymentSchema.partial();

export type BalletPayment = typeof balletPaymentsTable.$inferSelect;
export type InsertBalletPayment = z.infer<typeof insertBalletPaymentSchema>;
export type UpdateBalletPayment = z.infer<typeof updateBalletPaymentSchema>;
