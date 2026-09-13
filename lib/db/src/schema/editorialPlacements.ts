import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { editorialPostsTable } from "./editorialPosts";
import { type EditorialChannel } from "./editorialTopics";

/**
 * editorial_placements — Unified Editorial CMS Wave 1 (additive foundation).
 *
 * Named, ordered curation slots ("news-hero", "experience-featured", …).
 * This is the replacement concept for website_news_posts' single
 * `is_featured` boolean: instead of one hardcoded flag with a one-row
 * invariant, a placement is an arbitrary named list an editor can order.
 *
 * `key` is free text rather than an enum so a new slot never needs a
 * migration; `channel` is carried on the placement row so the "post.channel
 * must equal placement.channel" rule is checkable without a join in the
 * service layer.
 *
 * `start_at`/`end_at` are optional scheduling windows — stored and returned
 * in Wave 1, but nothing in Wave 1 reads them for public display (there are
 * no public editorial endpoints yet).
 *
 * UNIQUE (key, post_id): a post appears at most once in any given slot.
 */
export const editorialPlacementsTable = pgTable("editorial_placements", {
  id:        serial("id").primaryKey(),
  key:       text("key").notNull(),
  channel:   text("channel").notNull().$type<EditorialChannel>(),
  postId:    integer("post_id").notNull().references(() => editorialPostsTable.id, { onDelete: "cascade" }),
  position:  integer("position").notNull().default(0),
  startAt:   timestamp("start_at", { withTimezone: true, mode: "string" }),
  endAt:     timestamp("end_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
}, (table) => [
  unique("editorial_placements_key_post_unique").on(table.key, table.postId),
  check("editorial_placements_key_not_blank", sql`length(trim(${table.key})) > 0`),
  check("editorial_placements_channel_valid", sql`${table.channel} IN ('news', 'experience')`),
  check("editorial_placements_position_non_negative", sql`${table.position} >= 0`),
  check(
    "editorial_placements_window_ordered",
    sql`${table.startAt} IS NULL OR ${table.endAt} IS NULL OR ${table.startAt} < ${table.endAt}`,
  ),
  index("editorial_placements_key_position_idx").on(table.key, table.position),
]);

export type EditorialPlacement = typeof editorialPlacementsTable.$inferSelect;
export type InsertEditorialPlacement = typeof editorialPlacementsTable.$inferInsert;
