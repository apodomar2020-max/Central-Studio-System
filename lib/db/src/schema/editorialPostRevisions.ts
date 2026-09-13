import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { systemUsersTable } from "./systemUsers";
import { editorialPostTranslationsTable } from "./editorialPostTranslations";
import {
  editorialPostsTable,
  type EditorialAuthorSnapshot,
  type EditorialBody,
  type EditorialPostStatus,
} from "./editorialPosts";

/**
 * editorial_post_revisions — Unified Editorial CMS Wave 1.1
 * (translation-aware history).
 *
 * Append-only record of what was live immediately BEFORE each change to
 * published content. Written inside the same transaction as the mutation it
 * describes, never patched afterwards — same spirit as credit_transactions
 * and ballet_application_events.
 *
 * ─── WHY TWO SCOPES ──────────────────────────────────────────────────────
 *
 * A post's live state is now split across two levels, so history has to be
 * too. Every revision row is exactly one of:
 *
 *   TRANSLATION-SCOPED  (`translation_id` NOT NULL)
 *     The prior state of ONE translation's own prose and lifecycle —
 *     title, slug, deck, contextLabel, body, bodyVersion,
 *     featureImageAlt, seo*, ogImageUrl, status, publishedAt,
 *     authorSnapshot. Event types: 'published_edit', 'restore',
 *     'translation_status_change'.
 *
 *   POST-SCOPED / SHARED (`translation_id` NULL)
 *     The prior state of the SHARED fields that belong to the logical post
 *     and are therefore not any one language's — authorId, topics,
 *     featureImageUrl. Event types: 'author_change', 'topics_change',
 *     'shared_field_change'.
 *
 * THE ISOLATION GUARANTEE. Because a translation-scoped revision names its
 * translation and carries only that translation's columns, restoring an
 * Arabic revision writes only the Arabic row: there is no column in the
 * snapshot that could reach the English row, and the restore's WHERE
 * clause is the translation id from the revision itself. This is
 * structural, not a convention — see the `editorial_post_revisions_scope_
 * matches_event_type` CHECK below, which makes a mis-scoped row
 * unrepresentable, and the composite FK which makes a cross-post
 * translation reference unrepresentable.
 *
 * `translation_id` is deliberately NULLABLE (shared-field revisions have no
 * translation) and is part of a COMPOSITE FOREIGN KEY
 * (translation_id, post_id) -> editorial_post_translations(id, post_id),
 * not a plain single-column FK. That composite key is what guarantees, in
 * the database, that a revision's translation always belongs to that
 * revision's own post — a plain FK would happily let revision(post=7)
 * point at translation(post=9). MATCH SIMPLE (the default) means the
 * constraint is simply not checked when translation_id is NULL, which is
 * exactly the wanted behaviour for post-scoped rows.
 *
 * `revision_number` stays PER-POST sequential (UNIQUE with post_id), NOT
 * per-translation. One coherent timeline per logical post is the more
 * useful history — "what happened to this story, in order" — and
 * `translation_id` on each row says which language (or the shared spine) a
 * given entry belongs to. Filtering by translation_id yields that one
 * language's history in order; nothing is lost, and shared-field changes
 * stay interleaved where an editor can see them. The number is assigned
 * inside the mutating transaction from MAX+1 under a row lock on the
 * parent POST (not the translation), so concurrent edits to two different
 * translations of the same post serialize rather than collide on a number.
 *
 * `created_by_admin_id` is ON DELETE SET NULL — deleting the admin account
 * must never delete the history of what they published.
 */

/** Revisions of one translation's own prose + lifecycle. */
export const EDITORIAL_TRANSLATION_REVISION_EVENT_TYPES = [
  "published_edit",
  "restore",
  "translation_status_change",
] as const;

/** Revisions of the shared post spine (no single language). */
export const EDITORIAL_SHARED_REVISION_EVENT_TYPES = [
  "author_change",
  "topics_change",
  "shared_field_change",
] as const;

export const EDITORIAL_REVISION_EVENT_TYPES = [
  ...EDITORIAL_TRANSLATION_REVISION_EVENT_TYPES,
  ...EDITORIAL_SHARED_REVISION_EVENT_TYPES,
] as const;

