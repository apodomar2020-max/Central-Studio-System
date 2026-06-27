import { boolean, integer, pgTable, real, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const pricePackagesTable = pgTable("price_packages", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull().default("per_class"),
  priceEgp: real("price_egp").notNull(),
  sessions: integer("sessions"),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  isFeatured: boolean("is_featured").notNull().default(false),
  // How many months from purchase until the package expires
  validityMonths: integer("validity_months").notNull().default(6),
  // Per-class price shown on the card (optional override; calculated from priceEgp/sessions if null)
  singleClassPriceEgp: real("single_class_price_egp"),
  // Empty array means all dance types; non-empty restricts to the listed styles
  allowedDanceTypes: text("allowed_dance_types").array().notNull().default([]),
  // Up to 3 short selling-point bullets shown on the package card (CMS-managed)
  features: text("features").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
});

export const insertPricePackageSchema = createInsertSchema(pricePackagesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPricePackage = z.infer<typeof insertPricePackageSchema>;
export type PricePackage = typeof pricePackagesTable.$inferSelect;
