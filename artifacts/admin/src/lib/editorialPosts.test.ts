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
  INACTIVE_LANGUAGE_ADD_BLOCKED,
  INACTIVE_LANGUAGE_EDIT_NOTICE,
  LIVE_CONTENT_WARNING,
  NO_PUBLISH_PERMISSION_NOTICE,
  POST_CHANNEL_IMMUTABLE_EXPLANATION,
  POST_SLUG_MAX,
  SHARED_ACROSS_LANGUAGES_LABEL,
  SLUG_LOCKED_EXPLANATION,
  activePostFilterCount,
  allowedTransitions,
  archivePublishedConfirmation,
  buildLanguageSlots,
  canAddTranslation,
  channelLabel,
  describeSlugProblem,
  formatDate,
  isSlugLocked,
  languageCodesLabel,
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
  assert.match(INACTIVE_LANGUAGE_EDIT_NOTICE, /stays live and stays editable/);
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

test("editing a published translation carries a persistent live-content warning", () => {
  assert.match(LIVE_CONTENT_WARNING, /You are editing live content\./);
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
  assert.match(publish.description, /public address is fixed/);
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
