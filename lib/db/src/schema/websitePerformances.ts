import { sql } from "drizzle-orm";
import { boolean, check, integer, jsonb, pgTable, serial, smallint, text, timestamp } from "drizzle-orm/pg-core";
import { systemUsersTable } from "./systemUsers";

/**
 * website_performances — Website CMS Wave 3 (Performance only).
 *
 * Follows the exact same template as website_news_posts (Wave 2): additive
 * table, isActive soft-hide (never a physical delete route), an
 * updatedByAdminId FK with ON DELETE SET NULL, created/updated timestamps.
 * See the Wave 3 investigation report for the full field-by-field
 * reconciliation this schema is derived from.
 *
 * CARD vs. DETAIL fields are deliberately kept as separate columns
 * (cardTitle/title, cardDescription/subtitle, cardImageUrl/heroImageUrl,
 * cardVenue/venue, cardDatesDisplay/eventDateDisplay, cardBadgeLabel/
 * detailBadgeLabel) — the Wave 3 investigation proved these genuinely
 * diverge (title/description/image differ for all 4 seeded entries; venue
 * and dates diverge for at least one). This is a LOCKED content-migration
 * decision, not an oversight: Wave 3 preserves existing publicly-rendered
 * values exactly, including intentional card/detail differences (most
 * notably YAGP's dates and badge — see the seed script's own doc comment).
 *
 * `sortOrder` (not a machine-readable event date) drives public list order
 * and featured-fallback order — LOCKED decision: no `eventStartDate` in
 * Wave 3, since no machine-readable start-date source exists today and
 * inventing one would create new business data no editor has approved.
 *
 * `badgeVariant` is a closed semantic enum (cyan/purple/gold), never a raw
 * CSS/Tailwind class string from Admin. A single variant maps to DIFFERENT
 * class strings in card vs. detail rendering contexts (see
 * websitePerformanceBadgeVariants.ts) — this preserves the current visuals
 * exactly, including gold's two genuinely different hex shades (card
 * `amber-500` vs. detail `#FFB81C`), which this migration does NOT
 * normalize to one value (locked decision).
 *
 * `featuredHeroImageUrl` / `featuredHeroDateBadge` are nullable, hero-only
 * overrides — populated only for the seeded Nutcracker row (the current
 * `landingHero` data), null for every other row. The public hero render
 * falls back to `heroImageUrl` when `featuredHeroImageUrl` is null (no
 * separate "no hero image" state is possible). No CDN query-parameter
 * rewriting at runtime — the exact historical 1920w URL is preserved
 * verbatim in `featuredHeroImageUrl` rather than derived from
 * `heroImageUrl` at render time.
 *
 * `scheduleOverview` is preserved (Nutcracker has real content in it) but
 * is NOT publicly rendered in Wave 3 — `ArticleDetailView` has no code path
 * for it today and none is added. The Admin editor must label this field
 * clearly as stored-but-not-displayed so editors don't assume otherwise.
 *
 * `content` (jsonb) and `relatedRefs` (jsonb) reuse the exact Wave-2 News
 * shapes verbatim — see websiteNewsPosts.ts's doc comment for the full
 * reasoning. `relatedRefs` is intentionally NOT a foreign key for the same
 * reason Wave 2's was not: the two content types resolve through separate
 * tables via the shared `{type, slug}` tag, and this format requires zero
 * migration in either direction.
 */
export const websitePerformancesTable = pgTable("website_performances", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  sortOrder: smallint("sort_order").notNull(),

  // Shared identity/taxonomy fields.
  category: text("category").notNull(),
  categoryLabel: text("category_label").notNull(),
  title: text("title").notNull(),
  subtitle: text("subtitle").notNull(),
  heroImageUrl: text("hero_image_url").notNull(),
  eventDateDisplay: text("event_date_display").notNull(),
  season: text("season").notNull(),

  // Featured-hero-only overrides (nullable — populated only for the
  // currently-featured entry).
  featuredHeroImageUrl: text("featured_hero_image_url"),
  featuredHeroDateBadge: text("featured_hero_date_badge"),
  isFeatured: boolean("is_featured").notNull().default(false),

  // Card / repertoire-listing fields — deliberately independent of the
  // detail fields above (see module doc comment).
  cardTitle: text("card_title").notNull(),
  cardDescription: text("card_description").notNull(),
  cardImageUrl: text("card_image_url").notNull(),
  cardVenue: text("card_venue").notNull(),
  cardDatesDisplay: text("card_dates_display").notNull(),
  cardTime: text("card_time").notNull(),
  dateDay: text("date_day").notNull(),
  dateMonth: text("date_month").notNull(),
  cardBadgeLabel: text("card_badge_label").notNull(),

  // Detail-page-only fields.
  venue: text("venue").notNull(),
  times: text("times").array().notNull().default([]),
  orchestra: text("orchestra"),
  runtime: text("runtime").notNull(),
  ticketLink: text("ticket_link"),
  ticketPriceRange: text("ticket_price_range"),
  detailBadgeLabel: text("detail_badge_label").notNull(),
  badgeVariant: text("badge_variant").notNull(),

  // Article-shared data (parity with News; author fields are confirmed
  // unrendered by ArticleDetailView today — kept for schema parity only).
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

  // Performance-detail blocks.
  keyHighlights: text("key_highlights").array().notNull().default([]),
  // NOT publicly rendered in Wave 3 — see module doc comment.
  scheduleOverview: jsonb("schedule_overview").notNull().default([]).$type<
    Array<{ time: string; event: string }>
  >(),
  castAndFaculty: jsonb("cast_and_faculty").notNull().default([]).$type<
    Array<{ name: string; role: string; imageUrl: string }>
  >(),

  // Cross-type-aware related-content pointers — identical shape/semantics
  // to website_news_posts.related_refs (Wave 2), reused verbatim.
  relatedRefs: jsonb("related_refs").notNull().default([]).$type<
    Array<{ type: "news" | "performance"; slug: string }>
  >(),

  isActive: boolean("is_active").notNull().default(true),
  updatedByAdminId: integer("updated_by_admin_id").references(() => systemUsersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
}, (table) => [
  check("website_performances_category_not_blank", sql`length(trim(${table.category})) > 0`),
  check("website_performances_badge_variant_check", sql`${table.badgeVariant} IN ('cyan', 'purple', 'gold')`),
]);

export type WebsitePerformance = typeof websitePerformancesTable.$inferSelect;
export type InsertWebsitePerformance = typeof websitePerformancesTable.$inferInsert;
