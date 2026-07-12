import { boolean, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { balletLevelsTable } from "./balletLevels";

/**
 * ballet_groups — a cohort of children within one level.
 *
 * A group can be tied to more than one weekly schedule slot (e.g. Monday 5pm
 * AND Wednesday 5pm) — that many-to-many relationship is tracked via the
 * ballet_group_schedules join table, not a scalar column here.
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
});

export const insertBalletGroupSchema = createInsertSchema(balletGroupsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});

export const updateBalletGroupSchema = insertBalletGroupSchema.partial();

export type BalletGroup = typeof balletGroupsTable.$inferSelect;
export type InsertBalletGroup = z.infer<typeof insertBalletGroupSchema>;
export type UpdateBalletGroup = z.infer<typeof updateBalletGroupSchema>;
