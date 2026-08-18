import { sql } from "drizzle-orm";
import { check, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { systemUsersTable } from "./systemUsers";

/**
 * website_background_settings — Admin-editable background media for the 8
 * approved public-website sections (Website CMS Wave 1).
 *
 * Generalizes the background_music_settings precedent (singleton row +
 * version + updated-by admin FK) from one settings row to a fixed, keyed
 * set of 8 rows — see lib/db/src/websiteBackgroundSections.ts for the
 * authoritative list of section keys this table is seeded with.
 *
 * There is no create/delete route for this table (see
 * artifacts/api-server/src/routes/websiteBackgrounds.ts) — rows are
 * created once by the seed step (scripts/src/seedWebsiteBackgrounds.ts)
 * and only ever updated afterward. The section_key CHECK constraint below
 * is defense-in-depth on top of that application-level restriction.
 *
 * media_url NULL means "use the section's own built-in default" — the
 * website keeps every current hardcoded asset as a local fallback constant
 * in its own component, so an empty or missing row can never blank a
 * section (see the website-side integration, Wave 1 report §12).
 *
 * media_kind is SERVER-DERIVED at write time (never accepted from Admin
 * input — see websiteBackgroundMediaUrl.ts) from a live Content-Type check
 * against the section's fixed allowedMediaKind.
 */
export const websiteBackgroundSettingsTable = pgTable("website_background_settings", {
  id: serial("id").primaryKey(),
  sectionKey: text("section_key").notNull().unique(),
  page: text("page").notNull(),
  sectionLabel: text("section_label").notNull(),
  mediaUrl: text("media_url"),
  mediaKind: text("media_kind"),
  version: integer("version").notNull().default(1),
  updatedByAdminId: integer("updated_by_admin_id").references(() => systemUsersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
}, (table) => [
  // Defense-in-depth mirror of WEBSITE_BACKGROUND_SECTION_KEYS
  // (lib/db/src/websiteBackgroundSections.ts) — keep these two lists in
  // sync by hand if the approved section scope ever changes; a CHECK
  // constraint cannot import a TS module.
  check(
    "website_background_settings_section_key_check",
    sql`${table.sectionKey} IN (
      'home.section1', 'home.section3',
      'about-studio.section1', 'about-studio.section4', 'about-studio.section7',
      'ballet.section1', 'ballet.section2',
      'classes.section1'
    )`,
  ),
  check("website_background_settings_page_check", sql`${table.page} IN ('home','about-studio','ballet','classes')`),
  check("website_background_settings_media_kind_check", sql`${table.mediaKind} IS NULL OR ${table.mediaKind} IN ('image','video')`),
  check("website_background_settings_version_positive", sql`${table.version} >= 1`),
]);

export type WebsiteBackgroundSetting = typeof websiteBackgroundSettingsTable.$inferSelect;
export type InsertWebsiteBackgroundSetting = typeof websiteBackgroundSettingsTable.$inferInsert;
