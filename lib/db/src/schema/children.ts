import { date, integer, pgTable, serial, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { studentsTable } from "./students";

/**
 * children — child profiles owned by a parent student account.
 *
 * Ownership is enforced at the API layer by scoping all queries to
 * WHERE parent_id = <authenticated student id>.
 *
 * qrToken is reserved for future child-specific QR check-in flow.
 * It is auto-generated on insert and never exposed via API.
 */
export const childrenTable = pgTable("children", {
  id:            serial("id").primaryKey(),
  parentId:      integer("parent_id").notNull().references(() => studentsTable.id, { onDelete: "cascade" }),
  fullName:      text("full_name").notNull(),
  // Canonical DOB for new eligibility work. Legacy birthday/age remain
  // temporarily readable until the separately approved pre-launch reset.
  dateOfBirth:   date("date_of_birth", { mode: "string" }),
  birthday:      text("birthday"),
  age:           integer("age"),
  gender:        text("gender").notNull().default("female"),
  medicalNotes:  text("medical_notes"),
  emergencyName: text("emergency_name"),
  emergencyPhone:text("emergency_phone"),
  qrToken:       uuid("qr_token").notNull().defaultRandom().unique(),
  createdAt:     timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
});

// parentId and qrToken are set server-side — omit from insert schema.
export const insertChildSchema = createInsertSchema(childrenTable).omit({
  id: true,
  parentId: true,
  qrToken: true,
  createdAt: true,
  updatedAt: true,
});

export const updateChildSchema = insertChildSchema.partial();

export type InsertChild = z.infer<typeof insertChildSchema>;
export type UpdateChild = z.infer<typeof updateChildSchema>;
export type Child = typeof childrenTable.$inferSelect;
