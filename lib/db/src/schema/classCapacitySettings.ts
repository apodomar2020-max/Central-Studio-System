import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, timestamp } from "drizzle-orm/pg-core";
import { systemUsersTable } from "./systemUsers";

export const classCapacitySettingsTable = pgTable("class_capacity_settings", {
  id: integer("id").primaryKey().default(1),
  classCapacityEnabled: boolean("class_capacity_enabled").notNull().default(true),
  updatedByAdminId: integer("updated_by_admin_id").references(() => systemUsersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
}, (table) => [
  check("class_capacity_settings_singleton", sql`${table.id} = 1`),
]);

export type ClassCapacitySettings = typeof classCapacitySettingsTable.$inferSelect;
