import { boolean, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

/**
 * ballet_levels — ordered list of ballet levels managed by admin.
 *
 * Seeded with Pre-Ballet + Ballet Level 1–9 in migration 0009.
 * Admin can add, rename, reorder, and deactivate levels from the
 * Settings page in the admin portal.
 */
export const balletLevelsTable = pgTable("ballet_levels", {
  id:           serial("id").primaryKey(),
  name:         text("name").notNull().unique(),
  sortOrder:    integer("sort_order").notNull().default(0),
  isActive:     boolean("is_active").notNull().default(true),
  description:  text("description"),
  requirements: text("requirements"),
  imageUrl:     text("image_url"),
  // Applicable age range for the level, within the ballet program's 4–14 span.
  ageMin:       integer("age_min"),
  ageMax:       integer("age_max"),
  createdAt:    timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const insertBalletLevelSchema = z.object({
  name:         z.string().min(1),
  sortOrder:    z.number().int().min(0).optional(),
  isActive:     z.boolean().optional(),
  description:  z.string().optional(),
  requirements: z.string().optional(),
  imageUrl:     z.string().url().nullable().optional(),
  ageMin:       z.number().int().min(4).max(14).optional(),
  ageMax:       z.number().int().min(4).max(14).optional(),
});

export const updateBalletLevelSchema = insertBalletLevelSchema.partial();

export type BalletLevel = typeof balletLevelsTable.$inferSelect;
export type InsertBalletLevel = z.infer<typeof insertBalletLevelSchema>;
export type UpdateBalletLevel = z.infer<typeof updateBalletLevelSchema>;
