import { boolean, check, date, index, integer, pgTable, serial, smallint, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { balletSchedulesTable } from "./balletSchedules";
import { childrenTable } from "./children";
import { studentsTable } from "./students";

export const bookingsTable = pgTable("bookings", {
  id: serial("id").primaryKey(),
  studentName: text("student_name").notNull(),
  studentEmail: text("student_email").notNull(),
  studentPhone: text("student_phone"),
  accountOwnerStudentId: integer("account_owner_student_id").references(() => studentsTable.id, { onDelete: "set null" }),
  participantType: text("participant_type"),
  participantChildId: integer("participant_child_id").references(() => childrenTable.id, { onDelete: "set null" }),
  bookingScope: text("booking_scope"),
  scheduleId: integer("schedule_id"),
  classId: integer("class_id"),
  // Ballet system separation: set when the booking is for a ballet schedule.
  // scheduleId/classId above stay pointed at the generic tables.
  balletScheduleId: integer("ballet_schedule_id").references(() => balletSchedulesTable.id, { onDelete: "set null" }),
  // The specific class occurrence this booking is for (YYYY-MM-DD). Booking
  // identity = student + schedule + occurrence, so a weekly class can be re-booked
  // for the next occurrence once the previous one passes. Null for legacy rows.
  occurrenceDate: date("occurrence_date", { mode: "string" }),
  participantDateOfBirthSnapshot: date("participant_date_of_birth_snapshot", { mode: "string" }),
  participantAgeOnOccurrence: smallint("participant_age_on_occurrence"),
  eligibilityEvaluatedOn: date("eligibility_evaluated_on", { mode: "string" }),
  classAllowAllAgesSnapshot: boolean("class_allow_all_ages_snapshot"),
  classMinAgeSnapshot: smallint("class_min_age_snapshot"),
  classMaxAgeSnapshot: smallint("class_max_age_snapshot"),
  eligibilityDecisionCode: text("eligibility_decision_code"),
  packageId: integer("package_id"),
  // Explicit packageOrderId added in migration 0013. Legacy packageId field kept for
  // backward-compat but packageOrderId is the authoritative FK to package_orders.id.
  packageOrderId: integer("package_order_id"),
  status: text("status").notNull().default("pending"),
  bookingStatus: text("booking_status").notNull().default("confirmed"),
  paymentStatus: text("payment_status").notNull().default("not_required"),
  paymentMode: text("payment_mode"),
  notes: text("notes"),
  bookedAt: timestamp("booked_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
}, (table) => ([
  // Finance Final Closure Batch 1 (Part F2): DB-level backstop for the
  // occurrence-aware duplicate-booking guard bookings.ts already enforces
  // at the application level (identical scheduleId/occurrenceDate/
  // participant/status keying — see the duplicate_booking check in POST
  // /bookings). The app-level check-then-insert has no row lock around it,
  // so two truly concurrent requests could both pass it before either
  // commits; this index makes that impossible at the database layer
  // instead of merely reducing the odds.
  //
  // Deliberately partial and narrow, per the historical-data policy (never
  // repair/backfill old rows):
  //   • occurrence_date IS NOT NULL — every legacy pre-occurrence-model
  //     booking has occurrence_date null and is entirely excluded; this
  //     constraint applies only to future/new occurrence-specific bookings.
  //   • account_owner_student_id IS NOT NULL — same reasoning for
  //     pre-Membership-Engine legacy rows with no owner FK populated yet.
  //   • booking_status IN ('pending','confirmed') — mirrors
  //     DUPLICATE_BLOCKING_STATUSES exactly; a cancelled/rejected/attended
  //     booking never blocks a new one for the same occurrence.
  //
  // coalesce(participant_child_id, 0) rather than a plain column: Postgres
  // treats NULL as distinct from NULL in a unique index by default, which
  // would let two different "self" (participant_child_id null) bookings for
  // the same account/schedule/occurrence both exist — coalescing to a
  // sentinel makes every "self" row collide with every other "self" row for
  // that key, while a real child id is never zero and is left untouched.
  uniqueIndex("bookings_active_occurrence_participant_unique")
    .on(table.scheduleId, table.occurrenceDate, table.accountOwnerStudentId, sql`coalesce(${table.participantChildId}, 0)`)
    .where(sql`
      ${table.occurrenceDate} is not null
      and ${table.accountOwnerStudentId} is not null
      and ${table.bookingStatus} in ('pending', 'confirmed')
    `),
  index("bookings_owner_participant_occurrence_idx")
    .on(table.accountOwnerStudentId, table.participantType, table.participantChildId, table.scheduleId, table.occurrenceDate),
  check("bookings_participant_age_snapshot_check", sql`
    ${table.participantAgeOnOccurrence} is null or ${table.participantAgeOnOccurrence} between 0 and 150
  `),
  check("bookings_participant_shape_check", sql`
    (${table.participantType} is null and ${table.participantChildId} is null)
    or (${table.participantType} = 'self' and ${table.participantChildId} is null)
    or (${table.participantType} = 'child' and ${table.participantChildId} is not null)
  `),
  check("bookings_class_age_range_snapshot_check", sql`
    (${table.classAllowAllAgesSnapshot} is null and ${table.classMinAgeSnapshot} is null and ${table.classMaxAgeSnapshot} is null)
    or (${table.classAllowAllAgesSnapshot} = true and ${table.classMinAgeSnapshot} is null and ${table.classMaxAgeSnapshot} is null)
    or (
      ${table.classAllowAllAgesSnapshot} = false
      and ${table.classMinAgeSnapshot} is not null
      and ${table.classMinAgeSnapshot} between 0 and 150
      and (
        ${table.classMaxAgeSnapshot} is null
        or (${table.classMaxAgeSnapshot} between 0 and 150 and ${table.classMinAgeSnapshot} <= ${table.classMaxAgeSnapshot})
      )
    )
  `),
]));

export const insertBookingSchema = createInsertSchema(bookingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBooking = z.infer<typeof insertBookingSchema>;
export type Booking = typeof bookingsTable.$inferSelect;
