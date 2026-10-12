import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  EDITORIAL_NEWS_CATEGORIES, EDITORIAL_NEWS_CATEGORY_LABELS,
  editorialLanguagesTable, editorialPlacementsTable, editorialPostPerformanceRefsTable, editorialPostRelationsTable, editorialPostTopicsTable,
  editorialPostTranslationsTable, editorialPostsTable, editorialTopicsTable,
  websiteNewsPostsTable, websitePerformancesTable, type EditorialBody, type EditorialGallery, type EditorialNewsCategory,
} from "@workspace/db/schema";

/**
 * Public Website News projection (Unified Website CMS, slice 1).
 *
 * ELIGIBILITY IS PER EDITORIAL RECORD: a post is public when it is in the
 * news channel and its DEFAULT, ACTIVE language translation is published
 * (`publicWhere()`, unchanged). Nothing else is required — in particular
 * NOT a legacy website_news_posts row. Every eligible row is then projected
 * one of two ways:
 *
 *   MIGRATED (provenance website_news_posts:<id> AND that legacy row exists):
 *     byte-identical to the pre-slice output. The legacy row is a read-only
 *     COMPATIBILITY OVERLAY for category, categoryLabel, publishedDate, the
 *     subtitle/excerpt fallback and the ordered mixed relatedRefs list. This
 *     is proven by publicEditorialNews.golden.test.ts against a Production
 *     capture.
 *
 *   NATIVE (no provenance, or provenance whose legacy row no longer exists):
 *     projected entirely from Editorial —
 *       category       post.newsCategory, or NATIVE_FALLBACK_CATEGORY when NULL
 *       categoryLabel  translation.contextLabel ?? the key's known label
 *                      (NATIVE_FALLBACK_LABEL for the NULL / unknown case)
 *       publishedDate  translation.publishedAt formatted in Africa/Cairo
 *                      ("July 05, 2026"), never server- or browser-local
 *       readTime       override ?? computed from the body (~200 wpm, min 1)
 *       subtitle/excerpt  deck ?? ""
 *       relatedItems   News recommendations (by position, public targets
 *                      only) FOLLOWED BY Performance refs (by position,
 *                      active Performances only)
 *     A native row is never dropped and never throws for a missing
 *     category: the contract needs non-null strings, so the documented
 *     fallback is used instead.
 *
 * readTime for MIGRATED rows is left exactly as before: it was, and still
 * is, `translation.readingTimeOverrideMinutes` (the migration wrote the
 * legacy minutes into it), never a computed value.
 */

const CHANNEL = "news" as const;
const SOURCE_TABLE = "website_news_posts";
/** Category key used for a native post whose news_category is NULL. Outside the Website's four filter tabs on purpose: it shows under "All" only. */
export const NATIVE_FALLBACK_CATEGORY = "news";
/** Label used when there is neither a context label nor a known category label. */
export const NATIVE_FALLBACK_LABEL = "News";
export const PUBLIC_NEWS_DATE_TIMEZONE = "Africa/Cairo";
const WORDS_PER_MINUTE = 200;

type RelatedRef = { type: "news" | "performance"; slug: string };
type Legacy = typeof websiteNewsPostsTable.$inferSelect;
type EditorialRow = { post: typeof editorialPostsTable.$inferSelect; translation: typeof editorialPostTranslationsTable.$inferSelect; legacy: Legacy | null };
export type PublicRelatedItem = { type: "news" | "performance"; slug: string; title: string | null; subtitle: string | null; categoryLabel: string | null; image: string | null; date: string | null };

export type PublicEditorialBodyBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "bulleted-list"; items: string[] }
  | { type: "image"; url: string; alt: string; caption?: string }
  | { type: "quote"; text: string; attribution?: string; attributionRole?: string };

function publicWhere() {
  return and(eq(editorialPostsTable.channel, CHANNEL), eq(editorialPostTranslationsTable.channel, CHANNEL), eq(editorialPostTranslationsTable.status, "published"), eq(editorialLanguagesTable.isActive, true), eq(editorialLanguagesTable.isDefault, true));
}

