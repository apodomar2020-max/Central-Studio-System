import { boolean, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * App FAQ Categories — admin-curated, independently managed CMS entity
 * (Phase 3 of the App FAQ Categories feature; see
 * APP_FAQ_CATEGORIES_IMPLEMENTATION_PLAN.md).
 *
 * Referenced from `app_faq_items.category_id` (nullable FK, ON DELETE
 * RESTRICT — categories are never hard-deleted at the application layer;
 * see appContent.ts). Modeled directly on the existing Dance Types
 * parent-CMS-entity pattern, deliberately without a `slug` (no demonstrated
 * need for a stable external key today).
 */
export const appFaqCategoriesTable = pgTable("app_faq_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
}, (table) => ([
  // Case-insensitive uniqueness: prevents categories differing only by
  // letter case (e.g. "Bookings" vs "bookings") from coexisting. Mirrors
  // the lower(trim(...)) convention already used for name-uniqueness
  // elsewhere in this schema (see balletApplications.ts).
  uniqueIndex("app_faq_categories_name_unique_ci").on(sql`lower(trim(${table.name}))`),
]));

export type AppFaqCategory = typeof appFaqCategoriesTable.$inferSelect;
export type InsertAppFaqCategory = typeof appFaqCategoriesTable.$inferInsert;
