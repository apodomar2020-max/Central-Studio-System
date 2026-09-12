import { sql } from "drizzle-orm";
import { check, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { systemUsersTable } from "./systemUsers";

/**
 * editorial_authors — Unified Editorial CMS Wave 1 (additive foundation).
 *
 * Byline identities for editorial posts. Deliberately a first-class entity
 * rather than the denormalized author_name/author_role/author_avatar_url
 * triple used by website_news_posts: an author can be edited once and every
 * DRAFT post picks the change up, while PUBLISHED posts keep the frozen
 * `author_snapshot` they were published with (see editorialPosts.ts).
 *
 * `systemUserId` is an OPTIONAL link to the admin account that "is" this
 * author. ON DELETE SET NULL (same pattern as websiteNewsPosts'
 * updatedByAdminId) — deleting an admin account must never delete or
 * orphan published bylines.
 *
 * Status is `active` | `archived` (soft-hide, no physical delete route),
 * stored as text + a DB CHECK constraint, with the canonical zod enum
 * exported alongside — the balletPerformanceOpportunities.ts convention.
 * An archived author cannot be newly assigned to a post, and a post cannot
 * be PUBLISHED with an archived (or biography-less) author.
 */
export const EDITORIAL_AUTHOR_STATUSES = ["active", "archived"] as const;
export const editorialAuthorStatusSchema = z.enum(EDITORIAL_AUTHOR_STATUSES);
export type EditorialAuthorStatus = z.infer<typeof editorialAuthorStatusSchema>;

export const editorialAuthorsTable = pgTable("editorial_authors", {
  id:           serial("id").primaryKey(),
  publicName:   text("public_name").notNull(),
  role:         text("role").notNull(),
  biography:    text("biography"),
  avatarUrl:    text("avatar_url"),
  systemUserId: integer("system_user_id").references(() => systemUsersTable.id, { onDelete: "set null" }),
  status:       text("status").notNull().default("active").$type<EditorialAuthorStatus>(),
  createdAt:    timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
}, (table) => [
  check("editorial_authors_public_name_not_blank", sql`length(trim(${table.publicName})) > 0`),
  check("editorial_authors_role_not_blank", sql`length(trim(${table.role})) > 0`),
  check("editorial_authors_status_valid", sql`${table.status} IN ('active', 'archived')`),
]);

export type EditorialAuthor = typeof editorialAuthorsTable.$inferSelect;
export type InsertEditorialAuthor = typeof editorialAuthorsTable.$inferInsert;
