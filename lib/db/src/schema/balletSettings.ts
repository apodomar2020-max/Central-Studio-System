import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

/**
 * ballet_settings — single-row admin-managed configuration.
 *
 * Always has exactly one row (id = 1), seeded in migration 0009.
 * Mobile reads via GET /api/ballet/settings (public, no auth required).
 * Admin updates via PATCH /api/admin/ballet/settings.
 */
export const balletSettingsTable = pgTable("ballet_settings", {
  id:                        serial("id").primaryKey(),
  preBalletPriceEgp:         integer("pre_ballet_price_egp").notNull().default(1950),
  preBalletHoursMonthly:     integer("pre_ballet_hours_monthly").notNull().default(8),
  levelsPriceEgp:            integer("levels_price_egp").notNull().default(2650),
  levelsHoursMonthly:        integer("levels_hours_monthly").notNull().default(12),
  fewSeatsThreshold:         integer("few_seats_threshold").notNull().default(3),
  assessmentInstructions:    text("assessment_instructions"),
  requirements:              text("requirements"),
  acceptanceMessageTemplate: text("acceptance_message_template"),
  updatedAt:                 timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const updateBalletSettingsSchema = z.object({
  preBalletPriceEgp:         z.number().int().positive().optional(),
  preBalletHoursMonthly:     z.number().int().positive().optional(),
  levelsPriceEgp:            z.number().int().positive().optional(),
  levelsHoursMonthly:        z.number().int().positive().optional(),
  fewSeatsThreshold:         z.number().int().min(1).max(20).optional(),
  assessmentInstructions:    z.string().optional(),
  requirements:              z.string().optional(),
  acceptanceMessageTemplate: z.string().optional(),
});

export type BalletSettings = typeof balletSettingsTable.$inferSelect;
export type UpdateBalletSettings = z.infer<typeof updateBalletSettingsSchema>;
