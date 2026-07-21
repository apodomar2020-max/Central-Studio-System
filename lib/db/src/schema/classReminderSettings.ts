import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, timestamp } from "drizzle-orm/pg-core";
import { systemUsersTable } from "./systemUsers";

// Singleton settings row (migration 0073) controlling the booked-class
// reminder automation. Reminder timing itself (24h / 1h / 3h-post-class) is
// NOT configurable here by design — only which categories run.
export const classReminderSettingsTable = pgTable("class_reminder_settings", {
  id: integer("id").primaryKey().default(1),
  automaticRemindersEnabled: boolean("automatic_reminders_enabled").notNull().default(true),
  classReminder24hEnabled: boolean("class_reminder_24h_enabled").notNull().default(true),
  classReminder1hEnabled: boolean("class_reminder_1h_enabled").notNull().default(true),
  postClassRating3hEnabled: boolean("post_class_rating_3h_enabled").notNull().default(true),
  updatedByAdminId: integer("updated_by_admin_id").references(() => systemUsersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
}, (table) => [
  check("class_reminder_settings_singleton", sql`${table.id} = 1`),
]);

export type ClassReminderSettings = typeof classReminderSettingsTable.$inferSelect;
