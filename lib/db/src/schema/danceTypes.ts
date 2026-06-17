import { boolean, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const danceTypesTable = pgTable("dance_types", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
});

export type DanceType = typeof danceTypesTable.$inferSelect;
export type InsertDanceType = typeof danceTypesTable.$inferInsert;
