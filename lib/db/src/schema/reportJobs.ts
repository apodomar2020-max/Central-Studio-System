import { integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { systemUsersTable } from "./systemUsers";

export const reportJobsTable = pgTable("report_jobs", {
  id: serial("id").primaryKey(),
  entity: text("entity").notNull(),
  format: text("format").notNull().default("json"),
  status: text("status").notNull().default("queued"),
  filters: jsonb("filters").$type<Record<string, unknown> | null>(),
  resultUrl: text("result_url"),
  errorMessage: text("error_message"),
  requestedByAdminId: integer("requested_by_admin_id").references(() => systemUsersTable.id, { onDelete: "set null" }),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
});

export type ReportJob = typeof reportJobsTable.$inferSelect;