async function publicRows(options?: { slugs?: string[]; postIds?: number[] }): Promise<EditorialRow[]> {
  if (options?.slugs?.length === 0 || options?.postIds?.length === 0) return [];
  const rows = await db.select({ post: editorialPostsTable, translation: editorialPostTranslationsTable })
    .from(editorialPostTranslationsTable)
    .innerJoin(editorialPostsTable, eq(editorialPostsTable.id, editorialPostTranslationsTable.postId))
    .innerJoin(editorialLanguagesTable, eq(editorialLanguagesTable.id, editorialPostTranslationsTable.languageId))
    .where(and(publicWhere(), options?.slugs ? inArray(editorialPostTranslationsTable.slug, options.slugs) : undefined, options?.postIds ? inArray(editorialPostsTable.id, options.postIds) : undefined))
    .orderBy(desc(editorialPostTranslationsTable.publishedAt), desc(editorialPostsTable.id));
  const ids = rows.filter((row) => row.post.migrationSourceTable === SOURCE_TABLE && row.post.migrationSourceId != null).map((row) => row.post.migrationSourceId!);
  const legacyById = ids.length
    ? new Map((await db.select().from(websiteNewsPostsTable).where(inArray(websiteNewsPostsTable.id, ids))).map((row) => [row.id, row]))
    : new Map<number, Legacy>();
  // Compatibility data is matched only through the immutable migration
  // provenance. A row WITHOUT a matching legacy row is still public — it is
  // projected natively (legacy: null) instead of being dropped.
  return rows.map((row) => {
    const legacy = row.post.migrationSourceTable === SOURCE_TABLE && row.post.migrationSourceId != null ? legacyById.get(row.post.migrationSourceId) ?? null : null;
    return { ...row, legacy };
  });
}

function blocks(body: EditorialBody): PublicEditorialBodyBlock[] { return body.blocks.map((block) => ({ ...block })); }
function readTime(minutes: number | null) { return minutes == null ? null : `${minutes} min read`; }

/** Words of reader-visible prose in a body (paragraphs, headings, list items, quotes). */
export function countBodyWords(body: EditorialBody): number {
  const words = (text: string | undefined) => (text ?? "").split(/\s+/).filter(Boolean).length;
  let total = 0;
  for (const block of body.blocks) {
    if (block.type === "paragraph" || block.type === "heading" || block.type === "quote") total += words(block.text);
    else if (block.type === "bulleted-list") for (const item of block.items) total += words(item);
  }
  return total;
}

/** Native read time: the editor's override wins; otherwise ~200 words/minute, never below 1. */
export function nativeReadingMinutes(override: number | null, body: EditorialBody): number {
  return override ?? Math.max(1, Math.ceil(countBodyWords(body) / WORDS_PER_MINUTE));
}

const CAIRO_DATE = new Intl.DateTimeFormat("en-US", { timeZone: PUBLIC_NEWS_DATE_TIMEZONE, year: "numeric", month: "long", day: "2-digit" });

/**
 * Format the authoritative published timestamp as the legacy literal style
 * ("July 05, 2026") in Africa/Cairo. Accepts Postgres' timestamptz text
 * rendering ("2026-07-18 00:00:00+00"), which JS Date cannot parse as-is.
 * Returns "" (never throws) for a missing or unparseable value.
 */
export function formatPublicNewsDate(publishedAt: string | null): string {
  if (!publishedAt) return "";
  const iso = publishedAt.trim().replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : CAIRO_DATE.format(date);
}

function isKnownCategory(value: string | null): value is EditorialNewsCategory {
  return value != null && (EDITORIAL_NEWS_CATEGORIES as readonly string[]).includes(value);
}

/** The overlay-aware public fields shared by list, detail and related items. */
function projected(row: EditorialRow) {
  if (row.legacy) {
    return {
      category: row.legacy.category, categoryLabel: row.legacy.categoryLabel, publishedDate: row.legacy.publishedDate,
      subtitle: row.translation.deck ?? row.legacy.subtitle, readTime: readTime(row.translation.readingTimeOverrideMinutes),
    };
  }
  const key = row.post.newsCategory;
  return {
    category: key ?? NATIVE_FALLBACK_CATEGORY,
    categoryLabel: row.translation.contextLabel ?? (isKnownCategory(key) ? EDITORIAL_NEWS_CATEGORY_LABELS[key] : NATIVE_FALLBACK_LABEL),
    publishedDate: formatPublicNewsDate(row.translation.publishedAt),
    subtitle: row.translation.deck ?? "",
    readTime: readTime(nativeReadingMinutes(row.translation.readingTimeOverrideMinutes, row.translation.body)),
  };
}

function listingImage(row: EditorialRow) { return row.translation.listingImageUrl ?? row.post.featureImageUrl ?? ""; }

