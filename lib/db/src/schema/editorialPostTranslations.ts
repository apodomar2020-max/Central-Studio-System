import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { systemUsersTable } from "./systemUsers";
import { editorialLanguagesTable } from "./editorialLanguages";
import { type EditorialChannel } from "./editorialTopics";
import {
  editorialPostsTable,
  type EditorialAuthorSnapshot,
  type EditorialBody,
  type EditorialPostStatus,
} from "./editorialPosts";

/**
 * editorial_post_translations — Unified Editorial CMS Wave 1.1.
 *
 * ONE ROW PER (POST, LANGUAGE). Everything a reader reads lives here, and
 * every translation has a FULLY INDEPENDENT LIFECYCLE: the English
 * translation of a post can be published while the Arabic one is still a
 * draft, each stamps its own `published_at` on its own first publish, and
 * editing or archiving one never touches the other.
 *
 * FOREIGN KEYS, deliberately asymmetric:
 *   post_id      CASCADE  — a post's translations ARE the post. Deleting
 *                           the logical post takes its language rows with
 *                           it; there is no such thing as an orphan
 *                           translation.
 *   language_id  RESTRICT — a language can NEVER be deleted out from under
 *                           content. Languages are retired with
 *                           is_active = false (see editorialLanguages.ts);
 *                           this FK makes the archive-not-delete policy a
 *                           database guarantee rather than a convention.
 *
 * UNIQUE (post_id, language_id): a post has at most one translation per
 * language. A second "Arabic" translation of the same post is a 409, not a
 * second row.
 *
 * ─── SLUG UNIQUENESS AT (channel, language, slug) ────────────────────────
 *
 * The requirement is that a slug is unique per channel per language: the
 * same slug may legitimately exist once on 'news' and once on
 * 'experience', and once in English and once in Arabic, but never twice in
 * the same (channel, language) pair. Global (language, slug) uniqueness
 * would be WRONG — it would stop 'news'/opening-night and
 * 'experience'/opening-night from coexisting, which Wave 1 explicitly
 * allowed and has a test for.
 *
 * `channel` lives on the PARENT post, so a constraint on this table alone
 * cannot see it. The solution implemented here is option (a) from the
 * spec — DENORMALIZE the parent's channel onto this row and put a real
 * UNIQUE on (channel, language_id, slug):
 *
 *   `channel`  text NOT NULL, a copy of editorial_posts.channel
 *   UNIQUE ("channel", "language_id", "slug")
 *
 * The copy is kept honest by THREE database mechanisms, not by application
 * discipline (migration 0126, section 9):
 *
 *   1. `sync_editorial_translation_channel` — a BEFORE INSERT OR UPDATE
 *      trigger on THIS table that OVERWRITES NEW.channel with the parent
 *      post's channel, looked up by NEW.post_id. The column is therefore
 *      not merely validated, it is *derived*: whatever the application
 *      sends is discarded, so no write path can desynchronize it even by
 *      mistake, and the service layer does not have to remember to set it.
 *   2. `guard_editorial_post_channel_immutable` — a BEFORE UPDATE trigger
 *      on editorial_posts that RAISES if `channel` ever changes. Post
 *      channel was already immutable in practice in Wave 1 (no route
 *      includes it in an update payload — verified against
 *      adminEditorial.ts's update key list); this makes it immutable in
 *      fact, which is the precondition that makes a denormalized copy
 *      safe. Without it, a channel change on the parent would silently
 *      strand every translation row's copy.
 *   3. The `editorial_post_translations_channel_valid` CHECK below, which
 *      restates the channel domain on this row.
 *
 * A GENERATED column cannot be used instead: Postgres generated columns
 * may only reference the row's own columns, never another table. A view
 * with a unique index is not possible either (indexes cannot be built on
 * views), and a materialized view would not be transactionally
 * constraining. The trigger + denormalized UNIQUE is therefore the
 * strongest available mechanism in this stack, and it IS a true
 * database-level guarantee — not a check-then-insert race. Trigger
 * precedent in this repo: 0078_payment_records_foundation.sql,
 * 0080_payment_events_foundation.sql.
 *
 * A per-translation `slug` is additionally NOT globally unique and NOT
 * unique per post: /en/opening-night and /ar/opening-night are the same
 * story in two languages and may share a slug, which the (channel,
 * language_id, slug) key permits by design.
 *
 * UNIQUE (id, post_id) exists only so editorial_post_revisions can carry a
 * COMPOSITE foreign key (translation_id, post_id) into this table — which
 * is what makes "a revision's translation always belongs to that
 * revision's post" a declarative database guarantee instead of a
 * service-layer assertion.
 *
 * LIFECYCLE, per translation: draft -> published | archived;
 * published -> archived; archived -> draft. `published -> draft` is NOT a
 * legal transition (unchanged from Wave 1's contract — unpublishing goes
 * through `archived` so there is always an explicit audited "taken off the
 * site" event). `published_at` is stamped once, on THAT translation's own
 * first publish, and never changes on edit or re-publish.
 */
