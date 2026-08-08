import { boolean, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";

/**
 * Ballet FAQ Categories — admin-curated, Ballet-domain-only CMS entity.
 * Referenced from `ballet_faqs.category_id` (nullable FK, ON DELETE
 * RESTRICT — categories are never hard-deleted at the application layer,
 * only activated/deactivated; see adminBallet.ts). Modeled directly on the
 * existing Ballet parent-CMS-entity pattern
 * (ballet_program_requirement_sections), not on app_faq_categories —
 * intentionally a separate entity in a separate domain.
 */
export const balletFaqCategoriesTable = pgTable("ballet_faq_categories", {
  id:        serial("id").primaryKey(),
  name:      text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive:  boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
}, (table) => ([
  // Case-insensitive uniqueness: prevents categories differing only by
  // letter case or surrounding whitespace (e.g. "Assessments" vs
  // "assessments ") from coexisting. Mirrors the lower(trim(...))
  // convention already used for name-uniqueness elsewhere in this schema
  // (ballet_applications, app_faq_categories).
  uniqueIndex("ballet_faq_categories_name_unique_ci").on(sql`lower(trim(${table.name}))`),
]));

export const insertBalletFaqCategorySchema = createInsertSchema(balletFaqCategoriesTable).omit({
  id: true, createdAt: true, updatedAt: true,
});

export const updateBalletFaqCategorySchema = insertBalletFaqCategorySchema.partial();

export type BalletFaqCategory = typeof balletFaqCategoriesTable.$inferSelect;
export type InsertBalletFaqCategory = z.infer<typeof insertBalletFaqCategorySchema>;
export type UpdateBalletFaqCategory = z.infer<typeof updateBalletFaqCategorySchema>;
