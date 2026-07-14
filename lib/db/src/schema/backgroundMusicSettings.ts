import { sql } from "drizzle-orm";
import { boolean, check, integer, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { systemUsersTable } from "./systemUsers";

export const backgroundMusicSettingsTable = pgTable("background_music_settings", {
  id: integer("id").primaryKey().default(1),
  enabled: boolean("enabled").notNull().default(false),
  sourceUrl: text("source_url"),
  sourceTitle: text("source_title"),
  volume: numeric("volume", { precision: 4, scale: 3 }).notNull().default("0.250"),
  loop: boolean("loop").notNull().default(true),
  version: integer("version").notNull().default(1),
  updatedByAdminId: integer("updated_by_admin_id").references(() => systemUsersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
}, (table) => [
  check("background_music_settings_singleton", sql`${table.id} = 1`),
  check("background_music_settings_volume_range", sql`${table.volume} >= 0 AND ${table.volume} <= 1`),
  check("background_music_settings_version_positive", sql`${table.version} >= 1`),
]);

export type BackgroundMusicSettings = typeof backgroundMusicSettingsTable.$inferSelect;
