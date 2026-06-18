import { boolean, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const appFaqItemsTable = pgTable("app_faq_items", {
  id: serial("id").primaryKey(),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
});

export type AppFaqItem = typeof appFaqItemsTable.$inferSelect;
export type InsertAppFaqItem = typeof appFaqItemsTable.$inferInsert;
