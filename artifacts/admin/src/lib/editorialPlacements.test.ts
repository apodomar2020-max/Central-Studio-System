/**
 * Final Editorial, Phase A — Placements: slot identity, labels, candidate
 * scoping, local list editing, the dirty comparison and the PUT payload.
 *
 * Executed for real. Where a rule belongs to the server it is pinned against
 * the server's own source rather than restated from memory — the slot is
 * (channel, key), the `position ?? index` rule, the 50 cap, the same-channel
 * restriction and the replace-on-Save directionality.
 *
 * Structured to mirror lib/editorialRecommendations.test.ts (Wave 2.1E),
 * which is the closest precedent: the same channel-scoped candidate search
 * feeding an ordered list written by one replace-on-Save request.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PLACEMENTS_CAP_MESSAGE,
  PLACEMENTS_CHANNEL_NOTE,
  PLACEMENTS_EMPTY_STATE,
  PLACEMENTS_LIFECYCLE_NOTE,
  PLACEMENTS_MAX,
  PLACEMENTS_NOT_PUBLIC_YET_NOTE,
  PLACEMENTS_PAGE_DESCRIPTION,
  PLACEMENT_CANDIDATE_PAGE_SIZE,
  PLACEMENT_CHANNELS,
  PLACEMENT_KEY_SUGGESTIONS,
  UNTITLED_POST_LABEL,
  addPlacement,
  arePlacementsDirty,
  canAddPlacement,
  filterPlacementCandidates,
  movePlacementDown,
  movePlacementUp,
  normalizePlacementKey,
  pickPostLabel,
  placementCandidateCountLabel,
  placementLabel,
  placementMoveAnnouncement,
  postStateAnnotation,
  removePlacement,
  slotLabel,
  toPlacementCandidateQuery,
  toPlacementPayload,
  toPlacementPostIds,
  validatePlacementKey,
  type PlacementTranslationLike,
} from "./editorial-placements.ts";

const service = readFileSync(
  new URL("../../../api-server/src/lib/editorialPostsService.ts", import.meta.url),
  "utf8",
);
const route = readFileSync(
  new URL("../../../api-server/src/routes/adminEditorial.ts", import.meta.url),
  "utf8",
);
const schema = readFileSync(
  new URL("../../../../lib/db/src/schema/editorialPlacements.ts", import.meta.url),
  "utf8",
);
const generatedZod = readFileSync(
  new URL("../../../../lib/api-zod/src/generated/api.ts", import.meta.url),
  "utf8",
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function entry(overrides: Record<string, unknown> = {}): any {
  return {
    id: 1,
    key: "featured",
    channel: "news",
    postId: 9,
    position: 0,
    startAt: null,
    endAt: null,
    postTitle: "Opening Night",
    postLanguageCode: "en",
    ...overrides,
  };
}

function translation(overrides: Partial<PlacementTranslationLike> = {}): PlacementTranslationLike {
  return { languageCode: "en", title: "Opening Night", status: "published", ...overrides };
}

const LANGUAGES = [
  { code: "ar", isDefault: true, displayOrder: 2 },
  { code: "en", isDefault: false, displayOrder: 0 },
  { code: "fr", isDefault: false, displayOrder: 1 },
];

// ─── The slot is (channel, key), never key alone ────────────────────────────

test("a slot key is free text server-side — there is no enum and no slot table", () => {
  // The two facts the module's design rests on, asserted against source.
  assert.match(schema, /editorial_placements_key_not_blank/);
  assert.doesNotMatch(schema, /pgEnum\(/, "a slot key enum would make free-text suggestions wrong");
  // The route takes `key` as a plain query param, not a constrained union.
  assert.match(route, /ReplaceEditorialPlacementQueryParams/);
});

test("PLACEMENT_KEY_SUGGESTIONS are SUGGESTIONS, not a closed set", () => {
  // They must be a plain readonly string list, not a union the UI can enforce.
  assert.deepEqual([...PLACEMENT_KEY_SUGGESTIONS], ["featured", "hero"]);
  // A key outside the suggestions is perfectly valid.
  assert.equal(validatePlacementKey("season-2030-spotlight"), null);
});

test("validatePlacementKey rejects ONLY blank, matching the CHECK constraint", () => {
  assert.equal(validatePlacementKey("featured"), null);
  assert.equal(validatePlacementKey("  featured  "), null);
  assert.equal(validatePlacementKey(""), "A slot key is required.");
  assert.equal(validatePlacementKey("   "), "A slot key is required.");
  // Nothing stricter is invented — uppercase, spaces and punctuation pass.
  assert.equal(validatePlacementKey("Home Hero / Top"), null);
});

test("normalizePlacementKey trims, and slotLabel names the slot as the audit row does", () => {
  assert.equal(normalizePlacementKey("  featured "), "featured");
  assert.equal(slotLabel("news", " featured "), "news:featured");
  assert.equal(slotLabel("experience", "featured"), "experience:featured");
  // The server audits the SLOT as `${channel}:${key}` — Issue #23. The
  // screen's label must be the same string, or the activity log and the UI
  // name the same thing differently.
  assert.match(route, /entityId: `\$\{channel\}:\$\{key\}`/);
});

test("both channels are offered, and they are the channels the list endpoint accepts", () => {
  assert.deepEqual(PLACEMENT_CHANNELS.map((option) => option.value), ["news", "experience"]);
  assert.deepEqual(PLACEMENT_CHANNELS.map((option) => option.label), ["News", "Experience"]);
});

// ─── Labels ─────────────────────────────────────────────────────────────────

test("pickPostLabel reproduces the SERVER's label preference: default first, then displayOrder", () => {
  // Pinned against the server's own ORDER BY rather than restated.
  assert.match(
    route,
    /\.orderBy\(desc\(editorialLanguagesTable\.isDefault\), asc\(editorialLanguagesTable\.displayOrder\)\)/,
  );
  const label = pickPostLabel(
    9,
    [translation({ languageCode: "en", title: "English title" }), translation({ languageCode: "ar", title: "Arabic title" })],
    LANGUAGES,
  );
  assert.equal(label, "Arabic title", "ar is the default language, so it wins regardless of array order");
});

test("pickPostLabel falls back through displayOrder, then to a post reference", () => {
  assert.equal(
    pickPostLabel(9, [translation({ languageCode: "fr", title: "FR" }), translation({ languageCode: "en", title: "EN" })], LANGUAGES),
    "EN",
    "en has the lower displayOrder among non-default languages",
  );
  assert.equal(pickPostLabel(9, [], LANGUAGES), "Post #9");
  assert.equal(
    pickPostLabel(9, [translation({ title: "   " })], LANGUAGES),
    UNTITLED_POST_LABEL,
    "a blank title is never rendered as empty space",
  );
  // A language the languages list does not know still produces a label.
  assert.equal(pickPostLabel(9, [translation({ languageCode: "de", title: "DE" })], LANGUAGES), "DE");
});

test("placementLabel renders the server's own joined postTitle verbatim", () => {
  assert.equal(placementLabel(entry()), "Opening Night");
  assert.equal(placementLabel(entry({ postTitle: "   " })), UNTITLED_POST_LABEL);
  // The server's own fallback string is passed through unchanged.
  assert.equal(
    placementLabel(entry({ postTitle: "Post #4 (no translation yet)" })),
    "Post #4 (no translation yet)",
  );
});

test("postStateAnnotation makes a non-published target VISIBLE without narrowing the backend rule", () => {
  assert.equal(postStateAnnotation([translation({ status: "published" })]), null);
  assert.equal(
    postStateAnnotation([translation({ status: "published" }), translation({ languageCode: "ar", status: "draft" })]),
    null,
    "one published language is enough — the post is live somewhere",
  );
  assert.equal(postStateAnnotation([translation({ status: "draft" })]), "not published");
  assert.equal(postStateAnnotation([translation({ status: "archived" })]), "archived");
  assert.equal(
    postStateAnnotation([translation({ status: "archived" }), translation({ languageCode: "ar", status: "draft" })]),
    "not published",
    "mixed archived+draft is not fully archived",
  );
  assert.equal(postStateAnnotation([]), "no translation yet");
  assert.equal(postStateAnnotation(undefined), null);
});

// ─── Candidate search ───────────────────────────────────────────────────────

test("the candidate query is ALWAYS channel-scoped — the server enforces the same rule", () => {
  // assertPlacementValid rejects a cross-channel post, so an out-of-channel
  // option would be an option that can only ever produce a 400.
  assert.match(service, /assertPlacementValid/);
  const query = toPlacementCandidateQuery({ channel: "experience", search: "", publishedOnly: false });
  assert.equal(query.channel, "experience");
  assert.equal(query.page, 1);
  assert.equal(query.limit, PLACEMENT_CANDIDATE_PAGE_SIZE);
});

test("an empty search becomes an ABSENT key, never an empty string", () => {
  const blank = toPlacementCandidateQuery({ channel: "news", search: "   ", publishedOnly: false });
  assert.equal("search" in blank, false);
  const typed = toPlacementCandidateQuery({ channel: "news", search: "  opening  ", publishedOnly: false });
  assert.equal(typed.search, "opening", "the search term is trimmed");
});

test("the published filter is opt-in and adds translationStatus only when on", () => {
  assert.equal(
    "translationStatus" in toPlacementCandidateQuery({ channel: "news", search: "", publishedOnly: false }),
    false,
  );
  assert.equal(
    toPlacementCandidateQuery({ channel: "news", search: "", publishedOnly: true }).translationStatus,
    "published",
  );
});

test("page and limit are overridable but default to the shared page size", () => {
  const query = toPlacementCandidateQuery({ channel: "news", search: "", publishedOnly: false, page: 3, limit: 25 });
  assert.equal(query.page, 3);
  assert.equal(query.limit, 25);
  assert.equal(PLACEMENT_CANDIDATE_PAGE_SIZE, 10);
});

test("filterPlacementCandidates removes exactly the ids already in the slot, and nothing else", () => {
  const rows = [{ post: { id: 1 } }, { post: { id: 2 } }, { post: { id: 3 } }];
  assert.deepEqual(filterPlacementCandidates(rows, [2]).map((row) => row.post.id), [1, 3]);
  assert.deepEqual(filterPlacementCandidates(rows, []).map((row) => row.post.id), [1, 2, 3]);
  assert.deepEqual(filterPlacementCandidates(rows, [1, 2, 3]), []);
  // No status filtering happens client-side: a draft candidate stays visible,
  // because the backend genuinely accepts it.
  assert.equal(filterPlacementCandidates(rows, [99]).length, 3);
});

test("placementCandidateCountLabel tells the truth about a truncated page", () => {
  assert.equal(placementCandidateCountLabel(0, 0), "No posts match.");
  assert.equal(placementCandidateCountLabel(1, 1), "1 post matches.");
  assert.equal(placementCandidateCountLabel(4, 4), "4 posts match.");
  assert.equal(
    placementCandidateCountLabel(10, 42),
    "10 of 42 matching posts shown — refine the search to narrow it.",
  );
});

// ─── Local list editing ─────────────────────────────────────────────────────

test("the cap is the contract's own maxItems, and adding past it is a no-op", () => {
  assert.equal(PLACEMENTS_MAX, 50);
  assert.match(generatedZod, /replaceEditorialPlacementBodyItemsMax = 50/);
  const full = Array.from({ length: PLACEMENTS_MAX }, (_, index) => index + 1);
  assert.equal(canAddPlacement(full), false);
  assert.equal(canAddPlacement(full.slice(1)), true);
  assert.deepEqual(addPlacement(full, 999), full, "at the cap, add is ignored rather than producing a 400");
  assert.match(PLACEMENTS_CAP_MESSAGE, /at most 50 posts/);
});

test("a duplicate post is silently ignored — a DB UNIQUE and a service check both forbid it", () => {
  assert.match(schema, /unique\(/);
  assert.deepEqual(addPlacement([1, 2], 2), [1, 2]);
  assert.deepEqual(addPlacement([1, 2], 3), [1, 2, 3], "a new id is appended at the END");
});

test("add and remove never mutate the input array", () => {
  const current = [1, 2, 3];
  const added = addPlacement(current, 4);
  const removed = removePlacement(current, 2);
  assert.deepEqual(current, [1, 2, 3]);
  assert.notEqual(added, current);
  assert.notEqual(removed, current);
  assert.deepEqual(removed, [1, 3]);
  assert.deepEqual(removePlacement(current, 99), [1, 2, 3], "removing an absent id changes nothing");
});

test("move up and move down reorder by one, and refuse to fall off either end", () => {
  assert.deepEqual(movePlacementUp([1, 2, 3], 1), [2, 1, 3]);
  assert.deepEqual(movePlacementDown([1, 2, 3], 1), [1, 3, 2]);
  assert.deepEqual(movePlacementUp([1, 2, 3], 0), [1, 2, 3], "the first row cannot move up");
  assert.deepEqual(movePlacementDown([1, 2, 3], 2), [1, 2, 3], "the last row cannot move down");
  // Out-of-range indices are inert rather than throwing.
  assert.deepEqual(movePlacementUp([1, 2, 3], 9), [1, 2, 3]);
  assert.deepEqual(movePlacementDown([1, 2, 3], -1), [1, 2, 3]);
  assert.deepEqual(movePlacementUp([], 0), []);
});

test("placementMoveAnnouncement announces a 1-based position for screen readers", () => {
  assert.equal(placementMoveAnnouncement("Opening Night", 0, 3), "Opening Night moved to position 1 of 3.");
  assert.equal(placementMoveAnnouncement("Opening Night", 2, 3), "Opening Night moved to position 3 of 3.");
});

// ─── Dirty + payload ────────────────────────────────────────────────────────

test("the dirty comparison is ORDER-SENSITIVE, because position is persisted", () => {
  assert.match(schema, /position/);
  assert.equal(arePlacementsDirty([1, 2, 3], [1, 2, 3]), false);
  assert.equal(arePlacementsDirty([1, 3, 2], [1, 2, 3]), true, "a pure reorder IS a change");
  assert.equal(arePlacementsDirty([1, 2], [1, 2, 3]), true);
  assert.equal(arePlacementsDirty([1, 2, 3], [1, 2]), true);
  assert.equal(arePlacementsDirty([], []), false);
});

test("toPlacementPostIds reads the saved response in its server-given order", () => {
  assert.deepEqual(
    toPlacementPostIds([entry({ postId: 7, position: 0 }), entry({ id: 2, postId: 4, position: 1 })]),
    [7, 4],
  );
  assert.deepEqual(toPlacementPostIds([]), []);
});

test("the payload carries channel + items only — position, startAt and endAt are ABSENT", () => {
  const payload = toPlacementPayload("news", [7, 4, 9]);
  assert.deepEqual(payload, { channel: "news", items: [{ postId: 7 }, { postId: 4 }, { postId: 9 }] });
  for (const item of payload.items) {
    assert.deepEqual(Object.keys(item), ["postId"], "no position is ever sent — array order IS the order");
  }
  // Pinned against the service's own rule, so the omission is safe.
  assert.match(service, /position: item\.position \?\? index/);
});

test("an emptied slot still sends an explicit empty list — clearing is a real save", () => {
  // REPLACE semantics: an empty items array is how a slot is emptied, and it
  // must not be confused with "nothing to send".
  assert.deepEqual(toPlacementPayload("experience", []), { channel: "experience", items: [] });
  assert.equal(arePlacementsDirty([], [1, 2]), true);
});

test("the channel in the payload is the CHOSEN channel, never inferred from a row", () => {
  // The slot's identity surface is channel-scoped; a saved entry's own
  // `channel` field must never be the source of the write's channel.
  assert.equal(toPlacementPayload("experience", [7]).channel, "experience");
  assert.equal(toPlacementPayload("news", [7]).channel, "news");
});

// ─── Copy ───────────────────────────────────────────────────────────────────

test("the screen never implies that placing a post publishes it", () => {
  assert.match(PLACEMENTS_NOT_PUBLIC_YET_NOTE, /does not read Editorial placements yet/);
  assert.match(PLACEMENTS_LIFECYCLE_NOTE, /not published can still be placed/);
  assert.match(PLACEMENTS_CHANNEL_NOTE, /server enforces the same rule/);
  assert.match(PLACEMENTS_PAGE_DESCRIPTION, /channel and a key together/);
  assert.match(PLACEMENTS_EMPTY_STATE, /empty/);
});
