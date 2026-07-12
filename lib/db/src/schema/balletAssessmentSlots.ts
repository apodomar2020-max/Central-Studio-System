import { boolean, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * ballet_assessment_slots — appointment slots created and managed by admin.
 *
 * Mobile reads active future slots via GET /api/ballet/assessment-slots.
 * Admin creates / edits / disables via the Slots section of the admin portal.
 *
 * bookedCount is always computed at query time from ballet_applications —
 * it is NOT a stored column. This prevents counter drift.
 */
export const balletAssessmentSlotsTable = pgTable("ballet_assessment_slots", {
  id:        serial("id").primaryKey(),
  date:      text("date").notNull(),       // ISO date "2026-07-05"
  startTime: text("start_time").notNull(), // "10:00 AM"
  endTime:   text("end_time").notNull(),   // "10:30 AM"
  capacity:  integer("capacity").notNull().default(10),
  notes:     text("notes"),
  // Optional age restriction for the slot (exact age or narrow range).
  // Both null = open to all ages.
  ageMin:    integer("age_min"),
  ageMax:    integer("age_max"),
  isActive:  boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
});

export const insertBalletSlotSchema = createInsertSchema(balletAssessmentSlotsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});

export const updateBalletSlotSchema = insertBalletSlotSchema.partial();

export type BalletAssessmentSlot = typeof balletAssessmentSlotsTable.$inferSelect;
export type InsertBalletSlot = z.infer<typeof insertBalletSlotSchema>;
export type UpdateBalletSlot = z.infer<typeof updateBalletSlotSchema>;
