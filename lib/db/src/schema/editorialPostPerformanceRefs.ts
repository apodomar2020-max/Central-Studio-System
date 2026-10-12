import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, serial, timestamp, unique } from "drizzle-orm/pg-core";
import { editorialPostsTable } from "./editorialPosts";
import { websitePerformancesTable } from "./websitePerformances";

/**
 * editorial_post_performance_refs — Unified Website CMS Slice 1
 * (migration 0136).
 *
 * Ordered News → Performance pointers ("related items" on a News article).
 * A separate table because editorial_post_relations is strictly post→post
 * (both FKs on editorial_posts, same-channel invariant locked) and a
 * Performance is not an Editorial post. Legacy News kept these as slugs in
 * website_news_posts.related_refs (jsonb); migrated posts still resolve
 * from that overlay, so this table is only ever written for native posts.
 *
 * `position` shares ONE index sequence with editorial_post_relations.position
 * for the same source post when written through the recommendations
 * replace endpoint, so the public projection can merge both tables into a
 * single editor-chosen order (news-first on a tie).
 *
 * performance_id ON DELETE CASCADE: Performances are retired with
 * is_active=false, never deleted, and inactive targets are already dropped
 * from public output; see the migration header for the full rationale.
 */
export const editorialPostPerformanceRefsTable = pgTable("editorial_post_performance_refs", {
  id:            serial("id").primaryKey(),
  postId:        integer("post_id").notNull().references(() => editorialPostsTable.id, { onDelete: "cascade" }),
  performanceId: integer("performance_id").notNull().references(() => websitePerformancesTable.id, { onDelete: "cascade" }),
  position:      integer("position").notNull().default(0),
  createdAt:     timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  unique("editorial_post_performance_refs_post_performance_unique").on(table.postId, table.performanceId),
  check("editorial_post_performance_refs_position_non_negative", sql`${table.position} >= 0`),
  index("editorial_post_performance_refs_post_position_idx").on(table.postId, table.position),
  index("editorial_post_performance_refs_performance_idx").on(table.performanceId),
]);

export type EditorialPostPerformanceRef = typeof editorialPostPerformanceRefsTable.$inferSelect;
export type InsertEditorialPostPerformanceRef = typeof editorialPostPerformanceRefsTable.$inferInsert;
