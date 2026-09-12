import { sql } from "drizzle-orm";
import { check, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { systemUsersTable } from "./systemUsers";

/**
 * editorial_website_links — Website Settings > Links (Wave 1.1).
 *
 * The public website's app-store download links, editable from Admin.
 *
 * ─── WHY A DEDICATED SINGLE-ROW TABLE ────────────────────────────────────
 *
 * The repo was searched for a generic Website settings key/value store to
 * extend before inventing anything: there is none. What exists is a
 * consistent DEDICATED-SETTINGS-TABLE convention —
 *
 *   ballet_settings              single row (id = 1), typed columns
 *   background_music_settings    single row, typed columns + version
 *   class_capacity_settings,
 *   class_pricing_settings,
 *   class_reminder_settings      same shape
 *   website_background_settings  a fixed KEYED set of 8 rows
 *
 * — every one of them typed columns rather than a `key`/`value` bag, so
 * each setting gets its own type, its own CHECK constraints, and its own
 * generated API field. This table follows `ballet_settings` exactly: ONE
 * row, id = 1, seeded by the migration, with no create and no delete
 * route — only GET and PATCH.
 *
 * website_background_settings was deliberately NOT extended. It is the
 * Background CMS's own table, it is out of scope for this work, and
 * bolting unrelated app-store URLs onto the table that drives eight
 * approved background media slots would couple two domains that have
 * nothing to do with each other (and would put these links behind
 * `website.backgrounds` permissions, which is exactly the RBAC mistake
 * the spec warns against). Nothing here reads, writes, or references
 * website_background_settings.
 *
 * ─── VALIDATION ──────────────────────────────────────────────────────────
 *
 * Both URLs are NULLABLE — "no link yet" is a legitimate state and the
 * website falls back to hiding the badge rather than rendering a dead
 * link. When non-empty, a URL must be:
 *   * HTTPS only (http:// rejected) — these render as store badges on a
 *     public page; an http link is a downgrade vector.
 *   * a parseable absolute URL with a host,
 *   * free of HTML/markup characters (< > " ' and backslash) so a value
 *     can never break out of an attribute context wherever it is
 *     interpolated.
 * Enforced in the service layer (editorialWebsiteLinksService.ts) for the
 * readable error message, and restated as the CHECK constraints below so
 * the shape is also a database guarantee. Empty strings are normalized to
 * NULL on write, so "" and NULL cannot both mean "unset".
 */
export const editorialWebsiteLinksTable = pgTable("editorial_website_links", {
  id:               serial("id").primaryKey(),
  googlePlayUrl:    text("google_play_url"),
  appStoreUrl:      text("app_store_url"),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
  updatedByAdminId: integer("updated_by_admin_id").references(() => systemUsersTable.id, { onDelete: "set null" }),
}, (table) => [
  // Single-row invariant: the migration seeds id = 1 and no route creates
  // or deletes rows, so this CHECK makes a second row impossible even from
  // hand-written SQL.
  check("editorial_website_links_singleton", sql`${table.id} = 1`),
  check(
    "editorial_website_links_google_play_url_https",
    sql`${table.googlePlayUrl} IS NULL OR ${table.googlePlayUrl} ~ '^https://[^\\s<>"''\\\\]+$'`,
  ),
  check(
    "editorial_website_links_app_store_url_https",
    sql`${table.appStoreUrl} IS NULL OR ${table.appStoreUrl} ~ '^https://[^\\s<>"''\\\\]+$'`,
  ),
]);

export type EditorialWebsiteLinks = typeof editorialWebsiteLinksTable.$inferSelect;
export type InsertEditorialWebsiteLinks = typeof editorialWebsiteLinksTable.$inferInsert;
