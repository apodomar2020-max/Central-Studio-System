/**
 * Manifest validation tests — Final Editorial, Phase B.
 *
 * The manifest is the fail-closed boundary of the whole migration, so what
 * is tested here is mostly REFUSAL: the cases where a plausible-looking
 * file must be rejected rather than partially honoured.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NEWS_MIGRATION_MANIFEST_VERSION,
  ManifestError,
  authorKey,
  parseNewsMigrationManifest,
  resolveAuthorDecision,
  resolveTopicDecision,
} from "./newsMigrationManifest";

const base = {
  manifestVersion: NEWS_MIGRATION_MANIFEST_VERSION,
  sourceTable: "website_news_posts",
  targetChannel: "news",
  languageCode: "en",
  authors: [{ sourceName: "Victoria Vance", sourceRole: "Artistic Director", editorialAuthorId: 1 }],
  topics: [{ sourceTag: "YAGP", editorialTopicId: 7 }],
};

test("accepts a minimal valid manifest", () => {
  const manifest = parseNewsMigrationManifest(base);
  assert.equal(manifest.languageCode, "en");
  assert.equal(manifest.authors.length, 1);
});

test("rejects an unknown key rather than treating it as an absent decision", () => {
  // A misspelled key must not silently degrade into "no decision was made
  // about this", which would surface much later as a blocker nobody can
  // explain. Strict objects turn a typo into an immediate, cheap failure.
  assert.throws(
    () => parseNewsMigrationManifest({ ...base, authorz: [] }),
    (err: unknown) => err instanceof ManifestError,
  );
});

test("rejects an author entry whose id key is misspelled", () => {
  assert.throws(
    () =>
      parseNewsMigrationManifest({
        ...base,
        authors: [{ sourceName: "A", sourceRole: "B", editorialAuthorID: 1 }],
      }),
    (err: unknown) => err instanceof ManifestError,
  );
});

test("pins the source table, so a manifest cannot be aimed at another table", () => {
  assert.throws(
    () => parseNewsMigrationManifest({ ...base, sourceTable: "website_performances" }),
    (err: unknown) => err instanceof ManifestError,
  );
});

test("pins the target channel, so the channel invariant is not configurable", () => {
  assert.throws(
    () => parseNewsMigrationManifest({ ...base, targetChannel: "experience" }),
    (err: unknown) => err instanceof ManifestError,
  );
});

test("a duplicate author decision is an error, never last-one-wins", () => {
  // Two answers to one question means two people disagreed, or one person
  // changed their mind and left both. Honouring whichever sorts last would
  // pick a real person's byline by file order.
  assert.throws(
    () =>
      parseNewsMigrationManifest({
        ...base,
        authors: [
          { sourceName: "Victoria Vance", sourceRole: "Artistic Director", editorialAuthorId: 1 },
          { sourceName: "Victoria Vance", sourceRole: "Artistic Director", editorialAuthorId: 2 },
        ],
      }),
    (err: unknown) => err instanceof ManifestError && /Duplicate author decision/.test(err.message),
  );
});

test("the SAME NAME under a DIFFERENT ROLE is two separate decisions", () => {
  // This is the Victoria Vance case: she is the byline on news-1 as
  // "Artistic Director & Master Teacher" and on news-6 as "Artistic
  // Director". Keying by name alone would collapse them and silently
  // attribute both sets of articles to one author row.
  const manifest = parseNewsMigrationManifest({
    ...base,
    authors: [
      { sourceName: "Victoria Vance", sourceRole: "Artistic Director", editorialAuthorId: 1 },
      { sourceName: "Victoria Vance", sourceRole: "Artistic Director & Master Teacher", editorialAuthorId: 2 },
    ],
  });
  assert.equal(resolveAuthorDecision(manifest, "Victoria Vance", "Artistic Director")?.editorialAuthorId, 1);
  assert.equal(
    resolveAuthorDecision(manifest, "Victoria Vance", "Artistic Director & Master Teacher")?.editorialAuthorId,
    2,
  );
});

test("a byline the manifest has not decided about resolves to nothing, never to a near match", () => {
  const manifest = parseNewsMigrationManifest(base);
  // Same person, role not declared: NOT resolved. No fuzzy fallback.
  assert.equal(resolveAuthorDecision(manifest, "Victoria Vance", "Principal Dancer"), null);
  // Case difference in a NAME is not folded — a name is a person.
  assert.equal(resolveAuthorDecision(manifest, "victoria vance", "Artistic Director"), null);
});

test("author keys are exact after trimming only", () => {
  assert.equal(authorKey("  A  ", " B "), authorKey("A", "B"));
  assert.notEqual(authorKey("a", "B"), authorKey("A", "B"));
});

test("a topic entry must map OR skip, never both and never neither", () => {
  assert.throws(
    () => parseNewsMigrationManifest({ ...base, topics: [{ sourceTag: "X" }] }),
    (err: unknown) => err instanceof ManifestError,
  );
  assert.throws(
    () => parseNewsMigrationManifest({ ...base, topics: [{ sourceTag: "X", editorialTopicId: 1, skip: true }] }),
    (err: unknown) => err instanceof ManifestError,
  );
});

test("skip is a recorded DECISION, distinct from an absent one", () => {
  const manifest = parseNewsMigrationManifest({
    ...base,
    topics: [{ sourceTag: "Gala", skip: true }],
  });
  assert.deepEqual(resolveTopicDecision(manifest, "Gala"), { kind: "skipped" });
  assert.deepEqual(resolveTopicDecision(manifest, "Backstage"), { kind: "unresolved" });
});

test("tags are matched case-insensitively — a tag is a label, not a person", () => {
  const manifest = parseNewsMigrationManifest({
    ...base,
    topics: [{ sourceTag: "Backstage", editorialTopicId: 3 }],
  });
  assert.deepEqual(resolveTopicDecision(manifest, "backstage"), { kind: "mapped", topicId: 3 });
  assert.deepEqual(resolveTopicDecision(manifest, "  BACKSTAGE "), { kind: "mapped", topicId: 3 });
});

test("two slug overrides may not target the same slug", () => {
  // A slug is a public URL and a URL identifies one article. Caught here
  // rather than left to surface mid-run as a database constraint error.
  assert.throws(
    () =>
      parseNewsMigrationManifest({
        ...base,
        slugOverrides: [
          { sourceSlug: "news-1", slug: "same-slug" },
          { sourceSlug: "news-2", slug: "same-slug" },
        ],
      }),
    (err: unknown) => err instanceof ManifestError && /both target the slug/.test(err.message),
  );
});

test("a slug override must be a canonical slug", () => {
  assert.throws(
    () => parseNewsMigrationManifest({ ...base, slugOverrides: [{ sourceSlug: "news-1", slug: "Not A Slug" }] }),
    (err: unknown) => err instanceof ManifestError,
  );
});

test("duplicate gallery alt decisions for one image are an error", () => {
  assert.throws(
    () =>
      parseNewsMigrationManifest({
        ...base,
        galleryAlt: [
          { sourceSlug: "news-1", index: 0, alt: "one" },
          { sourceSlug: "news-1", index: 0, alt: "two" },
        ],
      }),
    (err: unknown) => err instanceof ManifestError && /Duplicate gallery alt/.test(err.message),
  );
});

test("alt text may not be blank — a present-but-empty decision is not a decision", () => {
  assert.throws(
    () =>
      parseNewsMigrationManifest({
        ...base,
        galleryAlt: [{ sourceSlug: "news-1", index: 0, alt: "   " }],
      }),
    (err: unknown) => err instanceof ManifestError,
  );
});
