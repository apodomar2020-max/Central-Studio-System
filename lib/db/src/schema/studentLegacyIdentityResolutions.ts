import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { studentsTable } from "./students";
import { systemUsersTable } from "./systemUsers";
import { studentDeletionWorkflowsTable } from "./studentDeletionWorkflows";

/**
 * Phase B3B2E: Level-B manual resolution decision layer.
 *
 * Durable, append-only history of Admin decisions on Level-B legacy-row
 * ownership candidates surfaced by the B3B1 planner's domain-candidate
 * universe. A Level-B candidate (currently: a package_orders row corroborated
 * by BOTH credit_transactions.studentId and attendance.studentId, both
 * independently pointing at the same student via packageOrderId, with zero
 * conflicts) can never be auto-backfilled — it requires an explicit Admin
 * decision, recorded here.
 *
 * APPEND-ONLY: a new resolution attempt for the same (studentId, domain,
 * targetRecordId) pair is always a NEW row, never an UPDATE. The "current"
 * resolution for a pair is simply the most recent row (by resolvedAt, then
 * id) for that pair — see resolveManualResolution.currentResolutionFor().
 * This preserves full decision history without a separate supersede
 * mechanism.
 *
 * SCOPE: every row is studentId-scoped. A NOT_THIS_STUDENT decision for
 * Student A says nothing about Student B — it is never read as a global
 * statement about the candidate row.
 *
 * NO PII: no raw email, no fingerprint, no child PII, no payment detail is
 * ever stored here — only internal row identifiers, system-derived reason
 * codes, and actor/decision metadata.
 */
export const studentLegacyIdentityResolutionsTable = pgTable("student_legacy_identity_resolutions", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").notNull().references(() => studentsTable.id, { onDelete: "restrict" }),
  domain: text("domain").notNull(),
  targetRecordId: integer("target_record_id").notNull(),
  deletionWorkflowId: integer("deletion_workflow_id").notNull().references(() => studentDeletionWorkflowsTable.id, { onDelete: "restrict" }),
  evidenceLevel: text("evidence_level").notNull(),
  decision: text("decision").notNull(),
  evidenceReasonCode: text("evidence_reason_code").notNull(),
  evidenceSnapshotRef: text("evidence_snapshot_ref").notNull(),
  // Intentionally NO free-text column — see the NO PII note above. Adding one
  // would give the table the capability to persist raw PII from Admin input.
  resolvedByAdminId: integer("resolved_by_admin_id").references(() => systemUsersTable.id, { onDelete: "set null" }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => ([
  index("student_legacy_identity_resolutions_pair_idx")
    .on(table.studentId, table.domain, table.targetRecordId, table.resolvedAt),
  index("student_legacy_identity_resolutions_workflow_idx").on(table.deletionWorkflowId),
  check("student_legacy_identity_resolutions_domain_check", sql`${table.domain} in ('package_orders')`),
  check("student_legacy_identity_resolutions_evidence_level_check", sql`${table.evidenceLevel} in ('B')`),
  check(
    "student_legacy_identity_resolutions_decision_check",
    sql`${table.decision} in ('PROVEN_OWNER', 'NOT_THIS_STUDENT', 'UNRESOLVED')`,
  ),
]));

export type StudentLegacyIdentityResolution = typeof studentLegacyIdentityResolutionsTable.$inferSelect;
export type InsertStudentLegacyIdentityResolution = typeof studentLegacyIdentityResolutionsTable.$inferInsert;
