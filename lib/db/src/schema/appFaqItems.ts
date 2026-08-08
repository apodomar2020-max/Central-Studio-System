import { boolean, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { appFaqCategoriesTable } from "./appFaqCategories";

export const appFaqItemsTable = pgTable("app_faq_items", {
  id: serial("id").primaryKey(),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  // Nullable — existing rows have no category and none is backfilled/invented.
  // ON DELETE RESTRICT: categories are soft-deleted (isActive=false), never
  // hard-deleted; this makes that intent enforceable at the DB level too.
  categoryId: integer("category_id").references(() => appFaqCategoriesTable.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
});

export type AppFaqItem = typeof appFaqItemsTable.$inferSelect;
export type InsertAppFaqItem = typeof appFaqItemsTable.$inferInsert;
