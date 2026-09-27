/**
 * Field-mapping tests — Final Editorial, Phase B.
 *
 * Two things are being protected here:
 *
 *   1. FIDELITY. Every legacy value either lands in a named Editorial
 *      field or is reported as having no home. Nothing evaporates.
 *   2. REFUSAL. Every field Editorial requires and the legacy model does
 *      not contain — all three kinds of alt text — blocks rather than
 *      being invented from the nearest plausible string.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { WebsiteNewsPost } from "@workspace/db";
import { parseNewsMigrationManifest } from "./newsMigrationManifest";
import { mapNewsPost, parseReadTimeMinutes } from "./newsMigrationMapping";

function manifest(overrides: Record<string, unknown> = {}) {
  return parseNewsMigrationManifest({
    manifestVersion: 1,
    sourceTable: "website_news_posts",
    targetChannel: "news",
    languageCode: "en",
    authors: [{ sourceName: "Victoria Vance", sourceRole: "Artistic Director", editorialAuthorId: 11 }],
    topics: [{ sourceTag: "YAGP", editorialTopicId: 21 }],
    featureImageAlt: [{ sourceSlug: "news-1", alt: "Dancers on a lit stage mid-leap." }],
    ...overrides,
  });
}

function row(overrides: Partial<WebsiteNewsPost> = {}): WebsiteNewsPost {
  return {
    id: 1,
    slug: "news-1",
    category: "awards",
    categoryLabel: "Awards & Recognition",
    title: "A triumph at YAGP",
    subtitle: "Four soloists, four offers.",
    excerpt: null,
    heroImageUrl: "https://example.test/hero.jpg",
    listingImageUrl: "https://example.test/listing.jpg",
    publishedDate: "July 18, 2026",
    publishedAt: "2026-07-18T00:00:00.000Z",
    readTime: "4 min read",
    isFeatured: false,
    authorName: "Victoria Vance",
    authorRole: "Artistic Director",
    authorAvatarUrl: null,
    tags: ["YAGP"],
    galleryImages: [],
    content: { leadParagraph: "Lead.", sections: [] },
    relatedRefs: [],
    isActive: true,
    updatedByAdminId: null,
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
    ...overrides,
  } as WebsiteNewsPost;
}

function mapped(post: WebsiteNewsPost, m = manifest(), featuredPlacementKey: string | null = null) {
  const result = mapNewsPost(post, m, { featuredPlacementKey });
  assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.blockers, null, 2));
  return result.ok ? result.mapped : (undefined as never);
}

function blockers(post: WebsiteNewsPost, m = manifest(), featuredPlacementKey: string | null = null) {
  const result = mapNewsPost(post, m, { featuredPlacementKey });
  assert.equal(result.ok, false, "expected the row to be blocked");
  return result.ok ? [] : result.blockers;
}

// ─── Core field fidelity ─────────────────────────────────────────────────────

test("carries the plain scalar fields across verbatim", () => {
  const out = mapped(row());
  assert.equal(out.translation.title, "A triumph at YAGP");
  assert.equal(out.translation.deck, "Four soloists, four offers.");
  assert.equal(out.translation.contextLabel, "Awards & Recognition");
  assert.equal(out.translation.slug, "news-1");
  assert.equal(out.translation.listingImageUrl, "https://example.test/listing.jpg");
  assert.equal(out.featureImageUrl, "https://example.test/hero.jpg");
  assert.equal(out.publishedAt, "2026-07-18T00:00:00.000Z");
  assert.equal(out.authorId, 11);
  assert.deepEqual(out.topicIds, [21]);
});

test("never invents SEO metadata from the title or subtitle", () => {
  // Copying title→seoTitle and subtitle→seoDescription would manufacture
  // search metadata nobody wrote, and would make Admin's "SEO not set"
  // state unreadable for every migrated post.
  const out = mapped(row());
  assert.equal(out.translation.seoTitle, null);
  assert.equal(out.translation.seoDescription, null);
  assert.equal(out.translation.ogImageUrl, null);
});

test('read time "4 min read" becomes 4; anything else becomes null plus a note', () => {
  assert.equal(parseReadTimeMinutes("4 min read"), 4);
  assert.equal(parseReadTimeMinutes("12 minutes"), 12);
  assert.equal(parseReadTimeMinutes("a short read"), null);
  assert.equal(parseReadTimeMinutes(null), null);
  assert.equal(parseReadTimeMinutes("0 min read"), null);

  const out = mapped(row({ readTime: "a quick read" }));
  assert.equal(out.translation.readingTimeOverrideMinutes, null);
  assert.ok(out.notes.some((note) => note.code === "read_time_unparseable"));
});

test("an excerpt that differs from the subtitle is reported, not dropped silently", () => {
  const out = mapped(row({ excerpt: "A different listing summary." }));
  assert.equal(out.translation.deck, "Four soloists, four offers.");
  const note = out.notes.find((n) => n.code === "excerpt_distinct_from_subtitle");
  assert.ok(note, "the distinct excerpt must be surfaced for review");
  assert.match(note!.message, /A different listing summary/);
});

test("an excerpt equal to the subtitle produces no review note", () => {
  const out = mapped(row({ excerpt: "Four soloists, four offers." }));
  assert.equal(out.notes.some((n) => n.code === "excerpt_distinct_from_subtitle"), false);
});

test("the literal display date and the machine category key are recorded as having no home", () => {
  const out = mapped(row());
  assert.ok(out.notes.some((n) => n.code === "published_date_literal_not_migrated"));
  assert.ok(out.notes.some((n) => n.code === "legacy_category_key_not_migrated"));
});

// ─── Body blocks ─────────────────────────────────────────────────────────────

test("maps a full section in the legacy authoring order: heading, paragraphs, quote, bullets, image", () => {
  // The order is not a preference — it is the order the legacy Admin
  // editor presents the fields in, which is the only authoring order this
  // repository records. Any other order silently reflows the article.
  const out = mapped(
    row({
      content: {
        leadParagraph: "Lead paragraph.",
        sections: [
          {
            heading: "Section one",
            paragraphs: ["First.", "Second."],
            quote: { text: "They communicated true soul.", author: "Victoria Vance", role: "Artistic Director" },
            bulletPoints: ["Alpha", "Beta"],
            image: "https://example.test/section.jpg",
            imageCaption: "Clara mid-solo.",
          },
        ],
      } as WebsiteNewsPost["content"],
    }),
    manifest({
      bodyImageAlt: [{ sourceSlug: "news-1", sectionIndex: 0, alt: "A dancer in a white tutu, arms raised." }],
    }),
  );
  assert.deepEqual(
    out.translation.body.blocks.map((block) => block.type),
    ["paragraph", "heading", "paragraph", "paragraph", "quote", "bulleted-list", "image"],
  );
});

test("a legacy quote keeps its text, its speaker AND the speaker's role", () => {
  // Before Phase A added the quote block, this could only have become a
  // paragraph — losing the attribution, the role, and the fact that it was
  // a quote at all.
  const out = mapped(
    row({
      content: {
        leadParagraph: "Lead.",
        sections: [
          {
            paragraphs: [],
            quote: { text: "Quoted words.", author: "Someone", role: "A role" },
          },
        ],
      } as WebsiteNewsPost["content"],
    }),
  );
  assert.deepEqual(out.translation.body.blocks.at(-1), {
    type: "quote",
    text: "Quoted words.",
    attribution: "Someone",
    attributionRole: "A role",
  });
});

test("a quote with a blank speaker omits the field rather than storing an empty string", () => {
  const out = mapped(
    row({
      content: {
        leadParagraph: "Lead.",
        sections: [{ paragraphs: [], quote: { text: "Anonymous words.", author: "", role: "" } }],
      } as WebsiteNewsPost["content"],
    }),
  );
  assert.deepEqual(out.translation.body.blocks.at(-1), { type: "quote", text: "Anonymous words." });
});

test("headings become level 2, because the legacy model has exactly one heading level", () => {
  const out = mapped(
    row({
      content: {
        leadParagraph: "Lead.",
        sections: [{ heading: "A heading", paragraphs: [] }],
      } as WebsiteNewsPost["content"],
    }),
  );
  assert.deepEqual(out.translation.body.blocks.at(-1), { type: "heading", level: 2, text: "A heading" });
});

test("an in-article image carries its caption but REFUSES to reuse it as alt text", () => {
  // A caption tells someone who can see the picture what is interesting
  // about it; alt text must tell someone who cannot what is IN it. Copying
  // one into the other would make the accessibility gate report success
  // while giving screen-reader users a worse experience.
  const post = row({
    content: {
      leadParagraph: "Lead.",
      sections: [
        { paragraphs: [], image: "https://example.test/s.jpg", imageCaption: "Clara mid-solo." },
      ],
    } as WebsiteNewsPost["content"],
  });

  const refused = blockers(post);
  assert.ok(refused.some((b) => b.code === "body_image_alt_missing"));

  const out = mapped(
    post,
    manifest({ bodyImageAlt: [{ sourceSlug: "news-1", sectionIndex: 0, alt: "A dancer in arabesque." }] }),
  );
  assert.deepEqual(out.translation.body.blocks.at(-1), {
    type: "image",
    url: "https://example.test/s.jpg",
    alt: "A dancer in arabesque.",
    caption: "Clara mid-solo.",
  });
});

// ─── Fail-closed: the three kinds of alt text ────────────────────────────────

test("a missing feature image alt blocks; it is never derived from the title", () => {
  const found = blockers(row(), manifest({ featureImageAlt: [] }));
  const blocker = found.find((b) => b.code === "feature_image_alt_missing");
  assert.ok(blocker);
  assert.match(blocker!.remedy, /never derived from the title/);
});

test("a missing gallery alt blocks, per image, with the image's index", () => {
  const found = blockers(
    row({ galleryImages: ["https://example.test/a.jpg", "https://example.test/b.jpg"] }),
  );
  const galleryBlockers = found.filter((b) => b.code === "gallery_alt_missing");
  assert.equal(galleryBlockers.length, 2);
  assert.match(galleryBlockers[0].remedy, /"index": 0/);
  assert.match(galleryBlockers[1].remedy, /"index": 1/);
});

test("gallery items keep their source ORDER and their supplied alt", () => {
  const out = mapped(
    row({ galleryImages: ["https://example.test/a.jpg", "https://example.test/b.jpg"] }),
    manifest({
      galleryAlt: [
        // Declared out of order on purpose: the SOURCE array decides the
        // display order, not the manifest's line order.
        { sourceSlug: "news-1", index: 1, alt: "Second picture." },
        { sourceSlug: "news-1", index: 0, alt: "First picture." },
      ],
    }),
  );
  assert.deepEqual(out.translation.gallery.items, [
    { url: "https://example.test/a.jpg", alt: "First picture." },
    { url: "https://example.test/b.jpg", alt: "Second picture." },
  ]);
});

// ─── Fail-closed: authors and topics ─────────────────────────────────────────

test("an undecided byline blocks, and the remedy explains the name+role keying", () => {
  const found = blockers(row({ authorName: "Victoria Vance", authorRole: "Principal Dancer" }));
  const blocker = found.find((b) => b.code === "author_unresolved");
  assert.ok(blocker, "an unmapped byline must block");
  assert.match(blocker!.remedy, /keyed by name AND role together/);
});

test("an undecided tag blocks; a skipped tag does not, and is reported", () => {
  const found = blockers(row({ tags: ["YAGP", "Gala"] }));
  assert.ok(found.some((b) => b.code === "topic_unresolved" && /Gala/.test(b.message)));

  const out = mapped(
    row({ tags: ["YAGP", "Gala"] }),
    manifest({ topics: [{ sourceTag: "YAGP", editorialTopicId: 21 }, { sourceTag: "Gala", skip: true }] }),
  );
  assert.deepEqual(out.topicIds, [21]);
  assert.ok(out.notes.some((n) => n.code === "topic_skipped"));
});

test("two tags mapping to one topic produce one assignment, not a duplicate", () => {
  const out = mapped(
    row({ tags: ["YAGP", "Competitions"] }),
    manifest({
      topics: [
        { sourceTag: "YAGP", editorialTopicId: 21 },
        { sourceTag: "Competitions", editorialTopicId: 21 },
      ],
    }),
  );
  assert.deepEqual(out.topicIds, [21]);
});

// ─── Featured → placement ────────────────────────────────────────────────────

test("is_featured with no declared placement slot blocks", () => {
  const found = blockers(row({ isFeatured: true }), manifest(), null);
  assert.ok(found.some((b) => b.code === "featured_placement_undeclared"));
});

test("is_featured with a declared slot records the slot; an unfeatured row records none", () => {
  const featured = mapped(row({ isFeatured: true }), manifest(), "news-featured");
  assert.equal(featured.featuredPlacementKey, "news-featured");
  const plain = mapped(row({ isFeatured: false }), manifest(), "news-featured");
  assert.equal(plain.featuredPlacementKey, null);
});

// ─── CROSS-TYPE PRESERVATION — the invariant that matters most ───────────────

test("a news→performance reference NEVER becomes a recommendation", () => {
  const out = mapped(
    row({
      relatedRefs: [
        { type: "news", slug: "news-6" },
        { type: "performance", slug: "nutcracker-repertoire" },
        { type: "news", slug: "news-3" },
      ],
    }),
  );
  // Only the two news refs are candidates for editorial_post_relations.
  assert.deepEqual(out.newsRecommendations, [
    { targetSlug: "news-6", position: 0 },
    { targetSlug: "news-3", position: 2 },
  ]);
  // The performance ref is preserved in a separate manifest, with its
  // original position, and is not present anywhere in the recommendations.
  assert.deepEqual(out.crossTypeReferences, [
    { sourceSlug: "news-1", targetType: "performance", targetSlug: "nutcracker-repertoire", position: 1 },
  ]);
  assert.equal(
    out.newsRecommendations.some((rec) => rec.targetSlug === "nutcracker-repertoire"),
    false,
  );
});

test("a row whose refs are ALL performances yields no recommendations at all", () => {
  const out = mapped(
    row({
      relatedRefs: [
        { type: "performance", slug: "spring-showcase" },
        { type: "performance", slug: "yagp-2027" },
      ],
    }),
  );
  assert.deepEqual(out.newsRecommendations, []);
  assert.equal(out.crossTypeReferences.length, 2);
});

// ─── Status and dates ────────────────────────────────────────────────────────

test("an active row publishes; an inactive row publishes THEN archives", () => {
  // is_active = false is content that WAS public and has since been
  // hidden. Landing it as a draft would erase that it was ever published
  // and would discard its publication date on the way.
  assert.equal(mapped(row({ isActive: true })).lifecycle, "published");
  assert.equal(mapped(row({ isActive: false })).lifecycle, "published-then-archived");
  assert.equal(mapped(row({ isActive: false })).publishedAt, "2026-07-18T00:00:00.000Z");
});

// ─── Slugs ───────────────────────────────────────────────────────────────────

test("a manifest slug override replaces the legacy slug and is reported", () => {
  const out = mapped(row(), manifest({ slugOverrides: [{ sourceSlug: "news-1", slug: "yagp-triumph-2026" }] }));
  assert.equal(out.translation.slug, "yagp-triumph-2026");
  assert.ok(out.notes.some((n) => n.code === "slug_overridden"));
});

// ─── Multiple blockers are reported together ─────────────────────────────────

test("every blocker on a row is reported at once, not one run at a time", () => {
  const found = blockers(
    row({
      authorName: "Nobody",
      authorRole: "Nothing",
      tags: ["Unmapped"],
      galleryImages: ["https://example.test/a.jpg"],
    }),
    manifest({ featureImageAlt: [] }),
  );
  const codes = new Set(found.map((b) => b.code));
  assert.ok(codes.has("author_unresolved"));
  assert.ok(codes.has("topic_unresolved"));
  assert.ok(codes.has("feature_image_alt_missing"));
  assert.ok(codes.has("gallery_alt_missing"));
});
