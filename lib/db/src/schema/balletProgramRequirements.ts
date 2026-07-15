import { boolean, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const balletProgramRequirementSectionsTable = pgTable("ballet_program_requirement_sections", {
  id:          serial("id").primaryKey(),
  title:       text("title").notNull(),
  description: text("description"),
  sortOrder:   integer("sort_order").notNull().default(0),
  isActive:    boolean("is_active").notNull().default(true),
  createdAt:   timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
});

export const balletProgramRequirementItemsTable = pgTable("ballet_program_requirement_items", {
  id:        serial("id").primaryKey(),
  sectionId: integer("section_id").notNull().references(() => balletProgramRequirementSectionsTable.id, { onDelete: "cascade" }),
  text:      text("text").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive:  boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
});

export const insertBalletProgramRequirementSectionSchema = createInsertSchema(balletProgramRequirementSectionsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});

export const updateBalletProgramRequirementSectionSchema = insertBalletProgramRequirementSectionSchema.partial();

export const insertBalletProgramRequirementItemSchema = createInsertSchema(balletProgramRequirementItemsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});

export const updateBalletProgramRequirementItemSchema = insertBalletProgramRequirementItemSchema.partial();

export type BalletProgramRequirementSection = typeof balletProgramRequirementSectionsTable.$inferSelect;
export type InsertBalletProgramRequirementSection = z.infer<typeof insertBalletProgramRequirementSectionSchema>;
export type UpdateBalletProgramRequirementSection = z.infer<typeof updateBalletProgramRequirementSectionSchema>;
export type BalletProgramRequirementItem = typeof balletProgramRequirementItemsTable.$inferSelect;
export type InsertBalletProgramRequirementItem = z.infer<typeof insertBalletProgramRequirementItemSchema>;
export type UpdateBalletProgramRequirementItem = z.infer<typeof updateBalletProgramRequirementItemSchema>;
