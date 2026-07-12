import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { balletClassesTable } from "./balletClasses";

/**
 * ballet_schedules — weekly time slots for ballet classes, independent of the
 * generic `schedules` table.
 *
 * day_of_week: 0-6 (0 = Sunday, matching JS Date#getDay()).
 */
export const BALLET_SCHEDULE_STATUSES = ["active", "deactivated", "cancelled"] as const;

export type BalletScheduleStatus = (typeof BALLET_SCHEDULE_STATUSES)[number];

export const balletSchedulesTable = pgTable("ballet_schedules", {
  id:           serial("id").primaryKey(),
  classId:      integer("class_id").notNull().references(() => balletClassesTable.id, { onDelete: "cascade" }),
  dayOfWeek:    integer("day_of_week").notNull(), // 0-6
  startTime:    text("start_time").notNull(),
  endTime:      text("end_time").notNull(),
  status:       text("status").notNull().default("active"), // active | deactivated | cancelled
  durationMins: integer("duration_mins"),
  createdAt:    timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
});

export const insertBalletScheduleSchema = createInsertSchema(balletSchedulesTable).omit({
  id: true, createdAt: true, updatedAt: true,
});

export const updateBalletScheduleSchema = insertBalletScheduleSchema.partial();

export type BalletSchedule = typeof balletSchedulesTable.$inferSelect;
export type InsertBalletSchedule = z.infer<typeof insertBalletScheduleSchema>;
export type UpdateBalletSchedule = z.infer<typeof updateBalletScheduleSchema>;
