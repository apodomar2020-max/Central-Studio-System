/**
 * Wave 2.1E — Recommended reading: labels, candidate scoping, ordering, the
 * dirty comparison and the PUT payload.
 *
 * Executed for real. Where a rule belongs to the server, it is pinned against
 * the server's own source rather than restated from memory — the label
 * preference order, the `position ?? index` rule, the cap, the four
 * validations and the directionality of the write.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CANDIDATE_PAGE_SIZE,
  RECOMMENDATIONS_CAP_MESSAGE,
  RECOMMENDATIONS_CARD_TITLE,
  RECOMMENDATIONS_DIRECTION_EXPLANATION,
  RECOMMENDATIONS_MAX,
  RECOMMENDATIONS_PUBLISHED_FILTER_NOTE,
  UNTITLED_POST_LABEL,
  addRecommendation,
  areRecommendationsDirty,
  canAddRecommendation,
  candidateCountLabel,
  filterCandidates,
  moveRecommendationDown,
  moveRecommendationUp,
  pickTargetLabel,
  recommendationLabel,
  recommendationLanguageTag,
  removeRecommendation,
  targetStateAnnotation,
  toCandidateQuery,
  toRecommendationIds,
  toRecommendationsPayload,
} from "./editorial-recommendations.ts";
import { moveBlockDown, moveBlockUp, type EditableBlock } from "./editorial-post-body.ts";

const service = readFileSync(
  new URL("../../../api-server/src/lib/editorialPostsService.ts", import.meta.url),
  "utf8",
);
const route = readFileSync(
  new URL("../../../api-server/src/routes/adminEditorial.ts", import.meta.url),
  "utf8",
);
const generated = readFileSync(
  new URL("../../../../lib/api-client-react/src/generated/api.schemas.ts", import.meta.url),
  "utf8",
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function entry(overrides: Record<string, unknown> = {}): any {
  return {
    targetPostId: 9,
    position: 0,
    targetTitle: "Opening Night",
    targetSlug: "opening-night",
    targetLanguageCode: "en",
    ...overrides,
  };
}

const LANGUAGES = [
  { code: "ar", isDefault: false, displayOrder: 1 },
  { code: "en", isDefault: true, displayOrder: 5 },
  { code: "fr", isDefault: false, displayOrder: 0 },
];

// ─── Domain naming and directionality (§16, §23) ─────────────────────────────

test("the card is named Recommended reading and states the one-way rule", () => {
  assert.equal(RECOMMENDATIONS_CARD_TITLE, "Recommended reading");
  assert.doesNotMatch(RECOMMENDATIONS_CARD_TITLE, /related/i);
  assert.match(RECOMMENDATIONS_DIRECTION_EXPLANATION, /from this post/);
  assert.match(RECOMMENDATIONS_DIRECTION_EXPLANATION, /does not add this post to its list/);
});

test("directionality is real: the write touches only rows this post is the SOURCE of", () => {
  const replace = service.slice(service.indexOf("async function replacePostRecommendations"));
  assert.match(replace, /sourcePostId/);
  assert.ok(
    !/eq\(editorialPostRelationsTable\.targetPostId, /.test(replace.slice(0, replace.indexOf("insert"))),
    "inbound relations from other posts must never be deleted",
  );
});

test("no cycle detection is invented — the backend has none and cycles are legal", () => {
  const code = readFileSync(new URL("./editorial-recommendations.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /cycle|circular/i);
});

// ─── Labels (§20) ────────────────────────────────────────────────────────────

test("pickTargetLabel reproduces the server's is_default DESC, display_order ASC preference", () => {
  // The server's own ordering, pinned.
  assert.match(
    route,
    /\.orderBy\(desc\(editorialLanguagesTable\.isDefault\), asc\(editorialLanguagesTable\.displayOrder\)\)/,
  );
  const label = pickTargetLabel(9, [
    { languageCode: "fr", title: "Soirée", status: "published" },
    { languageCode: "en", title: "Opening Night", status: "published" },
    { languageCode: "ar", title: "ليلة الافتتاح", status: "published" },
  ], LANGUAGES);
  assert.equal(label, "Opening Night", "the DEFAULT language wins even with a higher display order");
});

test("pickTargetLabel falls back to display order, then to any translation, then to Post #id", () => {
  assert.equal(
    pickTargetLabel(9, [
      { languageCode: "ar", title: "Arabic", status: "draft" },
      { languageCode: "fr", title: "French", status: "draft" },
    ], LANGUAGES),
    "French",
    "with no default-language translation, the lowest display order wins",
  );
  assert.equal(
    pickTargetLabel(9, [{ languageCode: "zz", title: "Unknown language", status: "draft" }], LANGUAGES),
    "Unknown language",
    "a language missing from the reference list is still rendered, never dropped",
  );
  assert.equal(pickTargetLabel(9, [], LANGUAGES), "Post #9");
  assert.equal(
    pickTargetLabel(9, [{ languageCode: "en", title: "   ", status: "draft" }], LANGUAGES),
    UNTITLED_POST_LABEL,
    "a blank title is never rendered as an empty chip",
  );
});

test("a saved entry renders the SERVER's label verbatim rather than re-deriving it", () => {
  assert.equal(recommendationLabel(entry()), "Opening Night");
  assert.equal(recommendationLabel(entry({ targetTitle: "  " })), UNTITLED_POST_LABEL);
  assert.equal(
    recommendationLabel(entry({ targetTitle: "Post #12 (no translation yet)" })),
    "Post #12 (no translation yet)",
    "the server's own no-translation form passes through untouched",
  );
});

test("a language tag appears only when the label is NOT in the language being edited", () => {
  assert.equal(recommendationLanguageTag(entry({ targetLanguageCode: "en" }), "en"), null);
  assert.equal(recommendationLanguageTag(entry({ targetLanguageCode: "en" }), "ar"), "en");
  assert.equal(recommendationLanguageTag(entry({ targetLanguageCode: null }), "ar"), null);
});

// ─── Eligible states (D6, §21) ───────────────────────────────────────────────

test("an existing target with no published translation is annotated, never hidden", () => {
  assert.equal(targetStateAnnotation([{ languageCode: "en", title: "x", status: "published" }]), null);
  assert.equal(targetStateAnnotation([{ languageCode: "en", title: "x", status: "draft" }]), "not published");
  assert.equal(targetStateAnnotation([{ languageCode: "en", title: "x", status: "archived" }]), "archived");
  assert.equal(targetStateAnnotation([]), "no translation yet");
  assert.equal(targetStateAnnotation(undefined), null, "unknown state is not asserted as a problem");
  assert.equal(
    targetStateAnnotation([
      { languageCode: "en", title: "x", status: "archived" },
      { languageCode: "ar", title: "y", status: "published" },
    ]),
    null,
    "one published language is enough for the recommendation to be reader-facing",
  );
});

test("the Published default is described as a suggestion, NOT as a backend rule", () => {
  assert.match(RECOMMENDATIONS_PUBLISHED_FILTER_NOTE, /not a rule/);
  // And it genuinely is not: assertRecommendationsValid reads only id and channel.
  const assertion = service.slice(
    service.indexOf("async function assertRecommendationsValid"),
    service.indexOf("async function replacePostRecommendations"),
  );
  assert.doesNotMatch(assertion, /status/);
});

// ─── Candidate query (§19) ───────────────────────────────────────────────────

test("the candidate query ALWAYS scopes to the post's channel", () => {
  const query = toCandidateQuery({ channel: "news", search: "", publishedOnly: true });
  assert.equal(query.channel, "news");
  assert.equal(query.limit, CANDIDATE_PAGE_SIZE);
  assert.equal(query.page, 1);
  assert.equal(query.translationStatus, "published");
});

test("an empty search is an ABSENT key, never an empty string", () => {
  const blank = toCandidateQuery({ channel: "news", search: "   ", publishedOnly: false });
  assert.ok(!("search" in blank), "an empty value would be treated as a real filter by the route's schema");
  assert.ok(!("translationStatus" in blank), "the Any toggle drops the filter entirely");
  const typed = toCandidateQuery({ channel: "experience", search: "  night  ", publishedOnly: false });
  assert.equal(typed.search, "night");
});

test("the only client-side exclusions are self and already-selected — never a pretend search", () => {
  const rows = [{ post: { id: 7 } }, { post: { id: 9 } }, { post: { id: 11 } }];
  const filtered = filterCandidates(rows, { sourcePostId: 7, selected: [9] });
  assert.deepEqual(filtered.map((row) => row.post.id), [11]);
  // A post cannot recommend itself — the server rejects it AND a DB CHECK does.
  assert.match(service, /A post cannot recommend itself\./);
  assert.match(service, /The same recommended post was listed more than once\./);
});

test("the result count is announced honestly when the server has more than one page", () => {
  assert.equal(candidateCountLabel(0, 0), "No posts match.");
  assert.equal(candidateCountLabel(1, 1), "1 post matches.");
  assert.equal(candidateCountLabel(7, 7), "7 posts match.");
  assert.match(candidateCountLabel(10, 42), /10 of 42 matching posts shown/);
});

// ─── Ordering (§22) ──────────────────────────────────────────────────────────

test("move up and move down mirror moveBlockUp/moveBlockDown exactly", () => {
  const ids = [1, 2, 3];
  assert.deepEqual(moveRecommendationUp(ids, 2), [1, 3, 2]);
  assert.deepEqual(moveRecommendationDown(ids, 0), [2, 1, 3]);
  // No-ops at the ends, and never a mutation of the input.
  assert.deepEqual(moveRecommendationUp(ids, 0), [1, 2, 3]);
  assert.deepEqual(moveRecommendationDown(ids, 2), [1, 2, 3]);
  assert.deepEqual(ids, [1, 2, 3], "the input array is never mutated");

  // Same semantics as the body editor's helpers, asserted against them.
  const blocks = [1, 2, 3].map((n) => ({ key: `k${n}`, type: "paragraph", text: String(n) })) as EditableBlock[];
  assert.deepEqual(
    moveBlockUp(blocks, 2).map((block) => (block as { text: string }).text),
    moveRecommendationUp(ids, 2).map(String),
  );
  assert.deepEqual(
    moveBlockDown(blocks, 0).map((block) => (block as { text: string }).text),
    moveRecommendationDown(ids, 0).map(String),
  );
});

test("add is idempotent, respects the cap, and remove is exact", () => {
  assert.deepEqual(addRecommendation([1, 2], 3), [1, 2, 3]);
  assert.deepEqual(addRecommendation([1, 2], 2), [1, 2], "a duplicate is never appended");
  assert.deepEqual(removeRecommendation([1, 2, 3], 2), [1, 3]);
  assert.deepEqual(removeRecommendation([1, 2, 3], 99), [1, 2, 3]);
});

// ─── Cap (§18) ───────────────────────────────────────────────────────────────

test("the cap is the contract's own 20, and the message names the real number", () => {
  assert.equal(RECOMMENDATIONS_MAX, 20);
  // Pinned against the generated body schema's @maxItems.
  const body = generated.slice(generated.indexOf("export interface ReplaceEditorialPostRecommendationsBody"));
  assert.match(body.slice(0, 200), /@maxItems 20/);

  const full = Array.from({ length: 20 }, (_, index) => index + 1);
  assert.equal(canAddRecommendation(full.slice(0, 19)), true);
  assert.equal(canAddRecommendation(full), false);
  assert.deepEqual(addRecommendation(full, 99), full, "the cap is enforced by construction, not only by message");
  assert.match(RECOMMENDATIONS_CAP_MESSAGE, /20/);
  assert.match(RECOMMENDATIONS_CAP_MESSAGE, /Remove one before adding another/);
});

// ─── Dirty comparison + payload (§26) ────────────────────────────────────────

test("the dirty comparison is ORDER-SENSITIVE — a reorder is a real change", () => {
  assert.equal(areRecommendationsDirty([1, 2, 3], [1, 2, 3]), false);
  assert.equal(areRecommendationsDirty([1, 3, 2], [1, 2, 3]), true, "a reorder must not be silently discarded");
  assert.equal(areRecommendationsDirty([1, 2], [1, 2, 3]), true);
  assert.equal(areRecommendationsDirty([1, 2, 3], [1, 2]), true);
  assert.equal(areRecommendationsDirty([], []), false);
});

test("the payload sends items IN ARRAY ORDER and deliberately omits position", () => {
  const payload = toRecommendationsPayload([5, 9]);
  assert.deepEqual(payload, { items: [{ targetPostId: 5 }, { targetPostId: 9 }] });
  for (const item of payload.items) {
    assert.ok(!("position" in item), "the server assigns position from the array index");
  }
  assert.deepEqual(toRecommendationsPayload([]), { items: [] }, "clearing every recommendation is legal");
  // The server's rule, pinned: omitting position means the index is used.
  assert.match(service, /position: item\.position \?\? index/);
});

test("the baseline is derived from the post detail's own recommendations, in its order", () => {
  const ids = toRecommendationIds([entry({ targetPostId: 5 }), entry({ targetPostId: 9 })]);
  assert.deepEqual(ids, [5, 9]);
  assert.equal(areRecommendationsDirty(ids, [5, 9]), false);
});
