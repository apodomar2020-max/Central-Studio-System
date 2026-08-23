import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { studentsTable } from "./students";
import { systemUsersTable } from "./systemUsers";

/**
 * Phase B3B0-1A: forward-looking email-ownership provenance.
 *
 * Records a temporal interval of which Student owned a given (fingerprinted)
 * normalized email address. NO raw email is stored — only a versioned HMAC
 * fingerprint (see lib/studentEmailProvenance.ts). This table is written to
 * going forward only; it is never backfilled from historical
 * bookings/package_orders/feedback/attendance/credit_transactions rows, and
 * pre-activation (pre-T0) history is simply absent by design — absence of a
 * row for a given period means "ownership not provable", not "unowned".
 *
 * studentId FK uses onDelete: "restrict" — this table must never silently
 * lose rows if a student row is ever touched by a future tombstone phase.
 */
export const studentEmailIdentityHistoryTable = pgTable("student_email_identity_history", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").notNull().references(() => studentsTable.id, { onDelete: "restrict" }),
  emailFingerprint: text("email_fingerprint").notNull(),
  validFrom: timestamp("valid_from", { withTimezone: true, mode: "string" }).notNull(),
  validTo: timestamp("valid_to", { withTimezone: true, mode: "string" }),
  source: text("source").notNull(),
  changedByAdminId: integer("changed_by_admin_id").references(() => systemUsersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => ([
  // At most one OPEN (current) interval per student.
  uniqueIndex("student_email_identity_history_open_per_student")
    .on(table.studentId)
    .where(sql`${table.validTo} is null`),
  index("student_email_identity_history_student_valid_from_idx").on(table.studentId, table.validFrom),
  index("student_email_identity_history_fingerprint_valid_from_idx").on(table.emailFingerprint, table.validFrom),
  check("student_email_identity_history_interval_check", sql`${table.validTo} is null or ${table.validTo} > ${table.validFrom}`),
  check("student_email_identity_history_source_check", sql`${table.source} in ('bootstrap', 'admin_update', 'registration', 'self_service')`),
  // "v<algo-version>:k<key-id>:<64 lowercase hex>" — see studentEmailProvenance.ts.
  check("student_email_identity_history_fingerprint_format_check", sql`${table.emailFingerprint} ~ '^v[0-9]+:k[0-9]+:[0-9a-f]{64}$'`),
]));

export type StudentEmailIdentityHistory = typeof studentEmailIdentityHistoryTable.$inferSelect;
export type InsertStudentEmailIdentityHistory = typeof studentEmailIdentityHistoryTable.$inferInsert;
