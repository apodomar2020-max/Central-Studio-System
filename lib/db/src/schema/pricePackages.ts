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
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
});

export const insertPricePackageSchema = createInsertSchema(pricePackagesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPricePackage = z.infer<typeof insertPricePackageSchema>;
export type PricePackage = typeof pricePackagesTable.$inferSelect;
