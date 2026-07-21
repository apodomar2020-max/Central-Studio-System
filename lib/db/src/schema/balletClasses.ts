import { boolean, foreignKey, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { balletInstructorsTable } from "./balletInstructors";
import { balletLevelsTable } from "./balletLevels";
import { balletGroupsTable } from "./balletGroups";

/**
 * ballet_classes — class catalogue for the Ballet system, independent of the
 * generic `classes` table.
 *
 * Canonical model (migration 0075): one class belongs to exactly one level
 * and one group, via direct level_id/group_id columns. A group may own
 * several separate classes, but a class never spans groups or levels.
 *
 * level_id/group_id are nullable at the DB level because this table also
 * holds pre-0075 legacy rows (isLegacy = true), which relate to
 * levels/groups through the separate ballet_class_levels/ballet_class_groups
 * join tables instead. The new canonical API requires both and enforces
 * that requirement itself — see adminBalletClasses.ts. Legacy rows are never
 * eligible for new assignment or activation entitlement regardless of what
 * these columns happen to hold (a level_id may be backfilled for display).
 */
export const balletClassesTable = pgTable("ballet_classes", {
  id:            serial("id").primaryKey(),
  title:         text("title").notNull(),
  isLegacy:      boolean("is_legacy").notNull().default(true),
  levelId:       integer("level_id").references(() => balletLevelsTable.id, { onDelete: "restrict" }),
  groupId:       integer("group_id"),
  instructorId:  integer("instructor_id").references(() => balletInstructorsTable.id, { onDelete: "set null" }),
  classImageUrl: text("class_image_url"),
  classVideoUrl: text("class_video_url"),
  isActive:      boolean("is_active").notNull().default(true),
  createdAt:     timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
}, (table) => ([
  // MATCH SIMPLE (Postgres default): only enforced when both columns are
  // non-null, so legacy rows with a null group_id are unaffected.
  foreignKey({
    columns: [table.groupId, table.levelId],
    foreignColumns: [balletGroupsTable.id, balletGroupsTable.levelId],
    name: "ballet_classes_group_level_fk",
  }).onDelete("restrict"),
]));

export const insertBalletClassSchema = createInsertSchema(balletClassesTable).omit({
  id: true, createdAt: true, updatedAt: true,
});

export const updateBalletClassSchema = insertBalletClassSchema.partial();

export type BalletClass = typeof balletClassesTable.$inferSelect;
export type InsertBalletClass = z.infer<typeof insertBalletClassSchema>;
export type UpdateBalletClass = z.infer<typeof updateBalletClassSchema>;
