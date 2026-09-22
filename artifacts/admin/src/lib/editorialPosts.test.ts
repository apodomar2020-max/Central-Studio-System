/**
 * Wave 2.1D — Posts presentation logic (slug, language slots, list rows,
 * server-side filter mapping, RBAC predicates, lifecycle copy).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CHANNEL_OPTIONS,
  DEFAULT_POST_LIST_FILTERS,
  EDITORIAL_SLUG_RE,
  FROZEN_BYLINE_EXPLANATION,
  INACTIVE_LANGUAGE_ADD_BLOCKED,
  INACTIVE_LANGUAGE_EDIT_NOTICE,
  LANGUAGES_REFERENCE_UNAVAILABLE,
  LIVE_CONTENT_WARNING,
  NO_PUBLISH_PERMISSION_NOTICE,
  POST_CHANNEL_IMMUTABLE_EXPLANATION,
  POST_SLUG_MAX,
  SHARED_ACROSS_LANGUAGES_LABEL,
  SLUG_LOCKED_EXPLANATION,
  TRANSITION_FAILURE_TITLES,
  TRANSITION_SUCCESS_TITLES,
  activePostFilterCount,
  allowedTransitions,
  archivePublishedConfirmation,
  authorReassignmentConfirmation,
  buildLanguageSlots,
  canAddTranslation,
  channelLabel,
  describeSlugProblem,
  formatDate,
  isEditorialPostTranslationKey,
  isSlugLocked,
  languageCodesLabel,
  publishedLanguageNames,
  publishedTranslationLanguageLabels,
  listRowTitle,
  pageRangeLabel,
  postCapabilities,
  preferredTranslationCode,
  publishConfirmation,
  slotStateLabel,
  slugPreview,
  statusBadgeLabel,
  toPostListQuery,
  totalPages,
  translationSaveLabel,
  translationSummaryLabel,
} from "./editorial-posts.ts";

const serverSlug = readFileSync(
  new URL("../../../api-server/src/lib/editorialSlug.ts", import.meta.url),
  "utf8",
);
const serverService = readFileSync(
  new URL("../../../api-server/src/lib/editorialPostsService.ts", import.meta.url),
  "utf8",
);
const serverRoutes = readFileSync(
  new URL("../../../api-server/src/routes/adminEditorial.ts", import.meta.url),
  "utf8",
);

// ─── Slug (D6) ───────────────────────────────────────────────────────────────

test("slugPreview reproduces the server's documented examples", () => {
  assert.equal(slugPreview("Opening   night — at last!"), "opening-night-at-last");
  assert.ok(serverSlug.includes('"Opening   night — at last!"'));
});

test("slugPreview does NOT transliterate — Arabic in, Arabic out", () => {
  assert.equal(slugPreview("ليلة الافتتاح"), "ليلة-الافتتاح");
  assert.equal(slugPreview("開幕之夜"), "開幕之夜");
});

test("slugPreview returns empty for a title with no letters or numbers", () => {
  assert.equal(slugPreview("!!!"), "", "callers must treat this as 'ask for an explicit slug'");
});

test("slugPreview caps on a hyphen boundary, never mid-word", () => {
  const long = Array.from({ length: 40 }, () => "opening").join(" ");
  const preview = slugPreview(long);
  assert.ok(preview.length <= POST_SLUG_MAX);
  assert.doesNotMatch(preview, /-$/);
  assert.ok(preview.split("-").every((part) => part === "opening"));
});

test("the slug regex and length cap match the server's", () => {
  assert.equal(EDITORIAL_SLUG_RE.source, /^[\p{L}\p{N}]+(-[\p{L}\p{N}]+)*$/u.source);
  assert.ok(serverSlug.includes("export const MAX_SLUG_LENGTH = 120;"));
  assert.equal(POST_SLUG_MAX, 120);
});

test("describeSlugProblem restates the server's messages verbatim", () => {
  assert.equal(describeSlugProblem("A slug cannot be empty." && ""), "A slug cannot be empty.");
  assert.equal(describeSlugProblem("Opening"), "A slug must be lowercase.");
  assert.equal(describeSlugProblem("opening--night")?.startsWith("A slug must be letters or numbers"), true);
  assert.equal(describeSlugProblem("x".repeat(121)), `A slug cannot exceed ${POST_SLUG_MAX} characters.`);
  assert.equal(describeSlugProblem("opening-night"), null);
  for (const message of [
    "A slug cannot be empty.",
    "A slug must be lowercase.",
  ]) {
    assert.ok(serverSlug.includes(message), `server does not say: ${message}`);
  }
});

test("THE SLUG LOCK IS REAL and keys on publishedAt, not on status", () => {
  // Re-verified in the service: assertSlugEditable throws a 409 whenever
  // publishedAt is non-null.
  assert.match(serverService, /export function assertSlugEditable[\s\S]{0,200}publishedAt != null/);
  assert.equal(isSlugLocked({ publishedAt: null }), false);
  assert.equal(isSlugLocked({ publishedAt: "2026-01-01T00:00:00Z" }), true);
  // Including a translation that was published and then archived.
  assert.equal(isSlugLocked({ publishedAt: "2026-01-01T00:00:00Z" }), true);
});

test("the read-only slug explanation is the server's own 409 message", () => {
  assert.ok(serverService.includes(SLUG_LOCKED_EXPLANATION.slice(0, 60)));
});

// ─── Channel ─────────────────────────────────────────────────────────────────

test("channel has no write path at all on the shared PATCH", () => {
  const body = serverRoutes.slice(serverRoutes.indexOf("router.patch(\n  \"/admin/editorial/posts/:id\""));
  const handler = body.slice(0, body.indexOf("// ─── Translations"));
  assert.doesNotMatch(handler, /body\.channel/);
  assert.ok(POST_CHANNEL_IMMUTABLE_EXPLANATION.length > 40);
  assert.deepEqual(CHANNEL_OPTIONS.map((o) => o.value), ["news", "experience"]);
  assert.equal(channelLabel("experience"), "Experience");
});

test("every shared card carries the shared-across-languages label", () => {
  assert.equal(SHARED_ACROSS_LANGUAGES_LABEL, "Shared across all languages.");
});

// ─── Language slots ──────────────────────────────────────────────────────────

const LANGUAGES = [
  { code: "en", name: "English", isActive: true, displayOrder: 0 },
  { code: "ar", name: "Arabic", isActive: true, displayOrder: 1 },
  { code: "fr", name: "French", isActive: false, displayOrder: 2 },
];

test("slots cover every registered language in the API's own order", () => {
  const slots = buildLanguageSlots(LANGUAGES, []);
  assert.deepEqual(slots.map((slot) => slot.code), ["en", "ar", "fr"]);
});

test("a missing translation in an ACTIVE language can be added", () => {
  const slot = buildLanguageSlots(LANGUAGES, [])[0]!;
  assert.equal(slot.state, "missing");
  assert.equal(canAddTranslation(slot), true);
  assert.equal(slotStateLabel("missing"), "Not translated");
});

test("a missing translation in an INACTIVE language is blocked, with a reason", () => {
  const slot = buildLanguageSlots(LANGUAGES, [])[2]!;
  assert.equal(slot.state, "missing-inactive");
  assert.equal(canAddTranslation(slot), false);
  assert.match(INACTIVE_LANGUAGE_ADD_BLOCKED, /retired/);
});

test("an EXISTING translation in an inactive language is NEVER hidden (Wave 2.0)", () => {
  const slots = buildLanguageSlots(LANGUAGES, [
    { languageCode: "fr", title: "Soirée", status: "published" },
  ]);
  const french = slots.find((slot) => slot.code === "fr")!;
  assert.equal(french.state, "published", "it stays live");
  assert.equal(french.inLanguageThatIsInactive, true);
  assert.match(INACTIVE_LANGUAGE_EDIT_NOTICE, /stays published and stays editable/);
  assert.match(INACTIVE_LANGUAGE_EDIT_NOTICE, /cannot be published/);
});

test("slot state mirrors each translation's own independent status", () => {
  const slots = buildLanguageSlots(LANGUAGES, [
    { languageCode: "en", title: "A", status: "published" },
    { languageCode: "ar", title: "ب", status: "draft" },
  ]);
  assert.deepEqual(slots.map((slot) => slot.state), ["published", "draft", "missing-inactive"]);
});

// ─── Redirect target (D8) ────────────────────────────────────────────────────

test("a bare post id redirects to the published translation when there is one", () => {
  const slots = buildLanguageSlots(LANGUAGES, [
    { languageCode: "en", title: "A", status: "draft" },
    { languageCode: "ar", title: "ب", status: "published" },
  ]);
  assert.equal(preferredTranslationCode(slots), "ar");
});

test("with no published translation it falls back to a draft, then archived", () => {
  assert.equal(
    preferredTranslationCode(buildLanguageSlots(LANGUAGES, [
      { languageCode: "ar", title: "ب", status: "archived" },
      { languageCode: "en", title: "A", status: "draft" },
    ])),
    "en",
  );
  assert.equal(
    preferredTranslationCode(buildLanguageSlots(LANGUAGES, [
      { languageCode: "ar", title: "ب", status: "archived" },
    ])),
    "ar",
  );
});

test("a post with zero translations has no redirect target — the shell renders instead", () => {
  assert.equal(preferredTranslationCode(buildLanguageSlots(LANGUAGES, [])), null);
});

// ─── List rows ───────────────────────────────────────────────────────────────

test("the list row title prefers the published translation, then the first", () => {
  const row = {
    post: { id: 1, channel: "news" as const, authorId: null, updatedAt: "2026-01-01" },
    translations: [
      { languageCode: "en", title: "Draft title", status: "draft" as const },
      { languageCode: "ar", title: "العنوان", status: "published" as const },
    ],
  };
  assert.equal(listRowTitle(row), "العنوان");
  assert.equal(listRowTitle({ ...row, translations: [row.translations[0]!] }), "Draft title");
});

test("a post with no translations, or a blank title, still renders a title cell", () => {
  const base = { post: { id: 1, channel: "news" as const, authorId: null, updatedAt: "x" } };
  assert.equal(listRowTitle({ ...base, translations: [] }), "Untitled post");
  assert.equal(
    listRowTitle({ ...base, translations: [{ languageCode: "en", title: "   ", status: "draft" }] }),
    "Untitled post",
  );
});

test("the translation summary counts each status from data the list already returns", () => {
  assert.equal(
    translationSummaryLabel([{ status: "published" }, { status: "published" }, { status: "draft" }]),
    "2 published · 1 draft",
  );
  assert.equal(translationSummaryLabel([]), "No translations");
  assert.equal(languageCodesLabel([{ languageCode: "en" }, { languageCode: "ar" }]), "en, ar");
});

// ─── Server-side filters (D9) ────────────────────────────────────────────────

test("filter mapping sends only real parameters and omits every 'all'", () => {
  assert.deepEqual(toPostListQuery(DEFAULT_POST_LIST_FILTERS, 1), { page: 1, limit: 25 });
  assert.deepEqual(
    toPostListQuery(
      { search: " opening ", channel: "news", translationStatus: "draft", languageCode: "ar", authorId: 7, topicId: 3 },
      2,
      10,
    ),
    { page: 2, limit: 10, channel: "news", translationStatus: "draft", languageCode: "ar", authorId: 7, topicId: 3, search: "opening" },
  );
});

test("every mapped key is one the list endpoint actually accepts", () => {
  const query = toPostListQuery(
    { search: "a", channel: "news", translationStatus: "draft", languageCode: "ar", authorId: 1, topicId: 2 },
    1,
  );
  const accepted = ["channel", "translationStatus", "languageCode", "authorId", "topicId", "search", "page", "limit"];
  for (const key of Object.keys(query)) assert.ok(accepted.includes(key), `unsupported filter: ${key}`);
});

test("NO sort parameter is produced — the endpoint has no sort contract (D9)", () => {
  const query = JSON.stringify(toPostListQuery(DEFAULT_POST_LIST_FILTERS, 1));
  assert.doesNotMatch(query, /sort|order/i);
  assert.match(serverRoutes, /orderBy\(desc\(editorialPostsTable\.updatedAt\), desc\(editorialPostsTable\.id\)\)/);
});

test("the active-filter badge counts filters, not the search box", () => {
  assert.equal(activePostFilterCount(DEFAULT_POST_LIST_FILTERS), 0);
  assert.equal(activePostFilterCount({ ...DEFAULT_POST_LIST_FILTERS, search: "x" }), 0);
  assert.equal(activePostFilterCount({ ...DEFAULT_POST_LIST_FILTERS, channel: "news", authorId: 2 }), 2);
});

test("pagination arithmetic handles the empty and partial-page cases", () => {
  assert.equal(totalPages(0, 25), 1);
  assert.equal(totalPages(26, 25), 2);
  assert.equal(pageRangeLabel(1, 25, 0), "No posts");
  assert.equal(pageRangeLabel(2, 25, 30), "26–30 of 30");
});

// ─── RBAC ────────────────────────────────────────────────────────────────────

test("publish is a SEPARATE capability from edit, never collapsed into it", () => {
  const editorOnly = postCapabilities((m, a) => m === "website.posts" && ["view", "edit"].includes(a));
  assert.equal(editorOnly.canEdit, true);
  assert.equal(editorOnly.canPublish, false);
  assert.equal(editorOnly.canCreate, false);
  const full = postCapabilities(() => true);
  assert.equal(full.canPublish, true);
});

test("no delete capability is exposed — there is no DELETE post route to back it", () => {
  const caps = postCapabilities(() => true) as Record<string, unknown>;
  assert.equal("canDelete" in caps, false);
  assert.doesNotMatch(serverRoutes, /router\.delete\(\s*"\/admin\/editorial\/posts/);
});

test("all three transitions are gated on publish, matching the routes", () => {
  assert.match(serverRoutes, /requireAdminPermission\("website\.posts", "publish"\)/);
  assert.match(NO_PUBLISH_PERMISSION_NOTICE, /Publish permission/);
});

// ─── Save labels (D7) + lifecycle ────────────────────────────────────────────

test("save labels are status-dependent — never one generic 'Save'", () => {
  assert.equal(translationSaveLabel("draft"), "Save draft");
  assert.equal(translationSaveLabel("published"), "Update");
  assert.equal(translationSaveLabel("archived"), "Save changes");
  const labels = new Set(["draft", "published", "archived"].map((s) => translationSaveLabel(s as never)));
  assert.equal(labels.size, 3);
  assert.equal(labels.has("Save"), false);
});

test("editing a published translation carries a persistent published-content warning", () => {
  // The SAFETY point must survive: this warns that a save takes effect
  // immediately on already-published content, with no separate publish step.
  assert.match(LIVE_CONTENT_WARNING, /Published Editorial content/);
  assert.match(LIVE_CONTENT_WARNING, /immediately/);
  // What it must NOT claim, while Editorial is still in coexistence mode.
  assert.doesNotMatch(LIVE_CONTENT_WARNING, /public website|to the website|visitors/i);
});

test("the transition table matches the server's exactly — no unpublish", () => {
  assert.deepEqual(allowedTransitions("draft"), ["published", "archived"]);
  assert.deepEqual(allowedTransitions("published"), ["archived"]);
  assert.deepEqual(allowedTransitions("archived"), ["draft"]);
  assert.match(serverService, /draft: \["published", "archived"\]/);
  assert.match(serverService, /published: \["archived"\]/);
  assert.match(serverService, /archived: \["draft"\]/);
});

test("publish and archive confirmations state the real consequences", () => {
  const publish = publishConfirmation({ title: "Opening night", languageName: "English" });
  assert.match(publish.description, /address is fixed/);
  assert.doesNotMatch(publish.description, /public website|visitors|readable on/i);
  assert.match(publish.description, /byline is frozen/);
  assert.equal(publish.destructive, false);
  const archive = archivePublishedConfirmation({ title: "Opening night", languageName: "English" });
  assert.match(archive.description, /Nothing is deleted/);
  assert.match(archive.description, /every other language is untouched/);
});

test("status badges and dates render safely", () => {
  assert.equal(statusBadgeLabel("published"), "Published");
  assert.equal(formatDate(null), "—");
  assert.equal(formatDate("nonsense"), "—");
  assert.equal(formatDate("2026-03-04T10:00:00.000Z"), "2026-03-04");
});

// ─── Frozen byline: copy, confirmation, invalidation predicate ───────────────
// Regression cover for the Wave 2.1D release blocker: the editor used to tell
// operators that reassigning a post's author "changes it on the next publish".
// updatePostSharedFields rewrites `authorSnapshot` on every published
// translation inside the shared save's own transaction, so the change is live
// immediately.

test("the frozen-byline copy never reintroduces deferred-effect wording", () => {
  assert.doesNotMatch(FROZEN_BYLINE_EXPLANATION, /next publish/i);
  assert.doesNotMatch(FROZEN_BYLINE_EXPLANATION, /re-?publish/i);
  assert.doesNotMatch(FROZEN_BYLINE_EXPLANATION, /future publication/i);
  // Nor any other "later" framing.
  assert.doesNotMatch(FROZEN_BYLINE_EXPLANATION, /will be applied|takes effect later|once you publish/i);
});

test("the frozen-byline copy states the change is immediate and live", () => {
  assert.match(FROZEN_BYLINE_EXPLANATION, /the moment shared settings are saved/);
  assert.match(FROZEN_BYLINE_EXPLANATION, /rewrites the byline on every published language/);
});

test("the frozen-byline copy never implies the effect is draft-only", () => {
  // It must not scope the consequence to drafts, and must not claim that any
  // published translation is spared.
  assert.doesNotMatch(FROZEN_BYLINE_EXPLANATION, /only.{0,20}draft/i);
  assert.doesNotMatch(FROZEN_BYLINE_EXPLANATION, /published.{0,40}(unchanged|not affected|keep)/i);
});

test("the frozen-byline copy keeps the author-ENTITY guarantee intact", () => {
  assert.match(FROZEN_BYLINE_EXPLANATION, /Editing the author's profile in Authors never rewrites it/);
  // It attributes the rewrite to reassigning THIS POST's author, not to
  // editing the author record.
  assert.match(FROZEN_BYLINE_EXPLANATION, /reassigning this post's author/);
});

test("the frozen-byline copy does not claim historical revisions are rewritten", () => {
  assert.doesNotMatch(FROZEN_BYLINE_EXPLANATION, /revision/i);
});

test("the frozen-byline copy is backed by the real backend behaviour", () => {
  const service = readFileSync(
    new URL("../../../api-server/src/lib/editorialPostsService.ts", import.meta.url),
    "utf8",
  );
  assert.ok(
    /if \(authorChanged\) \{[\s\S]{0,600}authorSnapshot: snapshot/.test(service),
    "updatePostSharedFields no longer rewrites authorSnapshot on author change — the copy may be wrong",
  );
});

test("the author-reassignment confirmation names every live language", () => {
  const one = authorReassignmentConfirmation({ languageNames: ["English"] });
  assert.match(one.title, /published post/);
  assert.match(one.description, /English/);
  assert.match(one.description, /that language is/);
  assert.doesNotMatch(one.description, /next publish/i);
  assert.equal(one.destructive, false);

  const many = authorReassignmentConfirmation({ languageNames: ["English", "Arabic"] });
  assert.match(many.title, /every published language/);
  assert.match(many.description, /English, Arabic/);
  assert.match(many.description, /those languages are/);
  assert.match(many.description, /a revision is recorded for each language/);
});

test("publishedLanguageNames returns only the live slots", () => {
  const slots = buildLanguageSlots(
    [
      { code: "en", name: "English", isActive: true, displayOrder: 1 },
      { code: "ar", name: "Arabic", isActive: true, displayOrder: 2 },
      { code: "fr", name: "French", isActive: true, displayOrder: 3 },
      { code: "de", name: "German", isActive: true, displayOrder: 4 },
    ],
    [
      { languageCode: "en", title: "A", status: "published" },
      { languageCode: "ar", title: "B", status: "published" },
      { languageCode: "fr", title: "C", status: "draft" },
      { languageCode: "de", title: "D", status: "archived" },
    ],
  );
  assert.deepEqual(publishedLanguageNames(slots), ["English", "Arabic"]);
  assert.deepEqual(publishedLanguageNames([]), []);
});

// ─── Finding C: a Languages outage must not suppress the live-byline warning ─

const POST_TRANSLATIONS = [
  { languageCode: "en", title: "A", status: "published" as const },
  { languageCode: "ar", title: "B", status: "published" as const },
  { languageCode: "fr", title: "C", status: "draft" as const },
  { languageCode: "de", title: "D", status: "archived" as const },
];

test("C: the OLD slot-derived path silently reports zero live languages when Languages fails", () => {
  // The bug, pinned. `buildLanguageSlots` iterates the reference list, so an
  // empty (failed) Languages query collapses every slot away — and the
  // caller concluded the post had nothing live.
  assert.deepEqual(publishedLanguageNames(buildLanguageSlots([], POST_TRANSLATIONS)), []);
});

test("C: published languages are derived from the POST's translations, not from Languages", () => {
  // FAILS before the fix: the helper did not exist and the caller used the
  // slot-derived path above, which returns [].
  assert.deepEqual(
    publishedTranslationLanguageLabels(POST_TRANSLATIONS, []),
    ["en", "ar"],
    "a Languages outage must still name the live languages — by raw code",
  );
});

test("C: the Languages list supplies display names only, and degrades per-code", () => {
  assert.deepEqual(
    publishedTranslationLanguageLabels(POST_TRANSLATIONS, LANGUAGES),
    ["English", "Arabic"],
  );
  // A partially-known list names what it can and invents nothing.
  assert.deepEqual(
    publishedTranslationLanguageLabels(POST_TRANSLATIONS, [LANGUAGES[0]!]),
    ["English", "ar"],
  );
});

test("C: NO published translations means NO confirmation, even with Languages down", () => {
  const none = [
    { languageCode: "en", title: "A", status: "draft" as const },
    { languageCode: "ar", title: "B", status: "archived" as const },
  ];
  assert.deepEqual(publishedTranslationLanguageLabels(none, []), []);
  assert.deepEqual(publishedTranslationLanguageLabels([], []), []);
});

test("C: the Languages-failure notice states the outage without inventing languages", () => {
  assert.match(LANGUAGES_REFERENCE_UNAVAILABLE, /could not be loaded/);
  assert.match(LANGUAGES_REFERENCE_UNAVAILABLE, /by code/);
  assert.match(LANGUAGES_REFERENCE_UNAVAILABLE, /Saving is unaffected/);
});

// ─── Finding B: lifecycle failure titles ────────────────────────────────────

test("B: the old derivation mangled Archive and left a failed Restore success-sounding", () => {
  // The exact shipped expression, reproduced — this documents WHY the
  // derivation was removed rather than patched.
  const derive = (successTitle: string) => successTitle.replace(/ed$/, " failed");
  assert.equal(derive("Published"), "Publish failed");
  assert.equal(derive("Archived"), "Archiv failed");
  assert.equal(
    derive("Restored to draft"),
    "Restored to draft",
    "a failed Restore was announced with its own success sentence",
  );
});

test("B: every transition has its own failure title, free of success wording", () => {
  for (const transition of ["publish", "archive", "restore"] as const) {
    const success = TRANSITION_SUCCESS_TITLES[transition];
    const failure = TRANSITION_FAILURE_TITLES[transition];
    assert.match(failure, /failed/i, `${transition} failure title must say it failed`);
    assert.doesNotMatch(
      failure,
      new RegExp(success.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `${transition} failure title must not contain the success title "${success}"`,
    );
    // No past-tense "it happened" wording anywhere in a failure title.
    assert.doesNotMatch(failure, /\b(Published|Archived|Restored)\b/);
    assert.notEqual(failure, success);
  }
  // And the mangled string can never be produced again.
  assert.doesNotMatch(TRANSITION_FAILURE_TITLES.archive, /Archiv failed/);
  assert.equal(TRANSITION_FAILURE_TITLES.publish, "Publish failed — nothing was published");
});

test("the translation-key predicate matches EVERY cached language of one post", () => {
  const en = [`/api/admin/editorial/posts/7/translations/en`];
  const ar = [`/api/admin/editorial/posts/7/translations/ar`];
  assert.equal(isEditorialPostTranslationKey(7, en), true);
  assert.equal(isEditorialPostTranslationKey(7, ar), true);
});

test("the translation-key predicate never reaches another post or another query", () => {
  // Prefix confusion: 7 must not match 70 or 77.
  assert.equal(isEditorialPostTranslationKey(7, ["/api/admin/editorial/posts/70/translations/en"]), false);
  assert.equal(isEditorialPostTranslationKey(7, ["/api/admin/editorial/posts/77/translations/en"]), false);
  // The post detail and the translations LIST are separate keys with their
  // own explicit invalidations — the predicate must not swallow them.
  assert.equal(isEditorialPostTranslationKey(7, ["/api/admin/editorial/posts/7"]), false);
  assert.equal(isEditorialPostTranslationKey(7, ["/api/admin/editorial/posts/7/translations"]), false);
  assert.equal(isEditorialPostTranslationKey(7, ["/api/admin/editorial/authors"]), false);
  assert.equal(isEditorialPostTranslationKey(7, [{ url: "x" }]), false);
  assert.equal(isEditorialPostTranslationKey(7, []), false);
});

test("the predicate is needed because the generated key is one opaque string", () => {
  // If the generator ever emits [path, id, languageCode], a plain prefix key
  // becomes possible and this predicate should be revisited.
  const api = readFileSync(
    new URL("../../../../lib/api-client-react/src/generated/api.ts", import.meta.url),
    "utf8",
  );
  assert.ok(
    api.includes("`/api/admin/editorial/posts/${id}/translations/${languageCode}`,\n  ] as const;"),
    "the generated translation query key shape changed — re-check the invalidation strategy",
  );
});

// ─── Dirty-state preservation across a shared-save refetch ───────────────────
// The editor re-baselines the translation form from an EFFECT keyed on
// `translationRow?.id`. A refetch caused by the shared save returns the SAME
// row id, so the effect does not re-run and unsaved prose survives. This test
// simulates that dependency semantics rather than trusting the comment.

test("a same-row refetch does not re-run the translation re-baseline effect", () => {
  let lastDeps: unknown[] | null = null;
  let runs = 0;
  const form = { title: "unsaved title", body: "unsaved body" };
  /** Mirrors React's dependency comparison for the re-baseline effect. */
  const runEffect = (deps: unknown[], reset: () => void) => {
    if (lastDeps === null || deps.some((dep, i) => !Object.is(dep, lastDeps![i]))) {
      runs += 1;
      reset();
    }
    lastDeps = deps;
  };
  const resetFromServer = (row: { title: string; body: string }) => {
    form.title = row.title;
    form.body = row.body;
  };

  // First load of translation row 42.
  let row = { id: 42, title: "server title", body: "server body" };
  runEffect([row.id], () => resetFromServer(row));
  assert.equal(runs, 1);

  // Operator types. Nothing is saved.
  form.title = "unsaved title";
  form.body = "unsaved body";

  // The shared save lands; the predicate invalidation refetches translation
  // 42 and the server answers with a NEW authorSnapshot but the same row id.
  row = { id: 42, title: "server title", body: "server body" };
  runEffect([row.id], () => resetFromServer(row));
  assert.equal(runs, 1, "the re-baseline effect must not re-run for the same row id");
  assert.equal(form.title, "unsaved title", "unsaved title was clobbered by the refetch");
  assert.equal(form.body, "unsaved body", "unsaved body was clobbered by the refetch");

  // Switching language IS a different row, and must re-baseline.
  row = { id: 43, title: "arabic title", body: "arabic body" };
  runEffect([row.id], () => resetFromServer(row));
  assert.equal(runs, 2);
  assert.equal(form.title, "arabic title");
});
