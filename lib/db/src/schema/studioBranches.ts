import { sql } from "drizzle-orm";
import { boolean, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const studioBranchesTable = pgTable("studio_branches", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code").generatedAlwaysAs(sql`'BR-' || lpad(id::text, 3, '0')`).notNull(),
  address: text("address"),
  googleMapsLink: text("google_maps_link"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex("studio_branches_name_unique").on(table.name),
  uniqueIndex("studio_branches_code_unique").on(table.code),
]);

export const studioRoomsTable = pgTable("studio_rooms", {
  id: serial("id").primaryKey(),
  branchId: integer("branch_id").notNull().references(() => studioBranchesTable.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  code: text("code").generatedAlwaysAs(sql`'RM-' || lpad(id::text, 3, '0')`).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex("studio_rooms_code_unique").on(table.code),
  uniqueIndex("studio_rooms_branch_name_unique").on(table.branchId, table.name),
  index("studio_rooms_branch_id_idx").on(table.branchId),
]);

export type StudioBranch = typeof studioBranchesTable.$inferSelect;
export type InsertStudioBranch = typeof studioBranchesTable.$inferInsert;
export type StudioRoom = typeof studioRoomsTable.$inferSelect;
export type InsertStudioRoom = typeof studioRoomsTable.$inferInsert;
