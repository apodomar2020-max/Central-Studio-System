import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { systemUsersTable } from "./systemUsers";
import { editorialAuthorsTable } from "./editorialAuthors";
import { type EditorialChannel } from "./editorialTopics";

/**
 * editorial_posts — Unified Editorial CMS Wave 1.1 (multilingual).
 *
 * ONE LOGICAL POST, MANY LANGUAGE TRANSLATIONS.
 *
 * This row is the *identity and shared spine* of a post. Everything a
 * reader actually reads — title, slug, deck, body, SEO, status,
 * publishedAt — lives on editorial_post_translations, one row per
 * language, each with its OWN independent lifecycle. Wave 1 carried all of
 * those columns here; Wave 1.1 moved them out (see the report's §2/§3
 * classification). Nothing referenced this table in any released
 * environment, so the change is a correction to migration 0126 in place
 * rather than a follow-up migration.
 *
 * WHAT STAYS HERE (post-level SHARED, identical for every language):
 *   channel                — the news/experience discriminator. IMMUTABLE
 *                            after creation (no write path sets it; the
 *                            `guard_editorial_post_channel_immutable`
 *                            trigger enforces that in the database), which
 *                            is what makes the denormalized `channel` copy
 *                            on editorial_post_translations safe.
 *   author_id              — one byline for the logical post, not per
 *                            language. Its author's channel MUST equal
 *                            this post's channel (see editorialAuthors.ts).
 *   feature_image_url      — ONE image for all languages. The ALT TEXT for
 *                            it is per-translation (localized), because alt
 *                            text is prose and prose is translated.
 *   migration_source_*     — inert provenance for a LATER wave's content
 *                            migration; written by nothing here.
 *   created/updated/updated_by_admin_id
 *
 * WHAT MOVED TO editorial_post_translations (translation-level):
 *   title, slug, deck, context_label, body, body_version,
 *   feature_image_alt, status, published_at,
 *   reading_time_override_minutes, seo_title, seo_description,
 *   og_image_url, author_snapshot.
 *
 * `author_snapshot` moved with them on purpose: the snapshot is the byline
 * FROZEN AT PUBLISH TIME, and publishing is now a per-translation event, so
 * a snapshot can only be frozen per translation. The byline's *source* is
 * still the shared parent author.
 *
 * TOPICS, RECOMMENDATIONS and PLACEMENTS remain relational to the POST, not
 * to a translation: they are editorial classification and curation of the
 * logical story, not localized prose. No Topic localization was added in
 * this wave.
 *
 * ADDITIVE ONLY with respect to PRE-EXISTING tables. This table does not
 * read, write, alter, or replace website_news_posts or
 * website_performances, which remain the live public-website sources.
 *
 * BODY MODEL (`body` jsonb, now on the translation row): a flat, typed
 * block list —
 *   { blocks: Array<
 *       | { type: 'paragraph',     text: string }
 *       | { type: 'heading',       level: 2 | 3, text: string }
 *       | { type: 'image',         url: string, alt: string, caption?: string }
 *       | { type: 'bulleted-list', items: string[] }
 *     > }
 * No HTML, no Markdown. `body_version` is the block-schema version, so a
 * future shape change is detectable per row rather than guessed.
 */

/**
 * Lifecycle statuses. These now describe a TRANSLATION, not a post — a post
 * has no status of its own, only the statuses of its translations. The
 * export keeps its Wave 1 name so no consumer import churns;
 * `EditorialTranslationStatus` is the clearer alias to prefer in new code.
 */
export const EDITORIAL_POST_STATUSES = ["draft", "published", "archived"] as const;
export const editorialPostStatusSchema = z.enum(EDITORIAL_POST_STATUSES);
export type EditorialPostStatus = z.infer<typeof editorialPostStatusSchema>;
export type EditorialTranslationStatus = EditorialPostStatus;

export type EditorialBodyBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "image"; url: string; alt: string; caption?: string }
  | { type: "bulleted-list"; items: string[] };

export type EditorialBody = { blocks: EditorialBodyBlock[] };

export type EditorialAuthorSnapshot = {
  name: string;
  role: string;
  avatarUrl: string | null;
  biography: string | null;
};

export const editorialPostsTable = pgTable("editorial_posts", {
  id:                   serial("id").primaryKey(),
  channel:              text("channel").notNull().$type<EditorialChannel>(),
  // The author's own `channel` must equal this column. Enforced in the
  // service layer at every write path that sets author_id, AND in the
  // database by the `guard_editorial_post_author_channel` trigger — a
  // cross-row rule like this cannot be a CHECK constraint.
  authorId:             integer("author_id").references(() => editorialAuthorsTable.id, { onDelete: "set null" }),
  // Shared across every language; the localized alt text lives on each
  // translation row.
  featureImageUrl:      text("feature_image_url"),
  migrationSourceTable: text("migration_source_table"),
  migrationSourceId:    integer("migration_source_id"),
  createdAt:            timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:            timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
  updatedByAdminId:     integer("updated_by_admin_id").references(() => systemUsersTable.id, { onDelete: "set null" }),
}, (table) => [
  check("editorial_posts_channel_valid", sql`${table.channel} IN ('news', 'experience')`),
  index("editorial_posts_channel_idx").on(table.channel),
  index("editorial_posts_author_idx").on(table.authorId),
]);

export type EditorialPost = typeof editorialPostsTable.$inferSelect;
export type InsertEditorialPost = typeof editorialPostsTable.$inferInsert;
