/**
 * Planner decision-rule tests — Final Editorial, Phase B.
 *
 * The planner's two pure decision rules get their own tests because both
 * are ways the migration could quietly do the wrong thing:
 *
 *   * SLUG COLLISION classification decides whether a public URL already
 *     in use belongs to this legacy row, to a person, or to something
 *     unexplained. Getting it wrong means either refusing a legitimate
 *     migration or overwriting somebody's article's address.
 *   * DRIFT detection decides whether an already-migrated post is
 *     untouched. Getting it wrong means either reverting an editor's work
 *     or reporting a clean database as broken.
 *
 * End-to-end behaviour against a real database is covered by
 * newsMigration.integration.test.ts.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * These are PURE-LOGIC tests and open no connection — but importing the
 * planner pulls in @workspace/db, which refuses to load without a
 * DATABASE_URL. The same disposable-localhost default every backend test
 * in this repo uses is applied here, and asserted to be local, so running
 * the suite can never point at anything real even by accident.
 */
const DATABASE_URL =
  process.env.NEWS_MIGRATION_TEST_DATABASE_URL ??
  `postgresql://${process.env.USER ?? "postgres"}@127.0.0.1:5432/central_studio_disposable_news_migration`;
assertDisposableUrl(DATABASE_URL);
process.env.DATABASE_URL = DATABASE_URL;

function assertDisposableUrl(databaseUrl: string): void {
  const url = new URL(databaseUrl);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error(`Refusing: DATABASE_URL host "${url.hostname}" is not localhost/127.0.0.1`);
  }
  if (!/disposable|local|test/i.test(url.pathname)) {
    throw new Error(`Refusing: database name "${url.pathname}" does not look disposable/local/test`);
  }
  if (/rlwy\.net|railway/i.test(databaseUrl)) {
    throw new Error("Refusing: DATABASE_URL looks like Railway");
  }
}

type EditorialPost = import("@workspace/db").EditorialPost;
type EditorialPostTranslation = import("@workspace/db").EditorialPostTranslation;
type MappedPost = import("./newsMigrationMapping").MappedPost;
type ExistingTranslation = import("./newsMigrationPlanner").ExistingTranslation;

const { describeDrift, describeSlugCollision } = await import("./newsMigrationPlanner");

function post(overrides: Partial<EditorialPost> = {}): EditorialPost {
  return {
    id: 100,
    channel: "news",
    authorId: 11,
    featureImageUrl: "https://example.test/hero.jpg",
    migrationSourceTable: null,
    migrationSourceId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    updatedByAdminId: null,
    ...overrides,
  } as EditorialPost;
}

function translation(overrides: Partial<EditorialPostTranslation> = {}): EditorialPostTranslation {
  return {
    id: 200,
    postId: 100,
    languageId: 1,
    channel: "news",
    title: "A triumph at YAGP",
    slug: "news-1",
    deck: "Four soloists, four offers.",
    contextLabel: "Awards & Recognition",
    featureImageAlt: "Dancers on a lit stage mid-leap.",
    listingImageUrl: "https://example.test/listing.jpg",
    body: { blocks: [{ type: "paragraph", text: "Lead." }] },
    gallery: { items: [{ url: "https://example.test/a.jpg", alt: "First." }] },
    bodyVersion: 1,
    status: "published",
    publishedAt: "2026-07-18T00:00:00.000Z",
    readingTimeOverrideMinutes: 4,
    seoTitle: null,
    seoDescription: null,
    ogImageUrl: null,
    authorSnapshot: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    updatedByAdminId: null,
    ...overrides,
  } as EditorialPostTranslation;
}

function mapping(overrides: Partial<MappedPost> = {}): MappedPost {
  return {
    sourceId: 1,
    sourceSlug: "news-1",
    featureImageUrl: "https://example.test/hero.jpg",
    authorId: 11,
    topicIds: [21],
    publishedAt: "2026-07-18T00:00:00.000Z",
    lifecycle: "published",
    newsRecommendations: [],
    crossTypeReferences: [],
    featuredPlacementKey: null,
    notes: [],
    translation: {
      slug: "news-1",
      title: "A triumph at YAGP",
      deck: "Four soloists, four offers.",
      contextLabel: "Awards & Recognition",
      featureImageAlt: "Dancers on a lit stage mid-leap.",
      listingImageUrl: "https://example.test/listing.jpg",
      body: { blocks: [{ type: "paragraph", text: "Lead." }] },
      gallery: { items: [{ url: "https://example.test/a.jpg", alt: "First." }] },
      readingTimeOverrideMinutes: 4,
      seoTitle: null,
      seoDescription: null,
      ogImageUrl: null,
    },
    ...overrides,
  };
}

const existing = (p = post(), t = translation()): ExistingTranslation => ({ post: p, translation: t });

// ─── Slug collisions ─────────────────────────────────────────────────────────

