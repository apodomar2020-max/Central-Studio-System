import { integer, pgTable, serial, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { balletClassesTable } from "./balletClasses";
import { balletGroupsTable } from "./balletGroups";

/**
 * ballet_class_groups — join table: which groups a ballet class belongs to.
 *
 * Many-to-many (a class can have several groups; a group can belong to
 * several classes over time), replacing the old ballet_classes.group_ids
 * integer array so referential integrity is enforced by the database.
 */
export const balletClassGroupsTable = pgTable(
  "ballet_class_groups",
  {
    id:        serial("id").primaryKey(),
    classId:   integer("class_id").notNull().references(() => balletClassesTable.id, { onDelete: "cascade" }),
    groupId:   integer("group_id").notNull().references(() => balletGroupsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueClassGroup: uniqueIndex("ballet_class_groups_class_group_unique").on(table.classId, table.groupId),
  }),
);

export const insertBalletClassGroupSchema = createInsertSchema(balletClassGroupsTable).omit({
  id: true, createdAt: true,
});

export type BalletClassGroup = typeof balletClassGroupsTable.$inferSelect;
export type InsertBalletClassGroup = z.infer<typeof insertBalletClassGroupSchema>;
