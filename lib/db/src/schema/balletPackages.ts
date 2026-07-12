import { boolean, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * ballet_packages — admin-managed pricing packages for the Ballet system.
 *
 * Will eventually replace the flat preBallet/levels pricing fields on
 * ballet_settings (those fields are kept for now and removed in a later step).
 *
 * Which levels a package applies to is tracked via the ballet_package_levels
 * join table (many-to-many).
 */
export const balletPackagesTable = pgTable("ballet_packages", {
  id:             serial("id").primaryKey(),
  name:           text("name").notNull(),
  monthlyClasses: integer("monthly_classes").notNull(),
  monthlyHours:   integer("monthly_hours").notNull(),
  priceEgp:       integer("price_egp").notNull(),
  isActive:       boolean("is_active").notNull().default(true),
  createdAt:      timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
});

export const insertBalletPackageSchema = createInsertSchema(balletPackagesTable).omit({
  id: true, createdAt: true, updatedAt: true,
});

export const updateBalletPackageSchema = insertBalletPackageSchema.partial();

export type BalletPackage = typeof balletPackagesTable.$inferSelect;
export type InsertBalletPackage = z.infer<typeof insertBalletPackageSchema>;
export type UpdateBalletPackage = z.infer<typeof updateBalletPackageSchema>;
