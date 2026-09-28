import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  editorialLanguagesTable, editorialPlacementsTable, editorialPostRelationsTable, editorialPostTopicsTable,
  editorialPostTranslationsTable, editorialPostsTable, editorialTopicsTable,
  websiteNewsPostsTable, websitePerformancesTable, type EditorialBody, type EditorialGallery,
} from "@workspace/db/schema";

const CHANNEL = "news" as const;
const SOURCE_TABLE = "website_news_posts";
type RelatedRef = { type: "news" | "performance"; slug: string };
type EditorialRow = { post: typeof editorialPostsTable.$inferSelect; translation: typeof editorialPostTranslationsTable.$inferSelect; legacy: typeof websiteNewsPostsTable.$inferSelect };

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
  if (!ids.length) return [];
  const legacyById = new Map((await db.select().from(websiteNewsPostsTable).where(inArray(websiteNewsPostsTable.id, ids))).map((row) => [row.id, row]));
  // Compatibility data is matched only through the immutable migration provenance.
  return rows.flatMap((row) => {
    const legacy = row.post.migrationSourceId == null ? undefined : legacyById.get(row.post.migrationSourceId);
    return legacy ? [{ ...row, legacy }] : [];
  });
}

function blocks(body: EditorialBody): PublicEditorialBodyBlock[] { return body.blocks.map((block) => ({ ...block })); }
function readTime(minutes: number | null) { return minutes == null ? null : `${minutes} min read`; }

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
  return { slug: row.translation.slug, category: row.legacy.category, categoryLabel: row.legacy.categoryLabel, title: row.translation.title, excerpt: row.translation.deck ?? row.legacy.subtitle, image: row.translation.listingImageUrl ?? row.post.featureImageUrl, publishedDate: row.legacy.publishedDate, readTime: readTime(row.translation.readingTimeOverrideMinutes), isFeatured: featured.has(row.post.id) };
}

async function relatedItems(row: EditorialRow) {
  const refs = row.legacy.relatedRefs as RelatedRef[];
  const relationRows = await db.select({ targetPostId: editorialPostRelationsTable.targetPostId })
    .from(editorialPostRelationsTable)
    .where(and(eq(editorialPostRelationsTable.sourcePostId, row.post.id), eq(editorialPostRelationsTable.relationType, "recommended")))
    .orderBy(asc(editorialPostRelationsTable.position), asc(editorialPostRelationsTable.id));
  const allowedEditorialTargets = new Set(relationRows.map((relation) => relation.targetPostId));
  const [news, performances] = await Promise.all([
    publicRows({ postIds: relationRows.map((relation) => relation.targetPostId) }),
    refs.some((ref) => ref.type === "performance") ? db.select().from(websitePerformancesTable).where(and(inArray(websitePerformancesTable.slug, refs.filter((ref) => ref.type === "performance").map((ref) => ref.slug)), eq(websitePerformancesTable.isActive, true))) : Promise.resolve([]),
  ]);
  const byNewsSlug = new Map(news.map((item) => [item.translation.slug, item]));
  const byPerformanceSlug = new Map(performances.map((item) => [item.slug, item]));
  const resolved: Array<{ type: "news" | "performance"; slug: string; title: string | null; subtitle: string | null; categoryLabel: string | null; image: string | null; date: string | null }> = [];
  for (const ref of refs) {
    if (ref.type === "news") {
      const item = byNewsSlug.get(ref.slug);
      if (item && allowedEditorialTargets.has(item.post.id)) resolved.push({ type: "news", slug: item.translation.slug, title: item.translation.title, subtitle: item.translation.deck, categoryLabel: item.legacy.categoryLabel, image: item.translation.listingImageUrl ?? item.post.featureImageUrl, date: item.legacy.publishedDate });
      continue;
    }
    const item = byPerformanceSlug.get(ref.slug);
    if (item) resolved.push({ type: "performance", slug: item.slug, title: item.title, subtitle: item.subtitle, categoryLabel: item.categoryLabel, image: item.heroImageUrl, date: item.eventDateDisplay });
  }
  return resolved;
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
  return {
    slug: row.translation.slug, category: row.legacy.category, categoryLabel: row.legacy.categoryLabel, title: row.translation.title, subtitle: row.translation.deck ?? row.legacy.subtitle, heroImageUrl: row.post.featureImageUrl, publishedDate: row.legacy.publishedDate, readTime: readTime(row.translation.readingTimeOverrideMinutes), authorName: author?.name ?? "", authorRole: author?.role ?? "", authorAvatarUrl: author?.avatarUrl ?? null, galleryImages: gallery.map((item) => item.url), tags: topics.map((item) => item.name), content: toLegacyCompatibleNewsContent(row.translation.body), relatedItems: related,
    publishedAt: row.translation.publishedAt, featureImageAlt: row.translation.featureImageAlt, body: { blocks: blocks(row.translation.body) }, gallery: { items: gallery.map((item) => ({ url: item.url, alt: item.alt })) }, author: author ? { name: author.name, role: author.role, avatarUrl: author.avatarUrl } : null, topics,
  };
}