export const editorialRevisionEventTypeSchema = z.enum(EDITORIAL_REVISION_EVENT_TYPES);
export type EditorialRevisionEventType = z.infer<typeof editorialRevisionEventTypeSchema>;

export type EditorialTranslationRevisionEventType =
  (typeof EDITORIAL_TRANSLATION_REVISION_EVENT_TYPES)[number];
export type EditorialSharedRevisionEventType =
  (typeof EDITORIAL_SHARED_REVISION_EVENT_TYPES)[number];

export function isTranslationRevisionEventType(
  eventType: EditorialRevisionEventType,
): eventType is EditorialTranslationRevisionEventType {
  return (EDITORIAL_TRANSLATION_REVISION_EVENT_TYPES as readonly string[]).includes(eventType);
}

/**
 * The prior state of ONE translation. `scope: 'translation'` is stored in
 * the jsonb itself as well as being implied by translation_id, so a reader
 * of a raw row never has to join to know what they are looking at.
 */
export type EditorialTranslationRevisionSnapshot = {
  scope: "translation";
  languageId: number;
  languageCode: string;
  title: string;
  slug: string;
  deck: string | null;
  contextLabel: string | null;
  body: EditorialBody;
  bodyVersion: number;
  featureImageAlt: string | null;
  authorSnapshot: EditorialAuthorSnapshot | null;
  readingTimeOverrideMinutes: number | null;
  seoTitle: string | null;
  seoDescription: string | null;
  ogImageUrl: string | null;
  status: EditorialPostStatus;
  publishedAt: string | null;
};

/** The prior state of the SHARED post spine. Deliberately holds no prose. */
export type EditorialSharedRevisionSnapshot = {
  scope: "shared";
  authorId: number | null;
  featureImageUrl: string | null;
  topics: number[];
};

export type EditorialRevisionSnapshot =
  | EditorialTranslationRevisionSnapshot
  | EditorialSharedRevisionSnapshot;

export const editorialPostRevisionsTable = pgTable("editorial_post_revisions", {
  id:     serial("id").primaryKey(),
  postId: integer("post_id").notNull().references(() => editorialPostsTable.id, { onDelete: "cascade" }),
  /**
   * NULL for shared/post-scoped revisions. Non-null rows are constrained
   * by the composite FK below to a translation OF THIS POST.
   */
  translationId:    integer("translation_id"),
  revisionNumber:   integer("revision_number").notNull(),
  snapshot:         jsonb("snapshot").notNull().$type<EditorialRevisionSnapshot>(),
  eventType:        text("event_type").notNull().$type<EditorialRevisionEventType>(),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  createdByAdminId: integer("created_by_admin_id").references(() => systemUsersTable.id, { onDelete: "set null" }),
}, (table) => [
  unique("editorial_post_revisions_post_revision_unique").on(table.postId, table.revisionNumber),
  // A revision's translation ALWAYS belongs to that revision's post.
  // MATCH SIMPLE: skipped entirely when translation_id IS NULL.
  foreignKey({
    name: "editorial_post_revisions_translation_post_fkey",
    columns: [table.translationId, table.postId],
    foreignColumns: [editorialPostTranslationsTable.id, editorialPostTranslationsTable.postId],
  }).onDelete("cascade"),
  check("editorial_post_revisions_number_positive", sql`${table.revisionNumber} > 0`),
  check(
    "editorial_post_revisions_event_type_valid",
    sql`${table.eventType} IN ('published_edit', 'restore', 'translation_status_change', 'author_change', 'topics_change', 'shared_field_change')`,
  ),
  // A translation-scoped event MUST name a translation; a shared event MUST
  // NOT. Makes a mis-scoped revision row impossible to write at all.
  check(
    "editorial_post_revisions_scope_matches_event_type",
    sql`(
      ${table.eventType} IN ('published_edit', 'restore', 'translation_status_change')
      AND ${table.translationId} IS NOT NULL
    ) OR (
      ${table.eventType} IN ('author_change', 'topics_change', 'shared_field_change')
      AND ${table.translationId} IS NULL
    )`,
  ),
  index("editorial_post_revisions_translation_idx").on(table.translationId, table.revisionNumber),
]);

export type EditorialPostRevision = typeof editorialPostRevisionsTable.$inferSelect;
export type InsertEditorialPostRevision = typeof editorialPostRevisionsTable.$inferInsert;
