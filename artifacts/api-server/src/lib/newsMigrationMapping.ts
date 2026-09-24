/**
 * News → Editorial FIELD MAPPING — Final Editorial, Phase B.
 *
 * PURE. This module performs no I/O, opens no transaction, reads no
 * database and calls no service. It takes one `website_news_posts` row
 * plus the manifest and returns either the exact Editorial payload that
 * row becomes, or the list of reasons it cannot. Every mode of the tool —
 * dry-run, execute, verify, rollback-dry-run — runs this SAME function, so
 * a dry-run's promise and an execute's write cannot disagree: they are
 * literally the same computation.
 *
 * ─── THE COMPLETE MAP ────────────────────────────────────────────────────
 *
 *   LEGACY COLUMN            EDITORIAL DESTINATION
 *   ──────────────────────   ───────────────────────────────────────────────
 *   id                       editorial_posts.migration_source_id (+ …_table)
 *   slug                     translation.slug (or a manifest override)
 *   title                    translation.title
 *   subtitle                 translation.deck
 *   excerpt                  NO HOME — see "excerpt" below (never dropped
 *                            silently; surfaces as a content-review item)
 *   category                 NO HOME — recorded for review
 *   category_label           translation.context_label
 *   hero_image_url           editorial_posts.feature_image_url
 *   (none)                   translation.feature_image_alt ← MANIFEST
 *   listing_image_url        translation.listing_image_url  (migration 0128)
 *   published_date           NO HOME — the literal display string; recorded
 *   published_at             translation.published_at, via the REAL
 *                            publishTranslation path (see below)
 *   read_time                translation.reading_time_override_minutes
 *   is_featured              an editorial PLACEMENT (never a column)
 *   author_name/role/avatar  editorial_posts.author_id ← MANIFEST
 *   tags[]                   editorial_post_topics ← MANIFEST
 *   gallery_images[]         translation.gallery      (migration 0129)
 *   content                  translation.body (typed blocks)
 *   related_refs[]           news→news: editorial_post_relations
 *                            news→performance: PRESERVATION MANIFEST ONLY
 *   is_active                the translation's lifecycle state
 *   updated_by_admin_id      not migrated (Editorial stamps its own actor)
 *   created_at / updated_at  not migrated (Editorial stamps its own)
 *
 * ─── WHY published_at IS NOT WRITTEN HERE ────────────────────────────────
 *
 * This module RETURNS the historical timestamp; the writer pre-seeds it on
 * the draft row and then calls the real `publishTranslationInTx`, whose
 * long-standing rule is `publishedAt: translation.publishedAt ?? now()`.
 * So the historical date is preserved BY the lifecycle path rather than
 * around it. A migration that set `status = 'published'` itself would be a
 * second copy of the publish rules, free to drift from the one Admin uses.
 *
 * ─── WHY NOTHING IS EVER GUESSED ─────────────────────────────────────────
 *
 * Three fields Editorial requires do not exist in the legacy model at all:
 * feature image alt, body image alt, gallery alt. Every one of them is a
 * description of a picture, and the only text at hand — the title, the
 * subtitle, the caption — describes the ARTICLE or addresses a reader who
 * can already see the picture. Deriving alt from any of them would give
 * screen-reader users a plausible-sounding falsehood while making the
 * accessibility gate report success, which is worse than an empty field
 * because it is not discoverable. They come from the manifest or the row
 * does not migrate.
 */
import type { WebsiteNewsPost } from "@workspace/db";
import type { EditorialBodyBlock } from "@workspace/db";
import {
  resolveAuthorDecision,
  resolveBodyImageAlt,
  resolveFeatureImageAlt,
  resolveGalleryAlt,
  resolveSlugOverride,
  resolveTopicDecision,
  type NewsMigrationManifest,
} from "./newsMigrationManifest";

/** Written into editorial_posts.migration_source_table for every row. */
export const MIGRATION_SOURCE_TABLE = "website_news_posts";

/**
 * A reason ONE source row cannot be migrated. Blockers are never
 * downgraded to warnings and there is no flag that ignores one: every
 * blocker is a decision only a person can make, so proceeding past it
 * would mean the tool made it instead.
 */
