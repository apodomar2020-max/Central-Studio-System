import { boolean, integer, pgTable, real, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const instructorsTable = pgTable("instructors", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  bio: text("bio"),
  photoUrl: text("photo_url"),
  specialties: text("specialties").array().notNull().default([]),
  experienceYears: integer("experience_years").notNull().default(0),
  rating: real("rating"),
  isActive: boolean("is_active").notNull().default(true),
  // Social media links
  instagramUrl: text("instagram_url"),
  tiktokUrl: text("tiktok_url"),
  youtubeUrl: text("youtube_url"),
  // Profile extras
  teachingLevel: text("teaching_level"), // e.g. "All Levels", "Beginner", "Advanced"
  achievements: text("achievements").array().notNull().default([]),
  // CMS-managed long-form fields shown on the instructor profile.
  teachingPhilosophy: text("teaching_philosophy"),
  // Professional experience timeline. INTENTIONALLY a simple text[]: each element
  // is ONE display-ready timeline line (e.g. "Role · Place · Years"), authored one
  // per line in the admin CMS and rendered as one timeline row in the app. Not a
  // structured {role,place,years} object — kept flat on purpose (the codebase has
  // no structured-list editor; this avoids over-engineering).
  professionalExperience: text("professional_experience").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
});

export const insertInstructorSchema = createInsertSchema(instructorsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInstructor = z.infer<typeof insertInstructorSchema>;
export type Instructor = typeof instructorsTable.$inferSelect;
