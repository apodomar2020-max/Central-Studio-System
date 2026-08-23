import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { studentsTable } from "./students";
import { systemUsersTable } from "./systemUsers";

/**
 * Phase B3B0-2: deletion-preparation freeze foundation.
 *
 * A dedicated, deliberately small workflow table tracking whether an
 * (already-deactivated) Student currently has an active "deletion
 * preparation" underway. This is NOT a 4th account_status value —
 * preparation is an orthogonal administrative workflow concept, not an
 * authentication/access state. While a PREPARING row is active for a
 * student, identity-changing email PATCHes are rejected (see
 * studentEmailChangeService.ts) and Reactivate is rejected — both with a
 * stable 409 STUDENT_DELETION_PREPARATION_ACTIVE response.
 *
 * No raw email, no fingerprint, no child/financial PII is stored here.
 *
 * studentId FK uses onDelete: "restrict", matching the provenance table's
 * pattern — this table must never silently lose rows.
 */
export const studentDeletionWorkflowsTable = pgTable("student_deletion_workflows", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").notNull().references(() => studentsTable.id, { onDelete: "restrict" }),
  status: text("status").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  startedByAdminId: integer("started_by_admin_id").references(() => systemUsersTable.id, { onDelete: "set null" }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "string" }),
  cancelledByAdminId: integer("cancelled_by_admin_id").references(() => systemUsersTable.id, { onDelete: "set null" }),
  policyVersion: text("policy_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => ([
  // At most one ACTIVE (PREPARING) preparation per student.
  uniqueIndex("student_deletion_workflows_active_per_student")
    .on(table.studentId)
    .where(sql`${table.status} = 'PREPARING'`),
  index("student_deletion_workflows_student_idx").on(table.studentId, table.startedAt),
  check("student_deletion_workflows_status_check", sql`${table.status} in ('PREPARING', 'CANCELLED')`),
  check(
    "student_deletion_workflows_cancelled_consistency_check",
    sql`(${table.status} = 'CANCELLED' and ${table.cancelledAt} is not null) or (${table.status} = 'PREPARING' and ${table.cancelledAt} is null)`,
  ),
]));

export type StudentDeletionWorkflow = typeof studentDeletionWorkflowsTable.$inferSelect;
export type InsertStudentDeletionWorkflow = typeof studentDeletionWorkflowsTable.$inferInsert;
