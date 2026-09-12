import { sql } from "drizzle-orm";
import { check, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { systemUsersTable } from "./systemUsers";
import { type EditorialChannel } from "./editorialTopics";

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
 *
 * ─── CHANNEL SCOPING (Wave 1.1) ──────────────────────────────────────────
 *
 * `channel` is NOT NULL with no default. An author belongs to exactly one
 * editorial channel — the same person writing for both surfaces is two
 * author rows, deliberately, so a News byline can never appear on an
 * Experience post by accident. Added as NOT NULL directly rather than
 * nullable-then-backfilled because this table is PRE-RELEASE: migration
 * 0126 has only ever been applied to disposable local databases (it is not
 * on origin/main and this branch is unmerged), so there is no real data to
 * backfill anywhere.
 *
 * THE INVARIANT: editorial_posts.author_id's author.channel MUST equal
 * editorial_posts.channel. Enforced at BOTH layers:
 *
 *   * SERVICE LAYER — `assertAuthorAssignableToChannel` in
 *     editorialPostsService.ts, called on every write path that sets or
 *     changes author_id (post create, post shared-field update). This is
 *     the layer that produces a readable 400 naming both channels.
 *   * DATABASE — the `guard_editorial_post_author_channel` BEFORE INSERT
 *     OR UPDATE trigger on editorial_posts (migration 0126 section 9),
 *     which re-reads the author row and RAISES on a mismatch. A plain
 *     CHECK cannot express this (it needs a cross-table lookup), and a
 *     composite FK (author_id, channel) -> (id, channel) is not usable
 *     here either: it would require ON DELETE SET NULL to null BOTH
 *     columns, and editorial_posts.channel is NOT NULL, so deleting an
 *     author would fail instead of orphaning the byline. The trigger is
 *     therefore the strongest mechanism that preserves Wave 1's
 *     "deleting an author must never delete a post" rule.
 *
 * A companion `guard_editorial_author_channel_immutable` trigger forbids
 * changing an author's channel while any post references them, so the
 * invariant cannot be broken from the author side either.
 */
export const EDITORIAL_AUTHOR_STATUSES = ["active", "archived"] as const;
export const editorialAuthorStatusSchema = z.enum(EDITORIAL_AUTHOR_STATUSES);
export type EditorialAuthorStatus = z.infer<typeof editorialAuthorStatusSchema>;

export const editorialAuthorsTable = pgTable("editorial_authors", {
  id:           serial("id").primaryKey(),
  channel:      text("channel").notNull().$type<EditorialChannel>(),
  publicName:   text("public_name").notNull(),
  role:         text("role").notNull(),
  biography:    text("biography"),
  avatarUrl:    text("avatar_url"),
  systemUserId: integer("system_user_id").references(() => systemUsersTable.id, { onDelete: "set null" }),
  status:       text("status").notNull().default("active").$type<EditorialAuthorStatus>(),
  createdAt:    timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
}, (table) => [
  check("editorial_authors_channel_valid", sql`${table.channel} IN ('news', 'experience')`),
  check("editorial_authors_public_name_not_blank", sql`length(trim(${table.publicName})) > 0`),
  check("editorial_authors_role_not_blank", sql`length(trim(${table.role})) > 0`),
  check("editorial_authors_status_valid", sql`${table.status} IN ('active', 'archived')`),
]);

export type EditorialAuthor = typeof editorialAuthorsTable.$inferSelect;
export type InsertEditorialAuthor = typeof editorialAuthorsTable.$inferInsert;
