import { boolean, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { studentsTable } from "./students";
import { balletAssessmentSlotsTable } from "./balletAssessmentSlots";
import { balletLevelsTable } from "./balletLevels";
import { childrenTable } from "./children";

/**
 * ballet_applications — one row per form submission from the mobile app.
 *
 * All form fields are stored directly (not as FKs to a children record)
 * because many submissions come from parents who have not created an app
 * account yet (walk-in / phone calls). The child_id FK is populated later
 * if the parent links their account.
 *
 * slot_label is a denormalised copy of the slot's display string so the
 * historical record remains legible if the admin edits the slot later.
 *
 * Status machine:
 *   submitted → pendingAssessment → accepted → assignedToLevel → activeBallet
 *                                 ↘ rejected
 *                                 ↘ needsFollowUp
 */

export const BALLET_APPLICATION_STATUSES = [
  "submitted",
  "pendingAssessment",
  "accepted",
  "rejected",
  "needsFollowUp",
  "assignedToLevel",
  "activeBallet",
  "cancelled",
] as const;

export type BalletApplicationStatus = (typeof BALLET_APPLICATION_STATUSES)[number];

export const balletApplicationsTable = pgTable("ballet_applications", {
  id:                    serial("id").primaryKey(),
  parentStudentId:       integer("parent_student_id").references(() => studentsTable.id, { onDelete: "set null" }),
  parentName:            text("parent_name").notNull(),
  parentPhone:           text("parent_phone").notNull(),
  parentEmail:           text("parent_email").notNull(),
  childName:             text("child_name").notNull(),
  childBirthday:         text("child_birthday"),
  childAge:              integer("child_age"),
  childGender:           text("child_gender"),
  emergencyContactName:  text("emergency_contact_name"),
  emergencyContactPhone: text("emergency_contact_phone"),
  previousExperience:    boolean("previous_experience").notNull().default(false),
  experienceDetails:     text("experience_details"),
  medicalNotes:          text("medical_notes"),
  notes:                 text("notes"),
  slotId:                integer("slot_id").references(() => balletAssessmentSlotsTable.id, { onDelete: "set null" }),
  slotLabel:             text("slot_label"),
  status:                text("status").notNull().default("submitted"),
  adminNotes:            text("admin_notes"),
  assignedLevelId:       integer("assigned_level_id").references(() => balletLevelsTable.id, { onDelete: "set null" }),
  assignedAt:            timestamp("assigned_at", { withTimezone: true, mode: "string" }),
  childId:               integer("child_id").references(() => childrenTable.id, { onDelete: "set null" }),
  createdAt:             timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:             timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
});

// Zod schema for the mobile app's POST /api/ballet/applications body.
// parentStudentId is injected server-side from the student identity header.
export const insertBalletApplicationSchema = z.object({
  parentName:            z.string().min(1),
  parentPhone:           z.string().min(1),
  parentEmail:           z.string().email(),
  childName:             z.string().min(1),
  childBirthday:         z.string().optional(),
  childAge:              z.number().int().positive().optional(),
  childGender:           z.enum(["male", "female"]).optional(),
  emergencyContactName:  z.string().optional(),
  emergencyContactPhone: z.string().optional(),
  previousExperience:    z.boolean().default(false),
  experienceDetails:     z.string().optional(),
  medicalNotes:          z.string().optional(),
  notes:                 z.string().optional(),
  slotId:                z.number().int().positive().optional(),
  slotLabel:             z.string().optional(),
});

export type BalletApplication = typeof balletApplicationsTable.$inferSelect;
export type InsertBalletApplication = z.infer<typeof insertBalletApplicationSchema>;