export type MappingBlockerCode =
  // ── Per-row, decided by the manifest ──────────────────────────────────
  | "author_unresolved"
  | "topic_unresolved"
  | "feature_image_alt_missing"
  | "body_image_alt_missing"
  | "gallery_alt_missing"
  | "featured_placement_undeclared"
  | "gallery_too_large"
  | "body_empty"
  // ── Manifest-level: these block the WHOLE run, not one row ────────────
  | "language_unusable"
  | "manifest_author_invalid"
  | "manifest_topic_invalid"
  // ── Per-row, decided by the state of the target database ──────────────
  | "slug_collision_unrelated"
  | "slug_collision_ambiguous"
  | "post_migration_drift";

export interface MappingBlocker {
  code: MappingBlockerCode;
  message: string;
  /** What a human must add to the manifest, or do in Admin, to clear it. */
  remedy: string;
}

/**
 * Something real in the source that Editorial has NO field for, or a value
 * the tool declined to interpret. Not an error — the row still migrates —
 * but it is carried into the report so a human sees it rather than
 * discovering the loss months later on a public page.
 */
export interface MappingNote {
  code:
    | "excerpt_distinct_from_subtitle"
    | "legacy_category_key_not_migrated"
    | "published_date_literal_not_migrated"
    | "read_time_unparseable"
    | "author_avatar_differs"
    | "topic_skipped"
    | "slug_overridden";
  message: string;
}

/** A legacy related-ref that points at a Performance. See CROSS-TYPE below. */
export interface CrossTypeReference {
  sourceSlug: string;
  /** Always "performance" — the only cross-type the legacy model has. */
  targetType: "performance";
  targetSlug: string;
  /** The ref's index in the legacy related_refs array; order is preserved. */
  position: number;
}

export interface MappedTranslation {
  slug: string;
  title: string;
  deck: string | null;
  contextLabel: string | null;
  featureImageAlt: string;
  listingImageUrl: string | null;
  body: { blocks: EditorialBodyBlock[] };
  gallery: { items: Array<{ url: string; alt: string }> };
  readingTimeOverrideMinutes: number | null;
  seoTitle: string | null;
  seoDescription: string | null;
  ogImageUrl: string | null;
}

export interface MappedPost {
  sourceId: number;
  sourceSlug: string;
  featureImageUrl: string | null;
  authorId: number;
  topicIds: number[];
  translation: MappedTranslation;
  /** The historical publication timestamp, pre-seeded before publishing. */
  publishedAt: string;
  /**
   * The lifecycle the row ends in.
   *
   * `is_active = true`  → published.
   * `is_active = false` → published THEN archived, not "draft". A legacy
   *   row with is_active=false is content that WAS public and has since
   *   been hidden; Editorial's word for that is `archived`. Landing it as
   *   a draft would erase the fact that it was ever published and would
   *   throw away its publication date on the way (a draft that has never
   *   published has no publishedAt to preserve). Going through both real
   *   transitions records the true history in the audit log too.
   */
  lifecycle: "published" | "published-then-archived";
  /** Legacy news→news refs, in order. Resolved to post ids by the writer. */
  newsRecommendations: Array<{ targetSlug: string; position: number }>;
  /** Legacy news→performance refs. NEVER become recommendations. */
  crossTypeReferences: CrossTypeReference[];
  /** Placement slot this row joins, or null when is_featured is false. */
  featuredPlacementKey: string | null;
  notes: MappingNote[];
}

export type MappingResult =
  | { ok: true; mapped: MappedPost }
  | { ok: false; sourceId: number; sourceSlug: string; blockers: MappingBlocker[] };

/** Matches migration 0129's / editorialGallery.ts's ceiling. */
const MAX_GALLERY_ITEMS = 30;

/**
 * "4 min read" → 4. STRICT, and deliberately so: the column is an integer
 * override and the legacy value is free text, so anything the pattern does
 * not match becomes NULL plus a note, never a guess. Editorial computes a
 * reading time from the body when there is no override, which is a better
 * answer than a number invented from an unparseable string.
 */
export function parseReadTimeMinutes(readTime: string | null): number | null {
  if (!readTime) return null;
  const match = /^\s*(\d{1,3})\s*min(?:ute)?s?\b/i.exec(readTime);
  if (!match) return null;
  const minutes = Number(match[1]);
  return Number.isSafeInteger(minutes) && minutes > 0 ? minutes : null;
}

