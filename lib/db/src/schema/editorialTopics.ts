import { sql } from "drizzle-orm";
import { check, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

/**
 * editorial_topics — Unified Editorial CMS Wave 1 (additive foundation).
 *
 * Channel-scoped taxonomy for editorial posts. `channel` is the single
 * concept that keeps the two editorial surfaces separate inside one unified
 * model: a topic belongs to exactly one channel and can only ever be
 * assigned to posts in that same channel (enforced in the service layer —
 * a cross-table CHECK is not expressible here).
 *
 * Slug is unique PER CHANNEL, not globally: "backstage" is a legitimate
 * topic name on both sides and the two are genuinely different rows.
 *
 * Status is `active` | `archived` (soft-hide). An archived topic keeps its
 * existing post assignments (history is never rewritten) but can never be
 * NEWLY assigned.
 */
export const EDITORIAL_CHANNELS = ["news", "experience"] as const;
export const editorialChannelSchema = z.enum(EDITORIAL_CHANNELS);
export type EditorialChannel = z.infer<typeof editorialChannelSchema>;

export const EDITORIAL_TOPIC_STATUSES = ["active", "archived"] as const;
export const editorialTopicStatusSchema = z.enum(EDITORIAL_TOPIC_STATUSES);
export type EditorialTopicStatus = z.infer<typeof editorialTopicStatusSchema>;

export const editorialTopicsTable = pgTable("editorial_topics", {
  id:        serial("id").primaryKey(),
  channel:   text("channel").notNull().$type<EditorialChannel>(),
  name:      text("name").notNull(),
  slug:      text("slug").notNull(),
  status:    text("status").notNull().default("active").$type<EditorialTopicStatus>(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
}, (table) => [
  unique("editorial_topics_channel_slug_unique").on(table.channel, table.slug),
  check("editorial_topics_name_not_blank", sql`length(trim(${table.name})) > 0`),
  check("editorial_topics_slug_not_blank", sql`length(trim(${table.slug})) > 0`),
  check("editorial_topics_channel_valid", sql`${table.channel} IN ('news', 'experience')`),
  check("editorial_topics_status_valid", sql`${table.status} IN ('active', 'archived')`),
]);

export type EditorialTopic = typeof editorialTopicsTable.$inferSelect;
export type InsertEditorialTopic = typeof editorialTopicsTable.$inferInsert;
