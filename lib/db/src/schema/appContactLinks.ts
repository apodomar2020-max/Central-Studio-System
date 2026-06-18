import { boolean, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const appContactLinksTable = pgTable("app_contact_links", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  label: text("label").notNull(),
  value: text("value").notNull(),
  icon: text("icon"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
});

export type AppContactLink = typeof appContactLinksTable.$inferSelect;
export type InsertAppContactLink = typeof appContactLinksTable.$inferInsert;