export const editorialPostTranslationsTable = pgTable("editorial_post_translations", {
  id:     serial("id").primaryKey(),
  postId: integer("post_id").notNull().references(() => editorialPostsTable.id, { onDelete: "cascade" }),
  // RESTRICT: archive-not-delete for languages, enforced by the database.
  languageId: integer("language_id").notNull().references(() => editorialLanguagesTable.id, { onDelete: "restrict" }),
  /**
   * DERIVED COPY of editorial_posts.channel, maintained by the
   * `sync_editorial_translation_channel` trigger. Present solely to carry
   * the (channel, language_id, slug) UNIQUE below. NEVER write it from
   * application code — the trigger overwrites whatever is supplied.
   */
  channel:                    text("channel").notNull().$type<EditorialChannel>(),
  title:                      text("title").notNull(),
  slug:                       text("slug").notNull(),
  deck:                       text("deck"),
  contextLabel:               text("context_label"),
  // Localized alt text for the post's SHARED feature_image_url.
  featureImageAlt:            text("feature_image_alt"),
  body:                       jsonb("body").notNull().$type<EditorialBody>(),
  bodyVersion:                integer("body_version").notNull().default(1),
  status:                     text("status").notNull().default("draft").$type<EditorialPostStatus>(),
  publishedAt:                timestamp("published_at", { withTimezone: true, mode: "string" }),
  readingTimeOverrideMinutes: integer("reading_time_override_minutes"),
  seoTitle:                   text("seo_title"),
  seoDescription:             text("seo_description"),
  ogImageUrl:                 text("og_image_url"),
  // Frozen byline, captured at THIS translation's publish time.
  authorSnapshot:             jsonb("author_snapshot").$type<EditorialAuthorSnapshot>(),
  createdAt:                  timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:                  timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
  updatedByAdminId:           integer("updated_by_admin_id").references(() => systemUsersTable.id, { onDelete: "set null" }),
}, (table) => [
  unique("editorial_post_translations_post_language_unique").on(table.postId, table.languageId),
  // THE slug guarantee. See the header comment for why `channel` is here.
  unique("editorial_post_translations_channel_language_slug_unique").on(table.channel, table.languageId, table.slug),
  // Target of editorial_post_revisions' composite FK.
  unique("editorial_post_translations_id_post_unique").on(table.id, table.postId),
  check("editorial_post_translations_title_not_blank", sql`length(trim(${table.title})) > 0`),
  check("editorial_post_translations_slug_not_blank", sql`length(trim(${table.slug})) > 0`),
  check("editorial_post_translations_channel_valid", sql`${table.channel} IN ('news', 'experience')`),
  check("editorial_post_translations_status_valid", sql`${table.status} IN ('draft', 'published', 'archived')`),
  check("editorial_post_translations_body_version_positive", sql`${table.bodyVersion} > 0`),
  check(
    "editorial_post_translations_reading_time_override_positive",
    sql`${table.readingTimeOverrideMinutes} IS NULL OR ${table.readingTimeOverrideMinutes} > 0`,
  ),
  // The public listing query shape: "published translations of this
  // channel in this language, newest first".
  index("editorial_post_translations_channel_language_status_published_at_idx")
    .on(table.channel, table.languageId, table.status, table.publishedAt),
  index("editorial_post_translations_post_idx").on(table.postId),
]);

export type EditorialPostTranslation = typeof editorialPostTranslationsTable.$inferSelect;
export type InsertEditorialPostTranslation = typeof editorialPostTranslationsTable.$inferInsert;