/**
 * Legacy `content` → Editorial body blocks.
 *
 * BLOCK ORDER WITHIN A SECTION is heading → paragraphs → quote → bullet
 * points → image. That is not a preference: it is the order the legacy
 * Admin editor presents the fields in
 * (artifacts/admin/src/pages/website/news/WebsiteNewsEditorPage.tsx), which
 * is the only authoring order this repository actually records. Choosing a
 * different one would silently reflow every migrated article.
 *
 * The QUOTE is why Phase A added a fifth block type. Before it, a legacy
 * `quote: { text, author, role }` could only have become a paragraph —
 * losing the attribution, the role, and the fact that it was a quote at
 * all. `quote.author` → `attribution`, `quote.role` → `attributionRole`,
 * one-to-one, nothing invented and nothing dropped.
 *
 * `heading` becomes level 2. The legacy model has ONE heading level, so
 * every heading is a top-level section heading; mapping it to 3 would
 * imply a nesting the source does not contain.
 */
export function mapBodyBlocks(
  post: Pick<WebsiteNewsPost, "slug" | "content">,
  manifest: NewsMigrationManifest,
): { blocks: EditorialBodyBlock[]; blockers: MappingBlocker[] } {
  const blocks: EditorialBodyBlock[] = [];
  const blockers: MappingBlocker[] = [];
  const content = post.content;

  const lead = (content?.leadParagraph ?? "").trim();
  if (lead.length > 0) blocks.push({ type: "paragraph", text: lead });

  const sections = Array.isArray(content?.sections) ? content.sections : [];
  sections.forEach((section, sectionIndex) => {
    const heading = (section.heading ?? "").trim();
    if (heading.length > 0) blocks.push({ type: "heading", level: 2, text: heading });

    for (const paragraph of section.paragraphs ?? []) {
      const text = (paragraph ?? "").trim();
      if (text.length > 0) blocks.push({ type: "paragraph", text });
    }

    if (section.quote) {
      const text = (section.quote.text ?? "").trim();
      if (text.length > 0) {
        const attribution = (section.quote.author ?? "").trim();
        const attributionRole = (section.quote.role ?? "").trim();
        blocks.push({
          type: "quote",
          text,
          // Omitted rather than sent as "" when the legacy value is blank:
          // both fields are OPTIONAL on the block, and an empty string
          // would render an empty byline line under the quote.
          ...(attribution.length > 0 ? { attribution } : {}),
          ...(attributionRole.length > 0 ? { attributionRole } : {}),
        });
      }
    }

    const bullets = (section.bulletPoints ?? [])
      .map((item) => (item ?? "").trim())
      .filter((item) => item.length > 0);
    if (bullets.length > 0) blocks.push({ type: "bulleted-list", items: bullets });

    const imageUrl = (section.image ?? "").trim();
    if (imageUrl.length > 0) {
      const alt = resolveBodyImageAlt(manifest, post.slug, sectionIndex);
      if (!alt) {
        blockers.push({
          code: "body_image_alt_missing",
          message: `"${post.slug}" section ${sectionIndex + 1} has an in-article image with no alt text.`,
          remedy: `Add { "sourceSlug": "${post.slug}", "sectionIndex": ${sectionIndex}, "alt": "…" } to the manifest's bodyImageAlt. The legacy imageCaption is NOT reused as alt text — a caption and alt text are written for different readers.`,
        });
      } else {
        const caption = (section.imageCaption ?? "").trim();
        blocks.push({
          type: "image",
          url: imageUrl,
          alt,
          // The caption IS carried across, verbatim. It is only its use as
          // ALT that is refused.
          ...(caption.length > 0 ? { caption } : {}),
        });
      }
    }
  });

  return { blocks, blockers };
}

export interface MapPostOptions {
  /**
   * The placement key `is_featured` means, from the manifest. Null when
   * the manifest declared none — which is a BLOCKER for a featured row
   * and irrelevant for an unfeatured one.
   */
  featuredPlacementKey: string | null;
}

/**
 * Map ONE legacy row. Collects ALL blockers rather than throwing on the
 * first, so one dry-run tells an operator everything the manifest is
 * missing instead of revealing it one run at a time.
 */
