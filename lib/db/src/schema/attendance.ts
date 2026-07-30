import { boolean, check, date, index, integer, pgTable, serial, smallint, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { balletClassesTable } from "./balletClasses";
import { balletSchedulesTable } from "./balletSchedules";
import { balletLevelAssignmentsTable } from "./balletLevelAssignments";
import { childrenTable } from "./children";
import {
  BALLET_ATTENDANCE_STATUSES,
  type BalletAttendanceStatus,
} from "@workspace/api-zod";

export { BALLET_ATTENDANCE_STATUSES };
export type { BalletAttendanceStatus };

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
  participantType: text("participant_type"),
  participantChildId: integer("participant_child_id").references(() => childrenTable.id, { onDelete: "set null" }),
  participantDateOfBirthSnapshot: date("participant_date_of_birth_snapshot", { mode: "string" }),
  participantAgeOnOccurrence: smallint("participant_age_on_occurrence"),
  eligibilityEvaluatedOn: date("eligibility_evaluated_on", { mode: "string" }),
  attendanceSource: text("attendance_source"),
  paymentSource: text("payment_source"),
  classId: integer("class_id"),       // → classes.id  (set when admin picks from dropdown)
  scheduleId: integer("schedule_id"), // → schedules.id (set when admin picks from dropdown)
  // Ballet system separation: set for ballet check-ins. classId/scheduleId
  // above stay pointed at the generic tables.
  balletClassId: integer("ballet_class_id").references(() => balletClassesTable.id, { onDelete: "set null" }),
  balletScheduleId: integer("ballet_schedule_id").references(() => balletSchedulesTable.id, { onDelete: "set null" }),
  // C3 (Ballet attendance): the enrolled student identity for a ballet
  // check-in — the level assignment, not the raw student, since a child's
  // ballet identity is their active enrollment. classDate is the calendar
  // day the class occurred (distinct from checkedInAt, which is when it was
  // recorded). onDelete "restrict" protects historical Ballet attendance:
  // the level assignment IS this row's Ballet identity, unlike balletClassId/
  // balletScheduleId above which are optional cross-references. Assignment
  // withdrawal/cancellation must update assignment status/metadata, never
  // delete the assignment and silently remove attendance history. classDate
  // stays nullable at the column level so every pre-existing/non-ballet
  // attendance row is unaffected; only ballet rows ever populate this pair.
  balletLevelAssignmentId: integer("ballet_level_assignment_id").references(() => balletLevelAssignmentsTable.id, { onDelete: "restrict" }),
  classDate: date("class_date"),
  // D1: snapshot of the class's duration (in minutes) AT THE TIME attendance
  // was recorded. Nullable for legacy/non-Ballet rows. Deliberately a
  // snapshot, not a live join to ballet_schedules.duration_mins — so a later
  // edit to a schedule's duration never retroactively changes a past month's
  // attendance-hours totals (see lib/balletAttendance.ts).
  durationMinutes: integer("duration_minutes"),
  // Credit Ledger system (migration 0013)
  bookingId: integer("booking_id"),   // → bookings.id (linked booking this check-in satisfies)
  checkedInBy: text("checked_in_by"), // admin email, "system", or null for legacy records
  status: text("status").notNull().default("checked_in"), // checked_in | late | absent | cancelled
  checkedInAt: timestamp("checked_in_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
}, (table) => ([
  // C3: at most one ballet attendance row per (enrolled student, schedule
  // slot, calendar date). Deliberately keyed on ballet_schedule_id too — NOT
  // (assignment, date) alone — because a child can attend more than one ballet
  // class on the same date, and each schedule slot is a distinct attendance
  // identity. Partial: only applies to ballet rows (assignment id present), so
  // every non-ballet attendance row is unaffected.
  uniqueIndex("attendance_ballet_unique_per_slot_date")
    .on(table.balletLevelAssignmentId, table.balletScheduleId, table.classDate)
    .where(sql`${table.balletLevelAssignmentId} is not null`),
  check("attendance_participant_shape_check", sql`
    (${table.participantType} is null and ${table.participantChildId} is null)
    or (${table.participantType} is not null and ${table.participantType} = 'self' and ${table.participantChildId} is null)
    or (${table.participantType} is not null and ${table.participantType} = 'child' and ${table.participantChildId} is not null)
  `),
  check("attendance_participant_age_snapshot_check", sql`
    ${table.participantAgeOnOccurrence} is null or ${table.participantAgeOnOccurrence} between 0 and 150
  `),
  check("attendance_source_check", sql`
    ${table.attendanceSource} is null or ${table.attendanceSource} in ('booking', 'walk_in')
  `),
  check("attendance_payment_source_check", sql`
    ${table.paymentSource} is null
    or ${table.paymentSource} in (
      'booking_package_credit',
      'booking_pay_at_studio',
      'walk_in_package_credit',
      'walk_in_pay_at_studio'
    )
  `),
  index("attendance_participant_child_checked_in_at_idx").on(table.participantChildId, table.checkedInAt),
  index("attendance_owner_participant_checked_in_at_idx")
    .on(table.studentId, table.participantType, table.participantChildId, table.checkedInAt),
]));

export const insertAttendanceSchema = createInsertSchema(attendanceTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAttendance = z.infer<typeof insertAttendanceSchema>;
export type Attendance = typeof attendanceTable.$inferSelect;
