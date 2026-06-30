import { integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { attendanceTable } from "./attendance";
import { systemUsersTable } from "./systemUsers";

export const feedbackTable = pgTable("feedback", {
  id: serial("id").primaryKey(),
  attendanceId: integer("attendance_id").notNull().references(() => attendanceTable.id, { onDelete: "restrict" }),
  studentId: integer("student_id"),
  studentEmailSnapshot: text("student_email_snapshot").notNull(),
  studentNameSnapshot: text("student_name_snapshot").notNull(),
  childId: integer("child_id"),
  childNameSnapshot: text("child_name_snapshot"),
  bookingId: integer("booking_id"),
  classId: integer("class_id"),
  classTitleSnapshot: text("class_title_snapshot"),
  scheduleId: integer("schedule_id"),
  scheduleSnapshot: jsonb("schedule_snapshot").$type<Record<string, unknown> | null>(),
  instructorId: integer("instructor_id"),
  instructorNameSnapshot: text("instructor_name_snapshot"),
  danceTypeNameSnapshot: text("dance_type_name_snapshot"),
  rating: integer("rating").notNull(),
  comment: text("comment"),
  tags: text("tags").array().notNull().default([]),
  reviewStatus: text("review_status").notNull().default("pending"),
  reviewedBy: integer("reviewed_by").references(() => systemUsersTable.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "string" }),
  clientSubmissionId: text("client_submission_id").notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "string" }),
  receivedAt: timestamp("received_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
});

export const insertFeedbackSchema = createInsertSchema(feedbackTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFeedback = z.infer<typeof insertFeedbackSchema>;
export type Feedback = typeof feedbackTable.$inferSelect;
