/**
 * Unified Website CMS slice 3 — "Related Performance" for News.
 *
 * Pure helpers are tested for real; the card and its two consumers are
 * pinned by source inspection (the established Admin convention — `.tsx`
 * cannot be mounted under node:test here).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PERFORMANCE_REFS_MAX,
  addPerformanceRef,
  arePerformanceRefsDirty,
  isMigratedPost,
  performanceCandidates,
  removePerformanceRef,
  toPerformanceRefsPayload,
} from "./editorial-performance-refs.ts";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const card = read("../components/editorial/performance-refs-card.tsx");
const editor = read("../pages/editorial/EditorialPostTranslationPage.tsx");
const create = read("../pages/editorial/EditorialPostCreatePage.tsx");
const layout = read("../components/admin/cms-editor-layout.tsx");

const PERFORMANCES = [
  { id: 1, title: "Spring Showcase", slug: "spring-showcase", isActive: true },
  { id: 2, title: "Summer Gala", slug: "summer-gala", isActive: false },
  { id: 3, title: "Nutcracker", slug: "nutcracker-repertoire", isActive: true },
];

test("the payload is the ordered list without positions (array order is the order)", () => {
  assert.deepEqual(toPerformanceRefsPayload([3, 1, 3]), { items: [{ performanceId: 3 }, { performanceId: 1 }] });
  assert.deepEqual(toPerformanceRefsPayload([]), { items: [] });
});

test("dirty comparison is order-sensitive", () => {
  assert.equal(arePerformanceRefsDirty([1, 3], [1, 3]), false);
  assert.equal(arePerformanceRefsDirty([3, 1], [1, 3]), true);
  assert.equal(arePerformanceRefsDirty([1], [1, 3]), true);
});

test("only ACTIVE, not-yet-chosen Performances are offered, searchable by title or slug", () => {
  assert.deepEqual(performanceCandidates(PERFORMANCES, [], "").map((p) => p.id), [1, 3]);
  assert.deepEqual(performanceCandidates(PERFORMANCES, [1], "").map((p) => p.id), [3]);
  assert.deepEqual(performanceCandidates(PERFORMANCES, [], "repertoire").map((p) => p.id), [3]);
  assert.deepEqual(performanceCandidates(PERFORMANCES, [], "gala").map((p) => p.id), []);
});

test("add is de-duplicated and capped; remove is exact", () => {
  assert.deepEqual(addPerformanceRef([1], 1), [1]);
  assert.deepEqual(addPerformanceRef([1], 3), [1, 3]);
  const full = Array.from({ length: PERFORMANCE_REFS_MAX }, (_, i) => i + 100);
  assert.deepEqual(addPerformanceRef(full, 1), full);
  assert.deepEqual(removePerformanceRef([1, 3], 1), [3]);
});

test("a post with migration provenance is treated as migrated", () => {
  assert.equal(isMigratedPost({ migrationSourceTable: "website_news_posts" }), true);
  assert.equal(isMigratedPost({ migrationSourceTable: null }), false);
});

test("the Edit page offers the editable card ONLY for native News posts", () => {
  assert.match(
    editor,
    /\{postRow\.channel === "news" && !isMigratedPost\(postRow\) && \(\s*<PerformanceRefsEditCard postId=\{postId\} disabled=\{readOnly\} \/>/,
  );
});

test("the Edit card is a scoped save on its own endpoint, like Topics/Recommended reading", () => {
  assert.match(card, /useListEditorialPostPerformanceRefs\(postId/);
  assert.match(card, /useReplaceEditorialPostPerformanceRefs\(\)/);
  assert.match(card, /replace\.mutate\(\s*\{ id: postId, data: toPerformanceRefsPayload\(selected\) \}/);
  assert.match(card, /data-testid="button-save-performance-refs"/);
  assert.match(card, /data-testid="performance-refs-error-alert"/);
  assert.match(card, /data-testid="performance-refs-dirty"/);
});

test("the Performance list never fires for a role without website.performance:view", () => {
  assert.match(card, /const canList = can\("website\.performance", "view"\);/);
  assert.match(card, /enabled: canList && !disabled/);
  assert.match(card, /const unavailable = !canList \|\| performances\.isError;/);
  assert.match(card, /data-testid="performance-refs-unavailable"/);
});

test("Add News uses the card in pending mode (no post id, no save button)", () => {
  assert.match(create, /<PerformanceRefsCard\s+selected=\{form\.performanceIds\}/);
  assert.doesNotMatch(create, /PerformanceRefsEditCard/);
});

test("the shared CMS editor layout keeps the canvas + sticky 20rem sidebar, sidebar first when stacked", () => {
  assert.match(layout, /lg:grid-cols-\[minmax\(0,1fr\)_20rem\]/);
  assert.match(layout, /<aside className="[^"]*lg:order-2 lg:sticky lg:top-4"/);
  assert.ok(layout.indexOf("<aside") < layout.indexOf("lg:order-1"), "sidebar is first in DOM order");
  // The Edit page keeps the identical frame inline (not migrated, to protect its pinned tests).
  assert.match(editor, /lg:grid lg:grid-cols-\[minmax\(0,1fr\)_20rem\] lg:items-start/);
});
