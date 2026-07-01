import { integer, pgTable, serial, timestamp, unique } from "drizzle-orm/pg-core";
import { studentsTable } from "./students";
import { danceTypesTable } from "./danceTypes";

/**
 * student_dance_interests — "Your Vibe" selections (Profile Completion Engine,
 * Phase 4). Backend-persisted replacement for the AsyncStorage-only dance
 * style selection that used to live on the mobile client.
 */
export const studentDanceInterestsTable = pgTable("student_dance_interests", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").notNull().references(() => studentsTable.id, { onDelete: "cascade" }),
  danceTypeId: integer("dance_type_id").notNull().references(() => danceTypesTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
}, (table) => [
  unique("student_dance_interests_student_id_dance_type_id_unique").on(table.studentId, table.danceTypeId),
]);

export type StudentDanceInterest = typeof studentDanceInterestsTable.$inferSelect;
export type InsertStudentDanceInterest = typeof studentDanceInterestsTable.$inferInsert;