export function toLegacyCompatibleNewsContent(body: EditorialBody) {
  const all = blocks(body);
  const leadParagraph = all.find((block) => block.type === "paragraph")?.text ?? "";
  type Section = { heading?: string; paragraphs: string[]; quote?: { text: string; author: string; role: string }; bulletPoints?: string[]; image?: string; imageCaption?: string };
  const sections: Section[] = [];
  let section: Section = { paragraphs: [] };
  let consumedLead = false;
  const flush = () => { if (section.heading || section.paragraphs.length || section.quote || section.bulletPoints || section.image) sections.push(section); section = { paragraphs: [] }; };
  for (const block of all) {
    if (block.type === "heading") { flush(); section.heading = block.text; }
    else if (block.type === "paragraph") {
      // The legacy renderer shows leadParagraph separately. Keep the first
      // Editorial paragraph there without rendering it twice in a section.
      if (!consumedLead) consumedLead = true;
      else section.paragraphs.push(block.text);
    }
    else if (block.type === "bulleted-list") { if (section.bulletPoints) flush(); section.bulletPoints = [...block.items]; }
    else if (block.type === "quote") { if (section.quote) flush(); section.quote = { text: block.text, author: block.attribution ?? "", role: block.attributionRole ?? "" }; }
    else { if (section.image) flush(); section.image = block.url; section.imageCaption = block.caption; }
  }
  flush();
  return { leadParagraph, sections };
}

async function featuredIds() {
  const rows = await db.select({ postId: editorialPlacementsTable.postId })
    .from(editorialPlacementsTable)
    .innerJoin(editorialPostsTable, eq(editorialPostsTable.id, editorialPlacementsTable.postId))
    .innerJoin(editorialPostTranslationsTable, eq(editorialPostTranslationsTable.postId, editorialPostsTable.id))
    .innerJoin(editorialLanguagesTable, eq(editorialLanguagesTable.id, editorialPostTranslationsTable.languageId))
    .where(and(eq(editorialPlacementsTable.channel, CHANNEL), eq(editorialPlacementsTable.key, "featured"), publicWhere()))
    .orderBy(asc(editorialPlacementsTable.position), asc(editorialPlacementsTable.id));
  return new Set(rows.map((row) => row.postId));
}

function listItem(row: EditorialRow, featured: Set<number>) {
  const p = projected(row);
  return { slug: row.translation.slug, category: p.category, categoryLabel: p.categoryLabel, title: row.translation.title, excerpt: p.subtitle, image: listingImage(row), publishedDate: p.publishedDate, readTime: p.readTime, isFeatured: featured.has(row.post.id) };
}

/** A News post as a related item (same fields for both News and Performance pages). */
function newsRelatedItem(item: EditorialRow): PublicRelatedItem {
  const p = projected(item);
  return { type: "news", slug: item.translation.slug, title: item.translation.title, subtitle: item.translation.deck, categoryLabel: p.categoryLabel, image: listingImage(item), date: p.publishedDate };
}

function performanceRelatedItem(item: typeof websitePerformancesTable.$inferSelect): PublicRelatedItem {
  return { type: "performance", slug: item.slug, title: item.title, subtitle: item.subtitle, categoryLabel: item.categoryLabel, image: item.heroImageUrl, date: item.eventDateDisplay };
}

async function recommendationTargets(postId: number) {
  const relationRows = await db.select({ targetPostId: editorialPostRelationsTable.targetPostId })
    .from(editorialPostRelationsTable)
    .where(and(eq(editorialPostRelationsTable.sourcePostId, postId), eq(editorialPostRelationsTable.relationType, "recommended")))
    .orderBy(asc(editorialPostRelationsTable.position), asc(editorialPostRelationsTable.id));
  return relationRows.map((relation) => relation.targetPostId);
}

/** MIGRATED source: the legacy interleaved relatedRefs order, news refs gated by the Editorial recommendation allow-set. Unchanged behaviour. */
async function legacyRelatedItems(row: EditorialRow, refs: RelatedRef[]) {
  const targetIds = await recommendationTargets(row.post.id);
  const allowedEditorialTargets = new Set(targetIds);
  const [news, performances] = await Promise.all([
    publicRows({ postIds: targetIds }),
    refs.some((ref) => ref.type === "performance") ? db.select().from(websitePerformancesTable).where(and(inArray(websitePerformancesTable.slug, refs.filter((ref) => ref.type === "performance").map((ref) => ref.slug)), eq(websitePerformancesTable.isActive, true))) : Promise.resolve([]),
  ]);
  const byNewsSlug = new Map(news.map((item) => [item.translation.slug, item]));
  const byPerformanceSlug = new Map(performances.map((item) => [item.slug, item]));
  const resolved: PublicRelatedItem[] = [];
  for (const ref of refs) {
    if (ref.type === "news") {
      const item = byNewsSlug.get(ref.slug);
      if (item && allowedEditorialTargets.has(item.post.id)) resolved.push(newsRelatedItem(item));
      continue;
    }
    const item = byPerformanceSlug.get(ref.slug);
    if (item) resolved.push(performanceRelatedItem(item));
  }
  return resolved;
}

