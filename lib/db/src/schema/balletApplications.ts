import { boolean, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { BALLET_APPLICATION_STATUSES, type BalletApplicationStatus } from "@workspace/api-zod";
import { studentsTable } from "./students";
import { balletLevelsTable } from "./balletLevels";
import { balletSchedulesTable } from "./balletSchedules";
import { childrenTable } from "./children";
import { balletPackagesTable } from "./balletPackages";
import { systemUsersTable } from "./systemUsers";

// Canonical source of truth moved to @workspace/api-zod (Phase A / P0-2b) so
// frontend packages can import the same literals instead of retyping them.
// Re-exported here so existing `from "@workspace/db/schema/balletApplications"`
// imports keep working unchanged.
export { BALLET_APPLICATION_STATUSES };
export type { BalletApplicationStatus };

/**
 * ballet_applications — one row per form submission from the mobile app.
 *
 * All form fields are stored directly (not as FKs to a children record)
 * because many submissions come from parents who have not created an app
 * account yet (walk-in / phone calls). The child_id FK is populated later
 * if the parent links their account.
 *
 * Status machine:
 *   pending → accepted → assignedToLevel → active → withdrawn
 *           ↘ rejected
 *           ↘ needsFollowUp
 *           ↘ cancelled (pre-activation terminal)
 *
 * (Old values "submitted"/"pendingAssessment" merged into "pending" and
 * "activeBallet" renamed to "active" — data migrated in migration 0047.)
 */

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
  assessmentScheduleId:  integer("assessment_schedule_id").references(() => balletSchedulesTable.id, { onDelete: "set null" }),
  assessmentDate:        text("assessment_date"),
  // C1: parent's chosen payment method at intake (app-layer enum
  // BALLET_PAYMENT_METHODS). Nullable at the DB level so historical rows stay
  // valid, but required by the POST body for new submissions. This is a
  // preference only — it never creates or touches a ballet_payments row; it is
  // consumed as a prefill convenience when admin staff later record a payment.
  preferredPaymentMethod: text("preferred_payment_method"),
  preferredPackageId:     integer("preferred_package_id").references(() => balletPackagesTable.id, { onDelete: "set null" }),
  status:                text("status").notNull().default("pending"),
  adminNotes:            text("admin_notes"),
  assignedLevelId:       integer("assigned_level_id").references(() => balletLevelsTable.id, { onDelete: "set null" }),
  assignedAt:            timestamp("assigned_at", { withTimezone: true, mode: "string" }),
  childId:               integer("child_id").references(() => childrenTable.id, { onDelete: "set null" }),

  // ─── Assessment Fee Tracking (Phase 2 Additive Columns) ───────────────────
  // Server-side snapshot of the configured fee from ballet_settings.assessment_fee_egp
  // at application creation time. Null if no fee was configured or free.
  assessmentFeeAmountEgp:     integer("assessment_fee_amount_egp"),
  // Status of the assessment fee payment: unpaid | paid | waived | refunded
  assessmentFeeStatus:        text("assessment_fee_status").notNull().default("unpaid"),
  assessmentFeePaidAt:        timestamp("assessment_fee_paid_at", { withTimezone: true, mode: "string" }),
  // In-person settlement channel (Phase 1 strictly 'inPerson')
  assessmentFeePaymentMethod: text("assessment_fee_payment_method"),
  assessmentFeeRecordedById:  integer("assessment_fee_recorded_by_id").references(() => systemUsersTable.id, { onDelete: "set null" }),

  createdAt:             timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:             timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
}, (table) => ([
  // Phase A / P0-8a: a linked child can have at most one open application at
  // a time. Terminal statuses allow reapplication.
  uniqueIndex("ballet_applications_active_per_child")
    .on(table.childId)
    .where(sql`${table.childId} is not null and ${table.status} in ('pending','needsFollowUp','accepted','assignedToLevel','active')`),
  // Phase A / P0-8b: same guarantee for manual (walk-in/phone) submissions
  // that have no linked child record yet — identity is the best available
  // proxy (parent account + normalised child name + birthday).
  uniqueIndex("ballet_applications_active_per_manual_identity")
    .on(table.parentStudentId, sql`lower(trim(${table.childName}))`, table.childBirthday)
    .where(sql`${table.childId} is null and ${table.status} in ('pending','needsFollowUp','accepted','assignedToLevel','active')`),
  index("ballet_applications_assessment_schedule_idx").on(table.assessmentScheduleId),
  index("ballet_applications_assessment_date_idx").on(table.assessmentDate),
]));

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
  assessmentScheduleId:  z.number().int().positive().optional(),
  assessmentDate:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  preferredPackageId:    z.number().int().positive().optional(),
});

export type BalletApplication = typeof balletApplicationsTable.$inferSelect;
export type InsertBalletApplication = z.infer<typeof insertBalletApplicationSchema>;
