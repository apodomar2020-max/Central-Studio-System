import { integer, pgTable, serial, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { balletGroupsTable } from "./balletGroups";
import { balletSchedulesTable } from "./balletSchedules";

/**
 * ballet_group_schedules — join table: which weekly schedule slots a group
 * meets at.
 *
 * Many-to-many — a group can be assigned to more than one weekly schedule
 * slot (e.g. Monday 5pm AND Wednesday 5pm), replacing the old
 * ballet_groups.schedule_id scalar FK.
 */
export const balletGroupSchedulesTable = pgTable(
  "ballet_group_schedules",
  {
    id:         serial("id").primaryKey(),
    groupId:    integer("group_id").notNull().references(() => balletGroupsTable.id, { onDelete: "cascade" }),
    scheduleId: integer("schedule_id").notNull().references(() => balletSchedulesTable.id, { onDelete: "cascade" }),
    createdAt:  timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueGroupSchedule: uniqueIndex("ballet_group_schedules_group_schedule_unique").on(table.groupId, table.scheduleId),
  }),
);

export const insertBalletGroupScheduleSchema = createInsertSchema(balletGroupSchedulesTable).omit({
  id: true, createdAt: true,
});

export type BalletGroupSchedule = typeof balletGroupSchedulesTable.$inferSelect;
export type InsertBalletGroupSchedule = z.infer<typeof insertBalletGroupScheduleSchema>;
