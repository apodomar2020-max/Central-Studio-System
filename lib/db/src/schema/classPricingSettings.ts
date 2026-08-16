import { integer, pgTable, timestamp } from "drizzle-orm/pg-core";

export const classPricingSettingsTable = pgTable("class_pricing_settings", {
  id: integer("id").primaryKey().default(1),
  // Legacy Studio-wide fallback — kept as the final fallback step in the
  // resolver so older data/clients never lose a price. Not removed.
  singleClassPriceEgp: integer("single_class_price_egp").notNull().default(300),
  // Category walk-in prices (Adults / Teens / Kids). Nullable: null means
  // "not yet configured for this category", in which case the resolver falls
  // through to singleClassPriceEgp. See singleClassPricing.ts.
  adultsWalkinPriceEgp: integer("adults_walkin_price_egp"),
  teensWalkinPriceEgp: integer("teens_walkin_price_egp"),
  kidsWalkinPriceEgp: integer("kids_walkin_price_egp"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
});

export type ClassPricingSettings = typeof classPricingSettingsTable.$inferSelect;
