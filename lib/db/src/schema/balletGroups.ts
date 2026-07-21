import { boolean, integer, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { balletLevelsTable } from "./balletLevels";

/**
 * ballet_groups — a cohort of children within one level.
 *
 * A group can own multiple separate ballet_classes. Each class owns exactly
 * one weekly schedule, so no group/schedule join is needed for the
 * canonical model — see migration 0075.
 *
 * level_id uses ON DELETE RESTRICT: a level with groups cannot be deleted,
 * matching the ballet_level_assignments convention.
 *
 * capacity (Phase A / P0-6) is nullable — null means uncapped/no enforced
 * limit; a set value is enforced by the assign-group endpoint against the
 * count of active ballet_level_assignments rows pointed at this group.
 */
export const balletGroupsTable = pgTable("ballet_groups", {
  id:         serial("id").primaryKey(),
  name:       text("name").notNull(),
  levelId:    integer("level_id").notNull().references(() => balletLevelsTable.id, { onDelete: "restrict" }),
  isActive:   boolean("is_active").notNull().default(true),
  capacity:   integer("capacity"),
  createdAt:  timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
}, (table) => ([
  // Supports the composite Class(group_id, level_id) FK that makes a
  // cross-level Class impossible even when writes bypass the API.
  unique("ballet_groups_id_level_id_unique").on(table.id, table.levelId),
]));

export const insertBalletGroupSchema = createInsertSchema(balletGroupsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});

export const updateBalletGroupSchema = insertBalletGroupSchema.partial();

export type BalletGroup = typeof balletGroupsTable.$inferSelect;
export type InsertBalletGroup = z.infer<typeof insertBalletGroupSchema>;
export type UpdateBalletGroup = z.infer<typeof updateBalletGroupSchema>;
