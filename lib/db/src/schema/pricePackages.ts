import { boolean, check, integer, pgTable, real, serial, smallint, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
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
  allowAllAges: boolean("allow_all_ages"),
  minAge: smallint("min_age"),
  maxAge: smallint("max_age"),
  // How many months from purchase until the package expires
  validityMonths: integer("validity_months").notNull().default(6),
  // Per-class price shown on the card (optional override; calculated from priceEgp/sessions if null)
  singleClassPriceEgp: real("single_class_price_egp"),
  // Empty array means all dance types; non-empty restricts to the listed styles
  allowedDanceTypes: text("allowed_dance_types").array().notNull().default([]),
  // Up to 3 short selling-point bullets shown on the package card (CMS-managed)
  features: text("features").array().notNull().default([]),
  // Admin-controlled artwork. cardImageUrl backs the Home package card;
  // detailsImageUrl backs the details sheet hero (falls back to cardImageUrl).
  cardImageUrl: text("card_image_url"),
  detailsImageUrl: text("details_image_url"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
}, (table) => ([
  check("price_packages_age_range_shape_check", sql`
    (${table.allowAllAges} is null and ${table.minAge} is null and ${table.maxAge} is null)
    or (${table.allowAllAges} = true and ${table.minAge} is null and ${table.maxAge} is null)
    or (
      ${table.allowAllAges} = false
      and ${table.minAge} is not null
      and ${table.minAge} between 0 and 150
      and (${table.maxAge} is null or (${table.maxAge} between 0 and 150 and ${table.minAge} <= ${table.maxAge}))
    )
  `),
]));

export const insertPricePackageSchema = createInsertSchema(pricePackagesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPricePackage = z.infer<typeof insertPricePackageSchema>;
export type PricePackage = typeof pricePackagesTable.$inferSelect;