export function mapNewsPost(
  post: WebsiteNewsPost,
  manifest: NewsMigrationManifest,
  options: MapPostOptions,
): MappingResult {
  const blockers: MappingBlocker[] = [];
  const notes: MappingNote[] = [];

  // ── Author: EXACT (name, role) pair, never a similarity score ──────────
  const authorDecision = resolveAuthorDecision(manifest, post.authorName, post.authorRole);
  if (!authorDecision) {
    blockers.push({
      code: "author_unresolved",
      message: `No manifest entry maps the byline "${post.authorName}" / "${post.authorRole}" to an editorial author.`,
      remedy: `Add { "sourceName": "${post.authorName}", "sourceRole": "${post.authorRole}", "editorialAuthorId": N } to the manifest's authors. Entries are keyed by name AND role together, so the same person under a different role needs its own entry — point both at the same editorialAuthorId if they are genuinely one author.`,
    });
  }

  // ── Topics ─────────────────────────────────────────────────────────────
  const topicIds: number[] = [];
  for (const tag of post.tags ?? []) {
    const decision = resolveTopicDecision(manifest, tag);
    if (decision.kind === "unresolved") {
      blockers.push({
        code: "topic_unresolved",
        message: `No manifest entry decides what to do with the tag "${tag}".`,
        remedy: `Add { "sourceTag": "${tag}", "editorialTopicId": N } — or { "sourceTag": "${tag}", "skip": true } to drop it deliberately — to the manifest's topics.`,
      });
      continue;
    }
    if (decision.kind === "skipped") {
      notes.push({
        code: "topic_skipped",
        message: `Tag "${tag}" was deliberately dropped by the manifest and is not carried into Editorial topics.`,
      });
      continue;
    }
    // De-duplicated: two legacy tags may map to one editorial topic, and
    // editorial_post_topics is UNIQUE (post_id, topic_id).
    if (!topicIds.includes(decision.topicId)) topicIds.push(decision.topicId);
  }

  // ── Feature image alt ──────────────────────────────────────────────────
  const featureImageAlt = resolveFeatureImageAlt(manifest, post.slug);
  if (!featureImageAlt) {
    blockers.push({
      code: "feature_image_alt_missing",
      message: `"${post.slug}" has a hero image with no alt text.`,
      remedy: `Add { "sourceSlug": "${post.slug}", "alt": "…" } to the manifest's featureImageAlt. It is never derived from the title — a title describes the article, not the picture.`,
    });
  }

  // ── Body ───────────────────────────────────────────────────────────────
  const { blocks, blockers: bodyBlockers } = mapBodyBlocks(post, manifest);
  blockers.push(...bodyBlockers);
  if (blocks.length === 0 && bodyBlockers.length === 0) {
    blockers.push({
      code: "body_empty",
      message: `"${post.slug}" maps to an empty body — every paragraph, heading and list in its content is blank.`,
      remedy: "Fix the legacy row's content, or exclude this row from the migration scope.",
    });
  }

  // ── Gallery ────────────────────────────────────────────────────────────
  const galleryUrls = post.galleryImages ?? [];
  if (galleryUrls.length > MAX_GALLERY_ITEMS) {
    blockers.push({
      code: "gallery_too_large",
      message: `"${post.slug}" has ${galleryUrls.length} gallery images; Editorial allows at most ${MAX_GALLERY_ITEMS}.`,
      remedy: "Trim the legacy gallery before migrating, or exclude this row from scope.",
    });
  }
  const galleryItems: Array<{ url: string; alt: string }> = [];
  galleryUrls.forEach((url, index) => {
    const alt = resolveGalleryAlt(manifest, post.slug, index);
    if (!alt) {
      blockers.push({
        code: "gallery_alt_missing",
        message: `"${post.slug}" gallery image ${index + 1} has no alt text.`,
        remedy: `Add { "sourceSlug": "${post.slug}", "index": ${index}, "alt": "…" } to the manifest's galleryAlt. The legacy gallery is a bare list of URLs carrying no caption and no alt, so there is nothing to derive it from.`,
      });
      return;
    }
    galleryItems.push({ url, alt });
  });

  // ── Featured → placement ───────────────────────────────────────────────
  if (post.isFeatured && !options.featuredPlacementKey) {
    blockers.push({
      code: "featured_placement_undeclared",
      message: `"${post.slug}" is flagged is_featured, but the manifest declares no featuredPlacement slot.`,
      remedy: 'Add "featuredPlacement": { "placementKey": "…" } to the manifest. Editorial has no per-post featured boolean — curation is named, ordered slots — so which slot the legacy flag means is an editorial decision.',
    });
  }

  // ── Notes: real source values with no Editorial home ───────────────────
  const subtitle = (post.subtitle ?? "").trim();
  const excerpt = (post.excerpt ?? "").trim();
  if (excerpt.length > 0 && excerpt !== subtitle) {
    notes.push({
      code: "excerpt_distinct_from_subtitle",
      message: `"${post.slug}" has an excerpt that differs from its subtitle. Editorial has ONE standfirst field (deck), which receives the subtitle verbatim; the distinct excerpt text has no Editorial home and is recorded here rather than dropped silently. Excerpt was: ${JSON.stringify(excerpt)}`,
    });
  }
  notes.push({
    code: "legacy_category_key_not_migrated",
    message: `"${post.slug}" carries the machine category key ${JSON.stringify(post.category)}; Editorial's context label receives the human-readable categoryLabel ${JSON.stringify(post.categoryLabel)}. The key itself is taxonomy, which Editorial expresses as topics, and is recorded rather than migrated.`,
  });
  notes.push({
    code: "published_date_literal_not_migrated",
    message: `"${post.slug}" carries the literal display date ${JSON.stringify(post.publishedDate)}. Editorial renders dates from the real timestamp, so the literal string is recorded here for comparison rather than migrated into a field that does not exist.`,
  });

  const readingTimeOverrideMinutes = parseReadTimeMinutes(post.readTime);
  if (post.readTime && readingTimeOverrideMinutes == null) {
    notes.push({
      code: "read_time_unparseable",
      message: `"${post.slug}" has read_time ${JSON.stringify(post.readTime)}, which is not a plain "<n> min read". No override is written and Editorial will compute the reading time from the body; the tool does not guess a number.`,
    });
  }

  if (authorDecision && post.authorAvatarUrl) {
    notes.push({
      code: "author_avatar_differs",
      message: `"${post.slug}" carries a legacy byline avatar (${post.authorAvatarUrl}). The migration NEVER modifies an existing editorial author row, so editorial author #${authorDecision.editorialAuthorId} keeps its own avatar; compare them by hand if they should match.`,
    });
  }

  // ── Slug ───────────────────────────────────────────────────────────────
  const override = resolveSlugOverride(manifest, post.slug);
  if (override) {
    notes.push({
      code: "slug_overridden",
      message: `"${post.slug}" migrates under the manifest-chosen slug "${override}" instead of its legacy slug.`,
    });
  }

  // ── Related refs: the cross-type split ─────────────────────────────────
  //
  // This is the one place the same-channel invariant could be broken by a
  // mechanical translation, so the split is explicit and total. A legacy
  // related_ref is `{ type: 'news' | 'performance', slug }`. A 'news' ref
  // points at another row in the SAME migration scope and becomes a real
  // editorial_post_relations row. A 'performance' ref points at
  // website_performances, which Phase B does not touch, has no Editorial
  // representation, and lives in the OTHER channel's conceptual space —
  // there is no post id to point at, and inventing one, or dropping the
  // ref into the news channel's recommendations anyway, would put a
  // cross-channel edge into a table whose whole contract is that it has
  // none. It goes into the PRESERVATION MANIFEST: recorded, ordered,
  // reportable, and never written to editorial_post_relations.
  const newsRecommendations: Array<{ targetSlug: string; position: number }> = [];
  const crossTypeReferences: CrossTypeReference[] = [];
  (post.relatedRefs ?? []).forEach((ref, position) => {
    if (ref.type === "performance") {
      crossTypeReferences.push({
        sourceSlug: post.slug,
        targetType: "performance",
        targetSlug: ref.slug,
        position,
      });
      return;
    }
    newsRecommendations.push({ targetSlug: ref.slug, position });
  });

  if (blockers.length > 0) {
    return { ok: false, sourceId: post.id, sourceSlug: post.slug, blockers };
  }

  return {
    ok: true,
    mapped: {
      sourceId: post.id,
      sourceSlug: post.slug,
      featureImageUrl: post.heroImageUrl,
      authorId: authorDecision!.editorialAuthorId,
      topicIds,
      publishedAt: post.publishedAt,
      lifecycle: post.isActive ? "published" : "published-then-archived",
      newsRecommendations,
      crossTypeReferences,
      featuredPlacementKey: post.isFeatured ? options.featuredPlacementKey : null,
      notes,
      translation: {
        slug: override ?? post.slug,
        title: post.title,
        deck: subtitle.length > 0 ? subtitle : null,
        contextLabel: (post.categoryLabel ?? "").trim() || null,
        featureImageAlt: featureImageAlt!,
        listingImageUrl: post.listingImageUrl,
        body: { blocks },
        gallery: { items: galleryItems },
        readingTimeOverrideMinutes,
        // SEO fields are NOT invented. The legacy model has no SEO title,
        // no SEO description and no OG image, and copying the title and
        // subtitle into them would manufacture search metadata nobody
        // wrote and make the Admin's "SEO not set" state unreadable.
        seoTitle: null,
        seoDescription: null,
        ogImageUrl: null,
      },
    },
  };
}
