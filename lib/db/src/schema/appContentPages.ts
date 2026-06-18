import { boolean, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const appContentPagesTable = pgTable("app_content_pages", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  subtitle: text("subtitle"),
  content: text("content").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  updatedBy: integer("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
});

export type AppContentPage = typeof appContentPagesTable.$inferSelect;
export type InsertAppContentPage = typeof appContentPagesTable.$inferInsert;
