import { sql } from "drizzle-orm";
import { check, integer, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { editorialPostsTable } from "./editorialPosts";

/**
 * editorial_post_relations — Unified Editorial CMS Wave 1 (additive foundation).
 *
 * Ordered, typed post-to-post pointers ("recommended reading"). Unlike
 * website_news_posts.related_refs (a jsonb slug list, deliberately NOT a
 * foreign key because Performance had no table at the time), this IS a real
 * FK pair — both sides live in editorial_posts, so referential integrity
 * costs nothing and a dangling recommendation becomes impossible.
 *
 * `position` preserves editor-chosen order. Self-reference and cross-channel
 * targets are rejected in the service layer: the self-reference rule is
 * additionally enforced here by a row-level CHECK, while the channel rule
 * needs a cross-row lookup and so cannot be a CHECK.
 *
 * relation_type is an extension point ('recommended' is the only value in
 * Wave 1) so a later relation kind does not need a new table.
 */
export const EDITORIAL_RELATION_TYPES = ["recommended"] as const;
export const editorialRelationTypeSchema = z.enum(EDITORIAL_RELATION_TYPES);
export type EditorialRelationType = z.infer<typeof editorialRelationTypeSchema>;

export const editorialPostRelationsTable = pgTable("editorial_post_relations", {
  id:           serial("id").primaryKey(),
  sourcePostId: integer("source_post_id").notNull().references(() => editorialPostsTable.id, { onDelete: "cascade" }),
  targetPostId: integer("target_post_id").notNull().references(() => editorialPostsTable.id, { onDelete: "cascade" }),
  relationType: text("relation_type").notNull().default("recommended").$type<EditorialRelationType>(),
  position:     integer("position").notNull().default(0),
  createdAt:    timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  unique("editorial_post_relations_source_target_type_unique").on(table.sourcePostId, table.targetPostId, table.relationType),
  check("editorial_post_relations_no_self_reference", sql`${table.sourcePostId} <> ${table.targetPostId}`),
  check("editorial_post_relations_type_valid", sql`${table.relationType} IN ('recommended')`),
  check("editorial_post_relations_position_non_negative", sql`${table.position} >= 0`),
]);

export type EditorialPostRelation = typeof editorialPostRelationsTable.$inferSelect;
export type InsertEditorialPostRelation = typeof editorialPostRelationsTable.$inferInsert;
