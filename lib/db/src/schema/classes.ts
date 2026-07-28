import { boolean, check, integer, pgTable, serial, smallint, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const classesTable = pgTable("classes", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  instructorId: integer("instructor_id"),
  // Legacy free-text category — retained only during the dance-style migration.
  category: text("category").notNull(),
  /** FK → dance_types.id. Target of the CMS migration (ID-based relationship). */
  danceTypeId: integer("dance_type_id"),
  level: text("level").notNull().default("All Levels"),
  ageGroup: text("age_group").notNull().default("Adults"),
  // Phase A: nullable together for legacy compatibility. Once configured,
  // allowAllAges/minAge/maxAge are the technical eligibility authority.
  allowAllAges: boolean("allow_all_ages"),
  minAge: smallint("min_age"),
  maxAge: smallint("max_age"),
  durationMins: integer("duration_mins").notNull().default(60),
  capacity: integer("capacity").notNull().default(20),
  photoUrl: text("photo_url"),
  classVideoUrl: text("class_video_url"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
}, (table) => ([
  check("classes_age_range_shape_check", sql`
    (${table.allowAllAges} is null and ${table.minAge} is null and ${table.maxAge} is null)
    or (${table.allowAllAges} = true and ${table.minAge} is null and ${table.maxAge} is null)
    or (
      ${table.allowAllAges} = false
      and ${table.minAge} is not null
      and ${table.minAge} between 0 and 150
      and (${table.maxAge} is null or (${table.maxAge} between 0 and 150 and ${table.minAge} <= ${table.maxAge}))
    )
  `),
]));

export const insertClassSchema = createInsertSchema(classesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertClass = z.infer<typeof insertClassSchema>;
export type Class = typeof classesTable.$inferSelect;
