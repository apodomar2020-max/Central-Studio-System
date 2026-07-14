import { index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { balletApplicationsTable } from "./balletApplications";
import { childrenTable } from "./children";
import { balletLevelsTable } from "./balletLevels";
import { balletGroupsTable } from "./balletGroups";
import {
  BALLET_LEVEL_ASSIGNMENT_STATUSES,
  type BalletLevelAssignmentStatus,
} from "@workspace/api-zod";

export { BALLET_LEVEL_ASSIGNMENT_STATUSES };
export type { BalletLevelAssignmentStatus };

/**
 * ballet_level_assignments — active enrollment records.
 *
 * One row = one child enrolled in one level for one billing period.
 * A child may have multiple rows across different seasons or if they advance.
 *
 * level_id uses ON DELETE RESTRICT: you must move all enrolled children
 * off a level before deleting it, preventing silent data loss.
 *
 * group_id (Phase 4E) is nullable — a level assignment starts groupless and
 * is only group-assigned afterward; onDelete "set null" so deleting a group
 * never destroys enrollment history, it just un-assigns the group.
 *
 * Status values: active | paused | graduated | withdrawn
 */
export const balletLevelAssignmentsTable = pgTable("ballet_level_assignments", {
  id:            serial("id").primaryKey(),
  applicationId: integer("application_id").notNull().references(() => balletApplicationsTable.id, { onDelete: "cascade" }),
  childId:       integer("child_id").references(() => childrenTable.id, { onDelete: "set null" }),
  levelId:       integer("level_id").notNull().references(() => balletLevelsTable.id, { onDelete: "restrict" }),
  groupId:       integer("group_id").references(() => balletGroupsTable.id, { onDelete: "set null" }),
  enrolledAt:    timestamp("enrolled_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  billingStart:  text("billing_start"),   // e.g. "2026-08"
  status:        text("status").notNull().default("active"),
  notes:         text("notes"),
  createdAt:     timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
}, (table) => ({
  groupIdIdx: index("ballet_level_assignments_group_id_idx").on(table.groupId),
}));

export type BalletLevelAssignment = typeof balletLevelAssignmentsTable.$inferSelect;
