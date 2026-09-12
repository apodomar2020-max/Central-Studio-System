import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { systemUsersTable } from "./systemUsers";
import { editorialAuthorsTable } from "./editorialAuthors";
import { type EditorialChannel } from "./editorialTopics";

/**
 * editorial_posts — Unified Editorial CMS Wave 1 (additive foundation).
 *
 * The single post model behind BOTH editorial channels ('news' and
 * 'experience'), separated only by the `channel` discriminator.
 *
 * ADDITIVE ONLY. This table does not read, write, alter, or replace
 * website_news_posts or website_performances. Those remain the live
 * public-website sources in this wave; `migration_source_table` /
 * `migration_source_id` are inert provenance columns reserved for a LATER
 * wave's content migration and are written by nothing in Wave 1.
 *
 * BODY MODEL (`body` jsonb): a flat, typed block list —
 *   { blocks: Array<
 *       | { type: 'paragraph',     text: string }
 *       | { type: 'heading',       level: 2 | 3, text: string }
 *       | { type: 'image',         url: string, alt: string, caption?: string }
 *       | { type: 'bulleted-list', items: string[] }
 *     > }
 * No HTML, no Markdown — same "structured blocks, never raw markup"
 * principle as website_news_posts.content, but flat and discriminated so
 * each block type can be validated exactly (see api-server's
 * lib/editorialBody.ts). `body_version` is the block-schema version, so a
 * future shape change is detectable per row rather than guessed.
 *
 * AUTHOR: `author_id` is the live FK (ON DELETE SET NULL — deleting an
 * author must never delete a post). `author_snapshot` is the FROZEN byline
 * captured at publish time; editing the author ENTITY never rewrites an
 * already-frozen snapshot. Changing a published post's author writes a
 * revision and regenerates the snapshot deliberately.
 *
 * LIFECYCLE: draft -> published -> archived, archived -> draft.
 * published -> draft is NOT allowed (see the service layer). `published_at`
 * is set once, on the first publish, and never changes on edit.
 *
 * `updated_by_admin_id` is nullable with ON DELETE SET NULL, matching
 * websiteNewsPosts.updatedByAdminId exactly.
 */
export const EDITORIAL_POST_STATUSES = ["draft", "published", "archived"] as const;
export const editorialPostStatusSchema = z.enum(EDITORIAL_POST_STATUSES);
export type EditorialPostStatus = z.infer<typeof editorialPostStatusSchema>;

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
  id:                         serial("id").primaryKey(),
  channel:                    text("channel").notNull().$type<EditorialChannel>(),
  slug:                       text("slug").notNull(),
  status:                     text("status").notNull().default("draft").$type<EditorialPostStatus>(),
  title:                      text("title").notNull(),
  deck:                       text("deck"),
  contextLabel:               text("context_label"),
  body:                       jsonb("body").notNull().$type<EditorialBody>(),
  bodyVersion:                integer("body_version").notNull().default(1),
  featureImageUrl:            text("feature_image_url"),
  featureImageAlt:            text("feature_image_alt"),
  authorId:                   integer("author_id").references(() => editorialAuthorsTable.id, { onDelete: "set null" }),
  authorSnapshot:             jsonb("author_snapshot").$type<EditorialAuthorSnapshot>(),
  readingTimeOverrideMinutes: integer("reading_time_override_minutes"),
  publishedAt:                timestamp("published_at", { withTimezone: true, mode: "string" }),
  migrationSourceTable:       text("migration_source_table"),
  migrationSourceId:          integer("migration_source_id"),
  seoTitle:                   text("seo_title"),
  seoDescription:             text("seo_description"),
  ogImageUrl:                 text("og_image_url"),
  createdAt:                  timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:                  timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
  updatedByAdminId:           integer("updated_by_admin_id").references(() => systemUsersTable.id, { onDelete: "set null" }),
}, (table) => [
  unique("editorial_posts_channel_slug_unique").on(table.channel, table.slug),
  check("editorial_posts_title_not_blank", sql`length(trim(${table.title})) > 0`),
  check("editorial_posts_slug_not_blank", sql`length(trim(${table.slug})) > 0`),
  check("editorial_posts_channel_valid", sql`${table.channel} IN ('news', 'experience')`),
  check("editorial_posts_status_valid", sql`${table.status} IN ('draft', 'published', 'archived')`),
  check("editorial_posts_body_version_positive", sql`${table.bodyVersion} > 0`),
  check(
    "editorial_posts_reading_time_override_positive",
    sql`${table.readingTimeOverrideMinutes} IS NULL OR ${table.readingTimeOverrideMinutes} > 0`,
  ),
  index("editorial_posts_channel_status_published_at_idx").on(table.channel, table.status, table.publishedAt),
]);

export type EditorialPost = typeof editorialPostsTable.$inferSelect;
export type InsertEditorialPost = typeof editorialPostsTable.$inferInsert;
