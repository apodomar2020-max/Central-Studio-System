import { integer, pgTable, serial, timestamp, unique } from "drizzle-orm/pg-core";
import { editorialPostsTable } from "./editorialPosts";
import { editorialTopicsTable } from "./editorialTopics";

/**
 * editorial_post_topics — Unified Editorial CMS Wave 1 (additive foundation).
 *
 * Many-to-many join between posts and topics, same shape as the ballet
 * catalogue join tables (ballet_class_levels etc.).
 *
 * DELETE RULES ARE DELIBERATELY ASYMMETRIC:
 *   - postId CASCADE  — a post's own assignments are part of the post.
 *   - topicId RESTRICT — a topic that is still assigned anywhere cannot be
 *     physically deleted out from under published content. Topics are
 *     retired via status='archived' (soft-hide), never dropped.
 */
export const editorialPostTopicsTable = pgTable("editorial_post_topics", {
  id:        serial("id").primaryKey(),
  postId:    integer("post_id").notNull().references(() => editorialPostsTable.id, { onDelete: "cascade" }),
  topicId:   integer("topic_id").notNull().references(() => editorialTopicsTable.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  unique("editorial_post_topics_post_topic_unique").on(table.postId, table.topicId),
]);

export type EditorialPostTopic = typeof editorialPostTopicsTable.$inferSelect;
export type InsertEditorialPostTopic = typeof editorialPostTopicsTable.$inferInsert;
