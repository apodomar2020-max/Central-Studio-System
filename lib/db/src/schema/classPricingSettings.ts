import { integer, pgTable, timestamp } from "drizzle-orm/pg-core";

export const classPricingSettingsTable = pgTable("class_pricing_settings", {
  id: integer("id").primaryKey().default(1),
  singleClassPriceEgp: integer("single_class_price_egp").notNull().default(300),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
});

export type ClassPricingSettings = typeof classPricingSettingsTable.$inferSelect;
