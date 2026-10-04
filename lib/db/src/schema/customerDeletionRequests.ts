import { sql } from "drizzle-orm";
import { pgTable, uuid, integer, text, timestamp, jsonb, index, check } from "drizzle-orm/pg-core";
import { studentsTable } from "./students";
import { studentDeletionWorkflowsTable } from "./studentDeletionWorkflows";

export const customerDeletionRequestsTable = pgTable("customer_deletion_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  studentId: integer("student_id").notNull().unique().references(() => studentsTable.id, { onDelete: "restrict" }),
  status: text("status").notNull().default("proof"),
  proofHash: text("proof_hash"), proofExpiresAt: timestamp("proof_expires_at", { withTimezone: true, mode: "string" }),
  tokenVersion: integer("token_version").notNull(),
  workflowId: integer("workflow_id").references(() => studentDeletionWorkflowsTable.id, { onDelete: "restrict" }),
  blockers: jsonb("blockers").$type<Array<{ key: string; label: string }>>().notNull().default([]),
  appleRevocation: text("apple_revocation").notNull().default("not_applicable"),
  policyVersion: text("policy_version").notNull().default("1"),
  requestedAt: timestamp("requested_at", { withTimezone: true, mode: "string" }),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, t => [index("customer_deletion_pending_idx").on(t.status, t.updatedAt),
  check("customer_deletion_requests_status_check", sql`${t.status} IN ('proof','pending','completed')`),
  check("customer_deletion_requests_apple_revocation_check", sql`${t.appleRevocation} IN ('not_applicable','pending','revoked','manual_required')`),
]);
