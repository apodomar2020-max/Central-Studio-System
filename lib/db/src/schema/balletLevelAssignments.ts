import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { balletApplicationsTable } from "./balletApplications";
import { childrenTable } from "./children";
import { balletLevelsTable } from "./balletLevels";

/**
 * ballet_level_assignments — active enrollment records.
 *
 * One row = one child enrolled in one level for one billing period.
 * A child may have multiple rows across different seasons or if they advance.
 *
 * level_id uses ON DELETE RESTRICT: you must move all enrolled children
 * off a level before deleting it, preventing silent data loss.
 *
 * Status values: active | paused | graduated | withdrawn
 */
export const balletLevelAssignmentsTable = pgTable("ballet_level_assignments", {
  id:            serial("id").primaryKey(),
  applicationId: integer("application_id").notNull().references(() => balletApplicationsTable.id, { onDelete: "cascade" }),
  childId:       integer("child_id").references(() => childrenTable.id, { onDelete: "set null" }),
  levelId:       integer("level_id").notNull().references(() => balletLevelsTable.id, { onDelete: "restrict" }),
  enrolledAt:    timestamp("enrolled_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  billingStart:  text("billing_start"),   // e.g. "2026-08"
  status:        text("status").notNull().default("active"),
  notes:         text("notes"),
  createdAt:     timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
});

export type BalletLevelAssignment = typeof balletLevelAssignmentsTable.$inferSelect;
