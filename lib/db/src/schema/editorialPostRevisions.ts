import { sql } from "drizzle-orm";
import { check, integer, jsonb, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { systemUsersTable } from "./systemUsers";
import {
  editorialPostsTable,
  type EditorialAuthorSnapshot,
  type EditorialBody,
  type EditorialPostStatus,
} from "./editorialPosts";

/**
 * editorial_post_revisions — Unified Editorial CMS Wave 1 (additive foundation).
 *
 * Append-only history of what a PUBLISHED post looked like immediately
 * BEFORE each change. Same spirit as credit_transactions /
 * ballet_application_events: a durable record written inside the same
 * transaction as the mutation it describes, never patched afterwards.
 *
 * Only edits to a post that is currently PUBLISHED create revisions —
 * drafts are working copy, not history. The snapshot is the full prior live
 * state (see the jsonb $type below), so an editor can always see and
 * restore exactly what the public was being shown.
 *
 * `revision_number` is per-post sequential (UNIQUE with post_id), assigned
 * inside the mutation's transaction from MAX(revision_number)+1 under a row
 * lock on the parent post, so two concurrent edits cannot collide.
 *
 * `created_by_admin_id` is ON DELETE SET NULL — deleting the admin account
 * must never delete the history of what they published.
 */
export const EDITORIAL_REVISION_EVENT_TYPES = [
  "published_edit",
  "restore",
  "author_change",
  "topics_change",
] as const;
export const editorialRevisionEventTypeSchema = z.enum(EDITORIAL_REVISION_EVENT_TYPES);
export type EditorialRevisionEventType = z.infer<typeof editorialRevisionEventTypeSchema>;

export type EditorialRevisionSnapshot = {
  title: string;
  deck: string | null;
  contextLabel: string | null;
  body: EditorialBody;
  bodyVersion: number;
  featureImageUrl: string | null;
  featureImageAlt: string | null;
  authorId: number | null;
  authorSnapshot: EditorialAuthorSnapshot | null;
  topics: number[];
  seoTitle: string | null;
  seoDescription: string | null;
  ogImageUrl: string | null;
  status: EditorialPostStatus;
  publishedAt: string | null;
};

export const editorialPostRevisionsTable = pgTable("editorial_post_revisions", {
  id:               serial("id").primaryKey(),
  postId:           integer("post_id").notNull().references(() => editorialPostsTable.id, { onDelete: "cascade" }),
  revisionNumber:   integer("revision_number").notNull(),
  snapshot:         jsonb("snapshot").notNull().$type<EditorialRevisionSnapshot>(),
  eventType:        text("event_type").notNull().$type<EditorialRevisionEventType>(),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  createdByAdminId: integer("created_by_admin_id").references(() => systemUsersTable.id, { onDelete: "set null" }),
}, (table) => [
  unique("editorial_post_revisions_post_revision_unique").on(table.postId, table.revisionNumber),
  check("editorial_post_revisions_number_positive", sql`${table.revisionNumber} > 0`),
  check(
    "editorial_post_revisions_event_type_valid",
    sql`${table.eventType} IN ('published_edit', 'restore', 'author_change', 'topics_change')`,
  ),
]);

export type EditorialPostRevision = typeof editorialPostRevisionsTable.$inferSelect;
export type InsertEditorialPostRevision = typeof editorialPostRevisionsTable.$inferInsert;
