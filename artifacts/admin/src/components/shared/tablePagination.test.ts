/**
 * Wave 2.1A — the shared table pagination primitive.
 *
 * The boundary maths is tested for real against ./table-pagination-state.
 * The rendered control itself is asserted by source inspection, the existing
 * frontend test convention in this app (see pages/branches.test.ts) — the
 * component imports `@/`-aliased JSX, which plain node:test cannot execute.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildTablePaginationState, derivedTotalPages, paginationRange } from "./table-pagination-state.ts";

const component = readFileSync(new URL("./table-pagination.tsx", import.meta.url), "utf8");

// ─── Boundary states ─────────────────────────────────────────────────────────

test("page 1 of several — previous is unavailable, next is available", () => {
  const s = buildTablePaginationState({ page: 1, pageSize: 20, total: 100, totalPages: 5 });
  assert.equal(s.canPrevious, false);
  assert.equal(s.canNext, true);
  assert.equal(s.startItem, 1);
  assert.equal(s.endItem, 20);
});

test("last page — next is unavailable, previous is available", () => {
  const s = buildTablePaginationState({ page: 5, pageSize: 20, total: 95, totalPages: 5 });
  assert.equal(s.canPrevious, true);
  assert.equal(s.canNext, false);
  assert.equal(s.startItem, 81);
  assert.equal(s.endItem, 95, "the final page must not overshoot the total");
});

test("a middle page — both directions available", () => {
  const s = buildTablePaginationState({ page: 3, pageSize: 20, total: 100, totalPages: 5 });
  assert.equal(s.canPrevious, true);
  assert.equal(s.canNext, true);
  assert.equal(s.isSinglePage, false);
});

test("a single page of results — neither direction is available", () => {
  const s = buildTablePaginationState({ page: 1, pageSize: 20, total: 7, totalPages: 1 });
  assert.equal(s.canPrevious, false);
  assert.equal(s.canNext, false);
  assert.equal(s.isSinglePage, true);
  assert.equal(s.isEmpty, false);
  assert.deepEqual(s.pages, [1]);
});

test("zero total — empty, single-page, no navigation and a 0–0 summary", () => {
  const s = buildTablePaginationState({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
  assert.equal(s.isEmpty, true);
  assert.equal(s.isSinglePage, true);
  assert.equal(s.canPrevious, false);
  assert.equal(s.canNext, false);
  assert.equal(s.startItem, 0);
  assert.equal(s.endItem, 0);
  assert.deepEqual(s.pages, []);
});

test("totalPages is derived from total/pageSize when the API does not report it", () => {
  assert.equal(buildTablePaginationState({ page: 1, pageSize: 20, total: 41 }).totalPages, 3);
  assert.equal(buildTablePaginationState({ page: 1, pageSize: 20, total: 40 }).totalPages, 2);
  assert.equal(buildTablePaginationState({ page: 1, pageSize: 20, total: 0 }).totalPages, 0);
  assert.equal(derivedTotalPages(41, 20), 3);
  assert.equal(derivedTotalPages(10, 0), 0, "a zero page size must not divide by zero");
  assert.equal(derivedTotalPages(Number.NaN, 20), 0);
});

test("an out-of-range page is clamped to a usable value rather than crashing", () => {
  assert.equal(buildTablePaginationState({ page: 0, pageSize: 20, total: 40, totalPages: 2 }).page, 1);
  assert.equal(buildTablePaginationState({ page: -5, pageSize: 20, total: 40, totalPages: 2 }).page, 1);
});

test("the page window keeps first, last and ±2 around the current page", () => {
  assert.deepEqual(paginationRange(1, 1), [1]);
  assert.deepEqual(paginationRange(1, 3), [1, 2, 3]);
  assert.deepEqual(paginationRange(10, 20), [1, 8, 9, 10, 11, 12, 20]);
  assert.deepEqual(paginationRange(1, 0), []);
});

test("the extracted maths reproduces the behaviour the component shipped with", () => {
  // The pre-extraction implementation, replayed for a range of inputs.
  const legacy = (page: number, totalPages: number, total: number, pageSize: number) => ({
    startItem: total === 0 ? 0 : (page - 1) * pageSize + 1,
    endItem: total === 0 ? 0 : Math.min(page * pageSize, total),
    prevDisabled: page <= 1,
    nextDisabled: totalPages === 0 || page >= totalPages,
  });
  for (const [page, totalPages, total, pageSize] of [
    [1, 5, 100, 20],
    [3, 5, 100, 20],
    [5, 5, 95, 20],
    [1, 1, 7, 20],
    [1, 0, 0, 20],
  ] as const) {
    const expected = legacy(page, totalPages, total, pageSize);
    const s = buildTablePaginationState({ page, pageSize, total, totalPages });
    assert.equal(s.startItem, expected.startItem);
    assert.equal(s.endItem, expected.endItem);
    assert.equal(!s.canPrevious, expected.prevDisabled);
    assert.equal(!s.canNext, expected.nextDisabled);
  }
});

// ─── Rendered control ────────────────────────────────────────────────────────

test("the control is a labelled navigation landmark", () => {
  assert.match(component, /<nav\s+aria-label=\{label\}/);
  assert.match(component, /label = "Table pagination"/);
});

test("every control carries an accessible label and real disabled state", () => {
  // Previous / Next carry real text labels.
  assert.match(component, />\s*Previous\s*</);
  assert.match(component, />\s*Next\s*</);
  // Numbered buttons are icon-free but numeric, so they get an explicit label.
  assert.match(component, /aria-label=\{`Go to page \$\{p\}`\}/);
  assert.match(component, /aria-current=\{p === state\.page \? "page" : undefined\}/);
  // Boundary state is genuinely disabled, never colour-only.
  assert.match(component, /disabled=\{!state\.canPrevious \|\| isLoading\}/);
  assert.match(component, /disabled=\{!state\.canNext \|\| isLoading\}/);
  // All controls are semantic buttons.
  assert.doesNotMatch(component, /<a\s/);
  assert.equal((component.match(/type="button"/g) ?? []).length, 3);
  // The decorative ellipsis is hidden from assistive technology.
  assert.match(component, /\.\.\.<\/span>/);
  assert.match(component, /aria-hidden="true">\.\.\./);
});

test("the control can collapse when there is nothing to page between, opt-in only", () => {
  assert.match(component, /hideWhenSinglePage = false/);
  assert.match(component, /if \(hideWhenSinglePage && state\.isSinglePage\) return null;/);
});

test("the primitive stays generic — no Editorial or entity-specific coupling", () => {
  // Strip the file's leading doc comment: it *describes* the Editorial wave,
  // but the code itself must know nothing about Editorial or any entity.
  const code = component.replace(/^\/\*\*[\s\S]*?\*\/\n/, "");
  assert.doesNotMatch(code, /editorial|Editorial/);
  assert.doesNotMatch(code, /\bpost\b|\bPost\b|author|topic|placement/i);
  assert.doesNotMatch(code, /@workspace\/api-client-react/);
});

test("it keeps the responsive layout the existing admin tables already use", () => {
  assert.match(component, /flex flex-col gap-3 rounded-md border bg-card px-4 py-3 sm:flex-row/);
});
