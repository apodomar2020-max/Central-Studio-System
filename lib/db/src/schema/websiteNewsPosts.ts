import { sql } from "drizzle-orm";
import { boolean, check, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { systemUsersTable } from "./systemUsers";

/**
 * website_news_posts — Website CMS Wave 2 (News only).
 *
 * Follows the same template as heroItems/appContent/websiteBackgroundSettings:
 * additive table, isActive soft-hide (never a physical delete route), an
 * updatedByAdminId FK with ON DELETE SET NULL, created/updated timestamps.
 *
 * TWO DATE COLUMNS, DELIBERATELY SEPARATE (see the Wave 2 report's "Database"
 * section for the full reasoning): `publishedDate` is the exact literal
 * display string (e.g. "July 18, 2026") — for the 6 migrated posts this is
 * copied byte-for-byte from lib/articlesData.ts, never parsed/reformatted,
 * so today's rendered date text cannot change. `publishedAt` is a real
 * sortable timestamp used ONLY for ORDER BY / indexing — for the 6 migrated
 * posts it was verified by hand against the same source date (not parsed by
 * code) so no derivation risk is introduced; for Admin-created posts both
 * columns are set together from a single date-picker value.
 *
 * `excerpt` is nullable — presentation (BFF/website) falls back to
 * `subtitle` when null. This is a real per-row fallback, not a schema-level
 * merge: the two concepts stay genuinely distinct columns.
 *
 * `listingImageUrl` is nullable — presentation falls back to `heroImageUrl`
 * when null. For the 6 migrated posts this is always set to the exact
 * historical listing-card image (proven to differ from heroImageUrl for 5 of
 * 6 posts in the Wave 0 investigation).
 *
 * `content` (jsonb) mirrors the existing ArticleSection[] block model
 * verbatim — { leadParagraph: string, sections: Array<{ heading?, paragraphs,
 * quote?, bulletPoints?, image?, imageCaption? }> } — no HTML, no Markdown.
 *
 * `relatedRefs` (jsonb) is the cross-type-aware related-content pointer
 * list: Array<{ type: 'news' | 'performance', slug: string }>, order
 * preserved. This is intentionally NOT a foreign key — Performance has no
 * CMS table in this wave, and a `type`-tagged slug pointer is exactly as
 * valid once Performance moves to its own CMS table in Wave 3 as it is
 * today (see the Wave 2 report's "Wave-3 handoff" section — no migration of
 * this column is needed when that happens).
 */
export const websiteNewsPostsTable = pgTable("website_news_posts", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  category: text("category").notNull(),
  categoryLabel: text("category_label").notNull(),
  title: text("title").notNull(),
  subtitle: text("subtitle").notNull(),
  excerpt: text("excerpt"),
  heroImageUrl: text("hero_image_url").notNull(),
  listingImageUrl: text("listing_image_url"),
  publishedDate: text("published_date").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true, mode: "string" }).notNull(),
  readTime: text("read_time"),
  isFeatured: boolean("is_featured").notNull().default(false),
  authorName: text("author_name").notNull(),
  authorRole: text("author_role").notNull(),
  authorAvatarUrl: text("author_avatar_url"),
  tags: text("tags").array().notNull().default([]),
  galleryImages: text("gallery_images").array().notNull().default([]),
  content: jsonb("content").notNull().$type<{
    leadParagraph: string;
    sections: Array<{
      heading?: string;
      paragraphs: string[];
      quote?: { text: string; author: string; role: string };
      bulletPoints?: string[];
      image?: string;
      imageCaption?: string;
    }>;
  }>(),
  relatedRefs: jsonb("related_refs").notNull().default([]).$type<
    Array<{ type: "news" | "performance"; slug: string }>
  >(),
  isActive: boolean("is_active").notNull().default(true),
  updatedByAdminId: integer("updated_by_admin_id").references(() => systemUsersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
}, (table) => [
  check("website_news_posts_category_not_blank", sql`length(trim(${table.category})) > 0`),
]);

export type WebsiteNewsPost = typeof websiteNewsPostsTable.$inferSelect;
export type InsertWebsiteNewsPost = typeof websiteNewsPostsTable.$inferInsert;
