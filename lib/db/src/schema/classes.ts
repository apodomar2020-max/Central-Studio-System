import { boolean, check, integer, pgTable, serial, smallint, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// General Class walk-in pricing categories (Adults / Teens / Kids). Deliberately
// a separate concept from the legacy free-text `ageGroup` column below — legacy
// age_group values are not a reliable signal for which walk-in price bucket a
// class belongs to, so pricingCategory is assigned explicitly by an Admin
// (never inferred/backfilled from ageGroup) and starts out `null` (unassigned)
// on every existing class. See singleClassPricing.ts for how it's resolved.
//
// KNOWN LIMITATION (documented, not implemented — needs business approval):
// a class with allowAllAges=true, or a custom minAge/maxAge range spanning
// more than one of these three buckets (e.g. 8–16), still has to be forced
// into exactly one category — there is no "mixed"/"all ages" pricing
// category. Recommended safest model when this is prioritized: add a 4th
// value, "all_ages", to this tuple + the DB check constraint + the
// class_pricing_settings table (a 4th nullable *_walkin_price_egp column) +
// the resolver's category-price switch — additive in the same shape this
// feature already uses, no redesign needed. See the pricing-gaps review
// thread for the full analysis.
export const PRICING_CATEGORIES = ["adults", "teens", "kids"] as const;
export type PricingCategory = (typeof PRICING_CATEGORIES)[number];

export const classesTable = pgTable("classes", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  instructorId: integer("instructor_id"),
  // Legacy free-text category — retained only during the dance-style migration.
  category: text("category").notNull(),
  /** FK → dance_types.id. Target of the CMS migration (ID-based relationship). */
  danceTypeId: integer("dance_type_id"),
  level: text("level").notNull().default("All Levels"),
  ageGroup: text("age_group").notNull().default("Adults"),
  // Phase A: nullable together for legacy compatibility. Once configured,
  // allowAllAges/minAge/maxAge are the technical eligibility authority.
  allowAllAges: boolean("allow_all_ages"),
  minAge: smallint("min_age"),
  maxAge: smallint("max_age"),
  durationMins: integer("duration_mins").notNull().default(60),
  capacity: integer("capacity").notNull().default(20),
  photoUrl: text("photo_url"),
  classVideoUrl: text("class_video_url"),
  isActive: boolean("is_active").notNull().default(true),
  // Nullable on purpose: null means "not yet audited/assigned" and the price
  // resolver falls back to the legacy Studio-wide single price. See
  // singleClassPricing.ts's resolveSingleClassPriceEgp for the full chain.
  pricingCategory: text("pricing_category"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
}, (table) => ([
  check("classes_age_range_shape_check", sql`
    (${table.allowAllAges} is null and ${table.minAge} is null and ${table.maxAge} is null)
    or (${table.allowAllAges} = true and ${table.minAge} is null and ${table.maxAge} is null)
    or (
      ${table.allowAllAges} = false
      and ${table.minAge} is not null
      and ${table.minAge} between 0 and 150
      and (${table.maxAge} is null or (${table.maxAge} between 0 and 150 and ${table.minAge} <= ${table.maxAge}))
    )
  `),
  check("classes_pricing_category_check", sql`${table.pricingCategory} is null or ${table.pricingCategory} in ('adults', 'teens', 'kids')`),
]));

export const insertClassSchema = createInsertSchema(classesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertClass = z.infer<typeof insertClassSchema>;
export type Class = typeof classesTable.$inferSelect;
