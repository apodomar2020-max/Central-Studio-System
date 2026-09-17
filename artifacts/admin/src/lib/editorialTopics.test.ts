/**
 * Wave 2.1C — Topics presentation logic.
 *
 * Real behaviour tests: lib/editorial-topics.ts is a pure module with no React
 * and no `import.meta.env`, so every rule and every piece of operator-facing
 * copy is exercised directly rather than by regex. The screen itself is
 * covered by source inspection in
 * pages/editorial/editorialTopicsPage.test.ts, matching the established Admin
 * convention for `.tsx` (see websiteSettingsLanguagesPage.test.ts).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CHANNEL_OPTIONS,
  DEFAULT_TOPIC_FILTERS,
  EMPTY_TOPIC_FORM,
  TOPIC_CHANNEL_IMMUTABLE_EXPLANATION,
  TOPIC_NAME_MAX,
  TOPIC_SLUG_EDIT_EXPLANATION,
  TOPIC_SLUG_FORMAT_MESSAGE,
  TOPIC_SLUG_MAX,
  TOPIC_SLUG_RE,
  activeTopicFilterCount,
  archiveTopicConfirmation,
  channelLabel,
  filterTopics,
  hasTopicFormErrors,
  isValidTopicSlug,
  nextSlugForNameChange,
  reactivateTopicMessage,
  suggestSlugFromName,
  validateTopicForm,
  type TopicFormValues,
  type TopicRowLike,
} from "./editorial-topics.ts";

const form = (over: Partial<TopicFormValues> = {}): TopicFormValues => ({
  ...EMPTY_TOPIC_FORM,
  name: "Backstage",
  slug: "backstage",
  ...over,
});

const row = (over: Partial<TopicRowLike> = {}): TopicRowLike => ({
  name: "Backstage",
  slug: "backstage",
  channel: "news",
  status: "active",
  ...over,
});

// ─── Slug regex parity with the backend ──────────────────────────────────────

test("the slug regex source is byte-identical to the backend route's TOPIC_SLUG_RE", () => {
  const route = readFileSync(
    new URL("../../../api-server/src/routes/adminEditorial.ts", import.meta.url),
    "utf8",
  );
  const match = route.match(/const TOPIC_SLUG_RE = (\/.+\/);/);
  assert.ok(match, "TOPIC_SLUG_RE not found in adminEditorial.ts — the mirror cannot be verified");
  assert.equal(match[1], TOPIC_SLUG_RE.toString(), "the Admin mirror has drifted from the route");
});

test("the slug format message is the backend's own wording, verbatim", () => {
  const route = readFileSync(
    new URL("../../../api-server/src/routes/adminEditorial.ts", import.meta.url),
    "utf8",
  );
  assert.ok(
    route.includes(`{ error: "${TOPIC_SLUG_FORMAT_MESSAGE}" }`),
    "the client-side slug message no longer matches the backend's",
  );
});

test("isValidTopicSlug accepts the shapes the backend accepts", () => {
  for (const slug of ["backstage", "behind-the-scenes", "a1", "2024-season", "a", "1"]) {
    assert.equal(isValidTopicSlug(slug), true, `expected ${slug} to be valid`);
  }
});

test("isValidTopicSlug rejects everything the backend rejects", () => {
  for (const slug of [
    "Backstage",           // uppercase
    "behind_the_scenes",   // underscore
    "-lead",               // leading hyphen
    "trail-",              // trailing hyphen
    "double--hyphen",      // repeated hyphen
    "with space",          // whitespace
    "café",                // unicode
    "",                    // empty
    "dot.separated",
    "slash/separated",
  ]) {
    assert.equal(isValidTopicSlug(slug), false, `expected ${JSON.stringify(slug)} to be invalid`);
  }
});

// ─── Slug suggestion (D5) ────────────────────────────────────────────────────

test("suggestSlugFromName lowercases and hyphenates", () => {
  assert.equal(suggestSlugFromName("Behind The Scenes"), "behind-the-scenes");
  assert.equal(suggestSlugFromName("Backstage"), "backstage");
  assert.equal(suggestSlugFromName("2024 Season"), "2024-season");
});

test("suggestSlugFromName strips punctuation, collapses hyphens and trims edges", () => {
  assert.equal(suggestSlugFromName("Rehearsals & Run-throughs!"), "rehearsals-run-throughs");
  assert.equal(suggestSlugFromName("  --Opening Night--  "), "opening-night");
  assert.equal(suggestSlugFromName("A___B"), "a-b");
  assert.equal(suggestSlugFromName("Ballet: The Nutcracker"), "ballet-the-nutcracker");
});

test("suggestSlugFromName always yields a valid slug or the empty string", () => {
  for (const name of ["Behind The Scenes", "café", "!!!", "   ", "", "—", "أخبار"]) {
    const suggestion = suggestSlugFromName(name);
    assert.ok(
      suggestion === "" || isValidTopicSlug(suggestion),
      `suggestion for ${JSON.stringify(name)} was ${JSON.stringify(suggestion)}`,
    );
  }
  // Non-ASCII names have no ASCII slug to derive — the operator types one.
  assert.equal(suggestSlugFromName("café"), "caf");
  assert.equal(suggestSlugFromName("أخبار"), "");
});

test("nextSlugForNameChange keeps suggesting until the operator touches the slug", () => {
  let state = { name: "", slug: "", slugTouched: false };

  state = { ...state, name: "Behind", slug: nextSlugForNameChange(state, "Behind", "create") };
  assert.equal(state.slug, "behind");

  state = {
    ...state,
    name: "Behind The Scenes",
    slug: nextSlugForNameChange(state, "Behind The Scenes", "create"),
  };
  assert.equal(state.slug, "behind-the-scenes");

  // Operator edits the slug by hand — suggestion must stop for good.
  state = { ...state, slug: "bts", slugTouched: true };
  state = {
    ...state,
    name: "Something Else Entirely",
    slug: nextSlugForNameChange(state, "Something Else Entirely", "create"),
  };
  assert.equal(state.slug, "bts", "a touched slug must never be overwritten by a name change");
});

test("nextSlugForNameChange never rewrites a slug on edit, even untouched", () => {
  const state = { name: "Backstage", slug: "backstage", slugTouched: false };
  assert.equal(nextSlugForNameChange(state, "Completely New Name", "edit"), "backstage");
});

// ─── Validation ──────────────────────────────────────────────────────────────

test("validateTopicForm accepts a well-formed create", () => {
  assert.deepEqual(validateTopicForm(form(), { requireChannel: true }), {});
  assert.equal(hasTopicFormErrors({}), false);
});

test("validateTopicForm requires a name and enforces the 120-character ceiling", () => {
  assert.equal(validateTopicForm(form({ name: "   " }), { requireChannel: true }).name, "A name is required.");
  assert.equal(
    validateTopicForm(form({ name: "x".repeat(TOPIC_NAME_MAX + 1) }), { requireChannel: true }).name,
    `A name can be at most ${TOPIC_NAME_MAX} characters.`,
  );
  assert.equal(
    validateTopicForm(form({ name: "x".repeat(TOPIC_NAME_MAX) }), { requireChannel: true }).name,
    undefined,
  );
});

test("validateTopicForm requires a slug, enforces its ceiling, and uses the backend's format wording", () => {
  assert.equal(validateTopicForm(form({ slug: "  " }), { requireChannel: true }).slug, "A slug is required.");
  assert.equal(
    validateTopicForm(form({ slug: `a${"b".repeat(TOPIC_SLUG_MAX)}` }), { requireChannel: true }).slug,
    `A slug can be at most ${TOPIC_SLUG_MAX} characters.`,
  );
  assert.equal(
    validateTopicForm(form({ slug: "Behind_The_Scenes" }), { requireChannel: true }).slug,
    TOPIC_SLUG_FORMAT_MESSAGE,
  );
});

test("channel is required on create and not validated on edit", () => {
  const bad = form({ channel: "podcast" as never });
  assert.equal(validateTopicForm(bad, { requireChannel: true }).channel, "A channel is required.");
  assert.equal(validateTopicForm(bad, { requireChannel: false }).channel, undefined);
});

test("hasTopicFormErrors reports any populated field", () => {
  assert.equal(hasTopicFormErrors(validateTopicForm(form({ slug: "Bad Slug" }), { requireChannel: true })), true);
});

// ─── Filtering ───────────────────────────────────────────────────────────────

const rows: TopicRowLike[] = [
  row({ name: "Backstage", slug: "backstage", channel: "news", status: "active" }),
  row({ name: "Opening Night", slug: "opening-night", channel: "news", status: "archived" }),
  row({ name: "Rehearsals", slug: "rehearsals", channel: "experience", status: "active" }),
  row({ name: "Costume Design", slug: "costume-design", channel: "experience", status: "archived" }),
];

test("the default filters show every row, archived included (D2)", () => {
  assert.equal(DEFAULT_TOPIC_FILTERS.status, "all");
  assert.equal(DEFAULT_TOPIC_FILTERS.channel, "all");
  assert.equal(filterTopics(rows, DEFAULT_TOPIC_FILTERS).length, 4);
  assert.ok(filterTopics(rows, DEFAULT_TOPIC_FILTERS).some((r) => r.status === "archived"));
});

test("search matches name and slug, case-insensitively", () => {
  assert.deepEqual(
    filterTopics(rows, { ...DEFAULT_TOPIC_FILTERS, search: "OPENING" }).map((r) => r.slug),
    ["opening-night"],
  );
  assert.deepEqual(
    filterTopics(rows, { ...DEFAULT_TOPIC_FILTERS, search: "costume-de" }).map((r) => r.name),
    ["Costume Design"],
  );
  assert.equal(filterTopics(rows, { ...DEFAULT_TOPIC_FILTERS, search: "   " }).length, 4);
  assert.equal(filterTopics(rows, { ...DEFAULT_TOPIC_FILTERS, search: "nothing" }).length, 0);
});

test("channel and status filters narrow independently and together", () => {
  assert.equal(filterTopics(rows, { ...DEFAULT_TOPIC_FILTERS, channel: "news" }).length, 2);
  assert.equal(filterTopics(rows, { ...DEFAULT_TOPIC_FILTERS, status: "archived" }).length, 2);
  assert.deepEqual(
    filterTopics(rows, { ...DEFAULT_TOPIC_FILTERS, channel: "experience", status: "active" }).map((r) => r.slug),
    ["rehearsals"],
  );
});

test("activeTopicFilterCount counts only the non-default filters", () => {
  assert.equal(activeTopicFilterCount(DEFAULT_TOPIC_FILTERS), 0);
  assert.equal(activeTopicFilterCount({ ...DEFAULT_TOPIC_FILTERS, search: "x" }), 0);
  assert.equal(activeTopicFilterCount({ ...DEFAULT_TOPIC_FILTERS, channel: "news" }), 1);
  assert.equal(activeTopicFilterCount({ ...DEFAULT_TOPIC_FILTERS, channel: "news", status: "active" }), 2);
});

// ─── Copy ────────────────────────────────────────────────────────────────────

test("archive copy names the topic, promises retention, and is NOT destructive-styled", () => {
  const copy = archiveTopicConfirmation({ name: "Backstage" });
  assert.match(copy.title, /Backstage/);
  assert.match(copy.description, /Nothing is deleted\./);
  assert.match(copy.description, /Posts already tagged with it keep the tag/);
  assert.match(copy.description, /can no longer be added to posts/);
  assert.match(copy.description, /reactivate it at any time/);
  assert.equal(copy.confirmLabel, "Archive topic");
  // The shared confirm defaults to destructive: true; archiving is retention.
  assert.equal(copy.destructive, false);
});

test("reactivate copy states nothing about a post's tags changes", () => {
  const message = reactivateTopicMessage({ name: "Backstage" });
  assert.match(message, /Backstage/);
  assert.match(message, /No post's tags are changed\./);
});

test("the immutability and slug-edit explanations are non-empty exported constants", () => {
  assert.ok(TOPIC_CHANNEL_IMMUTABLE_EXPLANATION.length > 0);
  assert.match(TOPIC_CHANNEL_IMMUTABLE_EXPLANATION, /cannot be changed/);
  assert.match(TOPIC_SLUG_EDIT_EXPLANATION, /posts already tagged/i);
});

test("channel labels and options are real words", () => {
  assert.equal(channelLabel("news"), "News");
  assert.equal(channelLabel("experience"), "Experience");
  assert.deepEqual(CHANNEL_OPTIONS.map((o) => o.value), ["news", "experience"]);
});
