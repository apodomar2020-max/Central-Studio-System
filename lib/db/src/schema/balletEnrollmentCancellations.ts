import { boolean, check, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { balletApplicationsTable } from "./balletApplications";
import { balletLevelAssignmentsTable } from "./balletLevelAssignments";
import { childrenTable } from "./children";
import { studentsTable } from "./students";
import { systemUsersTable } from "./systemUsers";

export const BALLET_ENROLLMENT_CANCELLATION_STATUSES = [
  "pendingReview",
  "approved",
  "rejected",
  "withdrawnByParent",
  "completed",
] as const;

export type BalletEnrollmentCancellationStatus = (typeof BALLET_ENROLLMENT_CANCELLATION_STATUSES)[number];

export const BALLET_ENROLLMENT_CANCELLATION_TIMINGS = [
  "immediate",
  "endOfPeriod",
] as const;

export type BalletEnrollmentCancellationTiming = (typeof BALLET_ENROLLMENT_CANCELLATION_TIMINGS)[number];

export const balletEnrollmentCancellationRequestsTable = pgTable("ballet_enrollment_cancellation_requests", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull().references(() => balletApplicationsTable.id, { onDelete: "restrict" }),
  levelAssignmentId: integer("level_assignment_id").notNull().references(() => balletLevelAssignmentsTable.id, { onDelete: "restrict" }),
  childId: integer("child_id").references(() => childrenTable.id, { onDelete: "set null" }),
  parentStudentId: integer("parent_student_id").references(() => studentsTable.id, { onDelete: "set null" }),
  status: text("status").notNull().default("pendingReview"),
  requestedTiming: text("requested_timing").notNull(),
  approvedTiming: text("approved_timing"),
  requestedEffectiveDate: text("requested_effective_date"),
  approvedEffectiveDate: text("approved_effective_date"),
  reason: text("reason").notNull(),
  requestRefund: boolean("request_refund").notNull().default(false),
  adminNotes: text("admin_notes"),
  reviewedByAdminId: integer("reviewed_by_admin_id").references(() => systemUsersTable.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "string" }),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true, mode: "string" }),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
}, (table) => ([
  uniqueIndex("ballet_enrollment_cancellation_open_assignment_idx")
    .on(table.levelAssignmentId)
    .where(sql`${table.levelAssignmentId} is not null and ${table.status} in ('pendingReview','approved')`),
  index("ballet_enrollment_cancellation_application_idx").on(table.applicationId),
  index("ballet_enrollment_cancellation_parent_idx").on(table.parentStudentId),
  index("ballet_enrollment_cancellation_status_idx").on(table.status),
  check("ballet_enrollment_cancellation_status_check", sql`${table.status} in ('pendingReview','approved','rejected','withdrawnByParent','completed')`),
  check("ballet_enrollment_cancellation_requested_timing_check", sql`${table.requestedTiming} in ('immediate','endOfPeriod')`),
  check("ballet_enrollment_cancellation_approved_timing_check", sql`${table.approvedTiming} is null or ${table.approvedTiming} in ('immediate','endOfPeriod')`),
]));

export type BalletEnrollmentCancellationRequest = typeof balletEnrollmentCancellationRequestsTable.$inferSelect;
