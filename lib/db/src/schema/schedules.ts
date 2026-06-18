import { boolean, date, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const schedulesTable = pgTable("schedules", {
  id: serial("id").primaryKey(),
  classId: integer("class_id").notNull(),
  type: text("type").notNull().default("weekly"),
  dayOfWeek: integer("day_of_week"),
  date: date("date", { mode: "string" }),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  priceEgp: integer("price_egp"),
  packageEligible: boolean("package_eligible").notNull().default(true),
  location: text("location"),
  isRecurring: boolean("is_recurring").notNull().default(true),
  effectiveFrom: text("effective_from"),
  effectiveUntil: text("effective_until"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
});

export const insertScheduleSchema = createInsertSchema(schedulesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSchedule = z.infer<typeof insertScheduleSchema>;
export type Schedule = typeof schedulesTable.$inferSelect;
