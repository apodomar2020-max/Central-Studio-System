import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

/**
 * ballet_settings — single-row admin-managed mobile presentation configuration.
 *
 * Always has exactly one row (id = 1), seeded in migration 0009.
 * Mobile reads via GET /api/ballet/settings (public, no auth required).
 * Admin updates via PATCH /api/admin/ballet/settings.
 */
export const balletSettingsTable = pgTable("ballet_settings", {
  id:                serial("id").primaryKey(),
  homeCardImageUrl:  text("home_card_image_url"),
  whatsappNumber:   text("whatsapp_number"),
  phoneNumber:      text("phone_number"),
  email:            text("email"),
  studioLocationUrl: text("studio_location_url"),
  updatedAt:         timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const updateBalletSettingsSchema = z.object({
  homeCardImageUrl:  z.string().url().nullable().optional(),
  whatsappNumber:   z.string().nullable().optional(),
  phoneNumber:      z.string().nullable().optional(),
  email:            z.string().email().nullable().optional(),
  studioLocationUrl: z.string().url().nullable().optional(),
});

export type BalletSettings = typeof balletSettingsTable.$inferSelect;
export type UpdateBalletSettings = z.infer<typeof updateBalletSettingsSchema>;
