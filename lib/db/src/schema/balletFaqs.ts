import { boolean, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const balletFaqsTable = pgTable("ballet_faqs", {
  id:        serial("id").primaryKey(),
  question:  text("question").notNull(),
  answer:    text("answer").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive:  boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
});

export const insertBalletFaqSchema = createInsertSchema(balletFaqsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});

export const updateBalletFaqSchema = insertBalletFaqSchema.partial();

export type BalletFaq = typeof balletFaqsTable.$inferSelect;
export type InsertBalletFaq = z.infer<typeof insertBalletFaqSchema>;
export type UpdateBalletFaq = z.infer<typeof updateBalletFaqSchema>;
