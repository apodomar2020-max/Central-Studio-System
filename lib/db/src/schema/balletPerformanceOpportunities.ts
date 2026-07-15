import { date, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * ballet_performance_opportunities — admin-managed events (recitals, galas,
 * competitions) that ballet students can be invited to perform at.
 */
export const balletPerformanceOpportunitiesTable = pgTable("ballet_performance_opportunities", {
  id:           serial("id").primaryKey(),
  eventTitle:   text("event_title").notNull(),
  description:  text("description"),
  imageUrl:     text("image_url"),
  eventType:    text("event_type").notNull(),
  locationName: text("location_name"),
  eventDate:    date("event_date", { mode: "string" }).notNull(),
  startTime:    text("start_time").notNull(),
  endTime:      text("end_time").notNull(),
  requirements: text("requirements").array().notNull().default([]),
  externalCtaUrl: text("external_cta_url"),
  status:       text("status").notNull().default("active"),
  createdAt:    timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
});

export const insertBalletPerformanceOpportunitySchema = createInsertSchema(balletPerformanceOpportunitiesTable).omit({
  id: true, createdAt: true, updatedAt: true,
}).extend({
  status: z.enum(["active", "inactive"]).optional(),
});

export const updateBalletPerformanceOpportunitySchema = insertBalletPerformanceOpportunitySchema.partial();

export type BalletPerformanceOpportunity = typeof balletPerformanceOpportunitiesTable.$inferSelect;
export type InsertBalletPerformanceOpportunity = z.infer<typeof insertBalletPerformanceOpportunitySchema>;
export type UpdateBalletPerformanceOpportunity = z.infer<typeof updateBalletPerformanceOpportunitySchema>;