/**
 * NATIVE source: News recommendations (by position; only targets that are
 * themselves public) FOLLOWED BY Performance refs (by position; only ACTIVE
 * Performances). The two lists are stored in separate tables written by
 * separate replace endpoints, so there is no shared position space —
 * News-first is the defined, deterministic order.
 */
async function nativeRelatedItems(row: EditorialRow) {
  const targetIds = await recommendationTargets(row.post.id);
  const [news, performances] = await Promise.all([
    publicRows({ postIds: targetIds }),
    db.select({ performance: websitePerformancesTable })
      .from(editorialPostPerformanceRefsTable)
      .innerJoin(websitePerformancesTable, eq(websitePerformancesTable.id, editorialPostPerformanceRefsTable.performanceId))
      .where(and(eq(editorialPostPerformanceRefsTable.postId, row.post.id), eq(websitePerformancesTable.isActive, true)))
      .orderBy(asc(editorialPostPerformanceRefsTable.position), asc(editorialPostPerformanceRefsTable.id)),
  ]);
  const byId = new Map(news.map((item) => [item.post.id, item]));
  const resolved: PublicRelatedItem[] = [];
  for (const id of targetIds) {
    const item = byId.get(id);
    if (item) resolved.push(newsRelatedItem(item));
  }
  for (const { performance } of performances) resolved.push(performanceRelatedItem(performance));
  return resolved;
}

async function relatedItems(row: EditorialRow) {
  return row.legacy ? legacyRelatedItems(row, row.legacy.relatedRefs as RelatedRef[]) : nativeRelatedItems(row);
}

/**
 * Public News summaries by slug, for OTHER public surfaces that link to News
 * (the Performance detail's related items). Same eligibility and the same
 * overlay precedence as this module's own related items; slugs that are not
 * public are simply absent from the map.
 */
export async function getPublicNewsRelatedItemsBySlug(slugs: string[]): Promise<Map<string, PublicRelatedItem>> {
  const rows = await publicRows({ slugs: [...new Set(slugs)] });
  return new Map(rows.map((row) => {
    const item = newsRelatedItem(row);
    // Performance pages historically showed the legacy subtitle when the
    // Editorial deck is empty; keep that precedence for migrated posts.
    return [row.translation.slug, { ...item, subtitle: row.translation.deck ?? (row.legacy ? row.legacy.subtitle : null) }];
  }));
}

/** Public News for an Admin picker (e.g. the Performance editor's related-News selector). */
export async function listPublicNewsPickerItems() {
  const rows = await publicRows();
  return rows.map((row) => ({ slug: row.translation.slug, title: row.translation.title, categoryLabel: projected(row).categoryLabel, image: listingImage(row) }));
}

export async function listPublicEditorialNews() {
  const [rows, featured] = await Promise.all([publicRows(), featuredIds()]);
  return rows.map((row) => listItem(row, featured));
}

export async function getPublicEditorialNews(slug: string) {
  const [row] = await publicRows({ slugs: [slug] });
  if (!row) return null;
  const [topics, related] = await Promise.all([
    db.select({ name: editorialTopicsTable.name, slug: editorialTopicsTable.slug }).from(editorialPostTopicsTable).innerJoin(editorialTopicsTable, eq(editorialTopicsTable.id, editorialPostTopicsTable.topicId)).where(and(eq(editorialPostTopicsTable.postId, row.post.id), eq(editorialTopicsTable.channel, CHANNEL))).orderBy(asc(editorialTopicsTable.name), asc(editorialTopicsTable.id)),
    relatedItems(row),
  ]);
  const gallery = (row.translation.gallery as EditorialGallery).items;
  const author = row.translation.authorSnapshot;
  const p = projected(row);
  return {
    slug: row.translation.slug, category: p.category, categoryLabel: p.categoryLabel, title: row.translation.title, subtitle: p.subtitle, heroImageUrl: row.post.featureImageUrl ?? "", publishedDate: p.publishedDate, readTime: p.readTime, authorName: author?.name ?? "", authorRole: author?.role ?? "", authorAvatarUrl: author?.avatarUrl ?? null, galleryImages: gallery.map((item) => item.url), tags: topics.map((item) => item.name), content: toLegacyCompatibleNewsContent(row.translation.body), relatedItems: related,
    publishedAt: row.translation.publishedAt, featureImageAlt: row.translation.featureImageAlt, body: { blocks: blocks(row.translation.body) }, gallery: { items: gallery.map((item) => ({ url: item.url, alt: item.alt })) }, author: author ? { name: author.name, role: author.role, avatarUrl: author.avatarUrl } : null, topics,
  };
}
