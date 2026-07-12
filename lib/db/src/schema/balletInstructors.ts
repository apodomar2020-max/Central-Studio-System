import { boolean, integer, pgTable, real, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * ballet_instructors — standalone instructor roster for the Ballet system.
 *
 * Mirrors the shape of the generic `instructors` table but is fully
 * independent of it: the Ballet system is being separated from the generic
 * Classes system, so ballet instructors no longer piggyback on `instructors`
 * via a category match.
 */
export const balletInstructorsTable = pgTable("ballet_instructors", {
  id:              serial("id").primaryKey(),
  name:            text("name").notNull(),
  bio:             text("bio"),
  photoUrl:        text("photo_url"),
  specialties:     text("specialties").array().notNull().default([]),
  experienceYears: integer("experience_years").notNull().default(0),
  rating:          real("rating"),
  isActive:        boolean("is_active").notNull().default(true),
  // Social media links
  instagramUrl:    text("instagram_url"),
  tiktokUrl:       text("tiktok_url"),
  youtubeUrl:      text("youtube_url"),
  // Profile extras
  teachingLevel:   text("teaching_level"), // e.g. "All Levels", "Beginner", "Advanced"
  achievements:    text("achievements").array().notNull().default([]),
  // CMS-managed long-form fields shown on the instructor profile.
  teachingPhilosophy: text("teaching_philosophy"),
  // One display-ready timeline line per element (same convention as `instructors`).
  professionalExperience: text("professional_experience").array().notNull().default([]),
  createdAt:       timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
});

export const insertBalletInstructorSchema = createInsertSchema(balletInstructorsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});

export const updateBalletInstructorSchema = insertBalletInstructorSchema.partial();

export type BalletInstructor = typeof balletInstructorsTable.$inferSelect;
export type InsertBalletInstructor = z.infer<typeof insertBalletInstructorSchema>;
export type UpdateBalletInstructor = z.infer<typeof updateBalletInstructorSchema>;
