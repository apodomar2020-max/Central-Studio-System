import { boolean, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { balletInstructorsTable } from "./balletInstructors";

/**
 * ballet_classes — class catalogue for the Ballet system, independent of the
 * generic `classes` table.
 *
 * Which groups and levels a class belongs to are tracked via the
 * ballet_class_groups / ballet_class_levels join tables (many-to-many).
 */
export const balletClassesTable = pgTable("ballet_classes", {
  id:            serial("id").primaryKey(),
  title:         text("title").notNull(),
  instructorId:  integer("instructor_id").references(() => balletInstructorsTable.id, { onDelete: "set null" }),
  classImageUrl: text("class_image_url"),
  classVideoUrl: text("class_video_url"),
  isActive:      boolean("is_active").notNull().default(true),
  createdAt:     timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
});

export const insertBalletClassSchema = createInsertSchema(balletClassesTable).omit({
  id: true, createdAt: true, updatedAt: true,
});

export const updateBalletClassSchema = insertBalletClassSchema.partial();

export type BalletClass = typeof balletClassesTable.$inferSelect;
export type InsertBalletClass = z.infer<typeof insertBalletClassSchema>;
export type UpdateBalletClass = z.infer<typeof updateBalletClassSchema>;
