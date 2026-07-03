import { integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { systemUsersTable } from "./systemUsers";

/**
 * admin_activity_logs — unified admin-facing audit trail (Phase 7B).
 *
 * One row per sensitive admin mutation (create/update/delete/status change…).
 * Written by api-server/src/lib/activityLog.ts AFTER the business action
 * succeeds — never inside the business transaction, so a logging failure can
 * never roll back or break the action.
 *
 * Actor attribution follows the ballet_application_events precedent:
 * actor_id references system_users with ON DELETE SET NULL so history rows
 * survive admin deletion, while actor_name/actor_email are denormalized
 * snapshots that keep the row meaningful after the FK is nulled.
 *
 * before/after hold a REDACTED, diff-only subset of fields — never passwords,
 * hashes, tokens, OTPs, or full permission maps (see activityLog.ts).
 */
export const adminActivityLogsTable = pgTable("admin_activity_logs", {
  id: serial("id").primaryKey(),
  actorId: integer("actor_id").references(() => systemUsersTable.id, { onDelete: "set null" }),
  actorName: text("actor_name").notNull(),
  actorEmail: text("actor_email").notNull(),
  action: text("action").notNull(),
  module: text("module").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  entityLabel: text("entity_label"),
  before: jsonb("before").$type<Record<string, unknown> | null>(),
  after: jsonb("after").$type<Record<string, unknown> | null>(),
  summary: text("summary").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export type AdminActivityLog = typeof adminActivityLogsTable.$inferSelect;
export type InsertAdminActivityLog = typeof adminActivityLogsTable.$inferInsert;
