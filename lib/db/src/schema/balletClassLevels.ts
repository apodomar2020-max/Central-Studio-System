import { integer, pgTable, serial, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { balletClassesTable } from "./balletClasses";
import { balletLevelsTable } from "./balletLevels";

/**
 * ballet_class_levels — join table: which levels a ballet class is offered at.
 *
 * Many-to-many, replacing the old ballet_classes.level_ids integer array so
 * referential integrity is enforced by the database.
 *
 * level_id uses ON DELETE RESTRICT: a level referenced by a class cannot be
 * deleted, matching the ballet_level_assignments / ballet_groups convention.
 */
export const balletClassLevelsTable = pgTable(
  "ballet_class_levels",
  {
    id:        serial("id").primaryKey(),
    classId:   integer("class_id").notNull().references(() => balletClassesTable.id, { onDelete: "cascade" }),
    levelId:   integer("level_id").notNull().references(() => balletLevelsTable.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueClassLevel: uniqueIndex("ballet_class_levels_class_level_unique").on(table.classId, table.levelId),
  }),
);

export const insertBalletClassLevelSchema = createInsertSchema(balletClassLevelsTable).omit({
  id: true, createdAt: true,
});

export type BalletClassLevel = typeof balletClassLevelsTable.$inferSelect;
export type InsertBalletClassLevel = z.infer<typeof insertBalletClassLevelSchema>;