test("a collision with a HAND-AUTHORED post is UNRELATED and blocks", () => {
  const blocker = describeSlugCollision("news-1", { id: 1, slug: "news-1" }, existing());
  assert.equal(blocker.code, "slug_collision_unrelated");
  assert.match(blocker.message, /authored in Admin, not migrated/);
});

test("a collision with a post migrated from a DIFFERENT source row is AMBIGUOUS", () => {
  const blocker = describeSlugCollision(
    "news-1",
    { id: 1, slug: "news-1" },
    existing(post({ migrationSourceTable: "website_news_posts", migrationSourceId: 99 })),
  );
  assert.equal(blocker.code, "slug_collision_ambiguous");
  assert.match(blocker.message, /row #99, which is not this row \(#1\)/);
});

test("a collision with a post migrated from ANOTHER TABLE is AMBIGUOUS", () => {
  const blocker = describeSlugCollision(
    "news-1",
    { id: 1, slug: "news-1" },
    existing(post({ migrationSourceTable: "some_other_table", migrationSourceId: 5 })),
  );
  assert.equal(blocker.code, "slug_collision_ambiguous");
  assert.match(blocker.message, /DIFFERENT source table/);
});

test("no collision is ever resolved by auto-suffixing the slug", () => {
  // Editorial DOES auto-suffix GENERATED slugs and deliberately refuses to
  // for MANUAL ones. A migrated slug is a manual slug in every sense that
  // matters: it is an existing public URL being carried across.
  for (const p of [
    post(),
    post({ migrationSourceTable: "website_news_posts", migrationSourceId: 99 }),
  ]) {
    const blocker = describeSlugCollision("news-1", { id: 1, slug: "news-1" }, existing(p));
    assert.match(blocker.remedy, /never auto-suffixes/);
    assert.match(blocker.remedy, /slugOverrides/);
  }
});

// ─── Drift ───────────────────────────────────────────────────────────────────

test("an untouched migrated post reports no drift — this is what makes a re-run a no-op", () => {
  assert.deepEqual(describeDrift(existing(), mapping(), [21]), []);
});

test("a publication date expressed differently but equal as an INSTANT is not drift", () => {
  // Postgres renders a timestamptz in its own canonical form, which is not
  // byte-identical to the legacy column's rendering. Comparing strings
  // would report every single migrated post as drifted.
  const drift = describeDrift(
    existing(post(), translation({ publishedAt: "2026-07-18 00:00:00+00" })),
    mapping(),
    [21],
  );
  assert.deepEqual(drift, []);
});

test("each edited field is named individually, so an operator knows WHAT changed", () => {
  const drift = describeDrift(
    existing(post(), translation({ title: "Edited by hand", deck: "Also edited" })),
    mapping(),
    [21],
  );
  assert.deepEqual(drift, ["title differs", "deck differs"]);
});

test("a GALLERY REORDER is drift — the array order is the display order", () => {
  const drift = describeDrift(
    existing(
      post(),
      translation({
        gallery: {
          items: [
            { url: "https://example.test/b.jpg", alt: "Second." },
            { url: "https://example.test/a.jpg", alt: "First." },
          ],
        },
      }),
    ),
    mapping({
      translation: {
        ...mapping().translation,
        gallery: {
          items: [
            { url: "https://example.test/a.jpg", alt: "First." },
            { url: "https://example.test/b.jpg", alt: "Second." },
          ],
        },
      },
    }),
    [21],
  );
  assert.deepEqual(drift, ["gallery differs"]);
});

test("an ALT-TEXT-ONLY gallery edit is drift", () => {
  const drift = describeDrift(
    existing(
      post(),
      translation({ gallery: { items: [{ url: "https://example.test/a.jpg", alt: "Rewritten alt." }] } }),
    ),
    mapping(),
    [21],
  );
  assert.deepEqual(drift, ["gallery differs"]);
});

test("a topic added or removed by hand is drift, regardless of order", () => {
  assert.deepEqual(describeDrift(existing(), mapping(), [21, 22]), ["topics differs"]);
  // Order alone is NOT drift: editorial_post_topics is a set, not a list.
  assert.deepEqual(
    describeDrift(existing(), mapping({ topicIds: [22, 21] }), [21, 22]),
    [],
  );
});

test("a state that no longer matches the legacy row's is_active is drift", () => {
  const drift = describeDrift(
    existing(post(), translation({ status: "archived" })),
    mapping({ lifecycle: "published" }),
    [21],
  );
  assert.deepEqual(drift, ['state is "archived" but the legacy row implies "published"']);
});

test("a shared-spine edit (author or feature image) is drift too", () => {
  assert.deepEqual(describeDrift(existing(post({ authorId: 12 })), mapping(), [21]), ["author differs"]);
  assert.deepEqual(
    describeDrift(existing(post({ featureImageUrl: "https://example.test/new.jpg" })), mapping(), [21]),
    ["feature image differs"],
  );
});
