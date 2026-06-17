import { boolean, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const attendanceTable = pgTable("attendance", {
  id: serial("id").primaryKey(),
  studentName: text("student_name").notNull(),
  studentEmail: text("student_email").notNull(),
  packageOrderId: integer("package_order_id"),
  classTitle: text("class_title"),
  creditDeducted: boolean("credit_deducted").notNull().default(false),
  notes: text("notes"),
  // FK references added as part of QR Attendance system (Step 1).
  // All nullable so legacy attendance records remain valid.
  studentId: integer("student_id"),   // → students.id (set when scanned via QR token)
  classId: integer("class_id"),       // → classes.id  (set when admin picks from dropdown)
  scheduleId: integer("schedule_id"), // → schedules.id (set when admin picks from dropdown)
  // Credit Ledger system (migration 0013)
  bookingId: integer("booking_id"),   // → bookings.id (linked booking this check-in satisfies)
  checkedInBy: text("checked_in_by"), // admin email, "system", or null for legacy records
  status: text("status").notNull().default("checked_in"), // checked_in | late | absent | cancelled
  checkedInAt: timestamp("checked_in_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
});

export const insertAttendanceSchema = createInsertSchema(attendanceTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAttendance = z.infer<typeof insertAttendanceSchema>;
export type Attendance = typeof attendanceTable.$inferSelect;
