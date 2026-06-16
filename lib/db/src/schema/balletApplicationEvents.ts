import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { balletApplicationsTable } from "./balletApplications";
import { systemUsersTable } from "./systemUsers";

/**
 * ballet_application_events — append-only audit trail of status changes.
 *
 * Every call to PATCH /api/admin/ballet/applications/:id/status inserts
 * one row here inside the same transaction that updates the application.
 *
 * from_status is NULL for the initial "submitted" event (the creation event
 * written by POST /api/ballet/applications when the form is first submitted).
 *
 * changed_by_id links to the admin who made the change.
 * ON DELETE SET NULL: deleting an admin account preserves the history row —
 * the timestamp remains, only the attribution is cleared.
 */
export const balletApplicationEventsTable = pgTable("ballet_application_events", {
  id:            serial("id").primaryKey(),
  applicationId: integer("application_id").notNull().references(() => balletApplicationsTable.id, { onDelete: "cascade" }),
  fromStatus:    text("from_status"),
  toStatus:      text("to_status").notNull(),
  changedById:   integer("changed_by_id").references(() => systemUsersTable.id, { onDelete: "set null" }),
  note:          text("note"),
  createdAt:     timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export type BalletApplicationEvent = typeof balletApplicationEventsTable.$inferSelect;
