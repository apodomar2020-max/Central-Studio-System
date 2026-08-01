import { boolean, date, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { studioBranchesTable, studioRoomsTable } from "./studioBranches";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const schedulesTable = pgTable("schedules", {
  id: serial("id").primaryKey(),
  classId: integer("class_id").notNull(),
  branchId: integer("branch_id").references(() => studioBranchesTable.id, { onDelete: "restrict" }),
  roomId: integer("room_id").references(() => studioRoomsTable.id, { onDelete: "restrict" }),
  type: text("type").notNull().default("weekly"),
  status: text("status").notNull().default("active"),
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
}, (table) => [
  index("schedules_branch_id_idx").on(table.branchId),
  index("schedules_room_id_idx").on(table.roomId),
]);

export const insertScheduleSchema = createInsertSchema(schedulesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSchedule = z.infer<typeof insertScheduleSchema>;
export type Schedule = typeof schedulesTable.$inferSelect;
