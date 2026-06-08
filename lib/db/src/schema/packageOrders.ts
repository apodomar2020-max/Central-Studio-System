import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const packageOrdersTable = pgTable("package_orders", {
  id: serial("id").primaryKey(),
  studentName: text("student_name").notNull(),
  studentEmail: text("student_email").notNull(),
  studentPhone: text("student_phone"),
  packageId: integer("package_id"),
  packageName: text("package_name").notNull(),
  totalCredits: integer("total_credits").notNull(),
  remainingCredits: integer("remaining_credits").notNull(),
  status: text("status").notNull().default("pendingPayment"),
  notes: text("notes"),
  activatedAt: timestamp("activated_at", { withTimezone: true, mode: "string" }),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
});

export const insertPackageOrderSchema = createInsertSchema(packageOrdersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPackageOrder = z.infer<typeof insertPackageOrderSchema>;
export type PackageOrder = typeof packageOrdersTable.$inferSelect;
