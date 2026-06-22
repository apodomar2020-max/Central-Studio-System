import { boolean, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const danceTypesTable = pgTable("dance_types", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  // ── CMS metadata (all nullable; additive so future fields slot in cleanly) ──
  description: text("description"),
  /** Optional external icon URL (SVG or PNG) — fallback when no uploaded SVG. */
  iconUrl: text("icon_url"),
  /** Sanitized uploaded SVG markup, served via GET /api/dance-types/:id/icon.svg. */
  iconSvg: text("icon_svg"),
  iconMime: text("icon_mime"),
  /** Optional cover image URL (future style landing pages / programs). */
  coverImageUrl: text("cover_image_url"),
  /** Brand color (hex), e.g. "#00B6D7". */
  color: text("color"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
});

export type DanceType = typeof danceTypesTable.$inferSelect;
export type InsertDanceType = typeof danceTypesTable.$inferInsert;
