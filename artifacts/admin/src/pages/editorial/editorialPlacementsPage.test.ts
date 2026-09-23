/**
 * Final Editorial, Phase A — Website → Editorial → Placements screen contract.
 *
 * The page is a `.tsx` that imports `@/` aliases and generated React Query
 * hooks, so it cannot be mounted under `node --test` (there is no
 * jsdom/testing-library anywhere in this workspace). It is therefore asserted
 * by source inspection, the established Admin convention documented in
 * editorialRoutes.test.ts, editorialTopicsPage.test.ts and
 * editorialPostsPages.test.ts. The behaviour that CAN be executed for real —
 * slot identity, validation, candidate scoping, ordering, the dirty rule and
 * the PUT payload — lives in lib/editorial-placements.ts and is covered
 * functionally in lib/editorialPlacements.test.ts.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("./EditorialPlacementsPage.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const nav = readFileSync(new URL("../../components/layout/nav-config.ts", import.meta.url), "utf8");
const route = readFileSync(
  new URL("../../../../api-server/src/routes/adminEditorial.ts", import.meta.url),
  "utf8",
);

/**
 * Negative assertions ("this control does not exist") must look at real code,
 * not at prose that merely *describes* the rule — the file header explains at
 * length why there is no backend change and no drag-and-drop, and those
 * sentences must not satisfy a check for the absence of either.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
const pageCode = stripComments(page);

// ─── Routing / placeholder retirement ────────────────────────────────────────

test("the route and its guard are exactly as Wave 2.1A left them", () => {
  assert.match(app, /editorialPlacements: \[\["website\.posts", "view"\]\],/);
  assert.match(
    app,
    /<Route path="\/editorial\/placements">\{guarded\(ROUTE_PERMS\.editorialPlacements, <EditorialPlacementsPage \/>\)\}<\/Route>/,
  );
});

test("App.tsx binds the real Placements page module, and the placeholder is gone", () => {
  assert.match(app, /import EditorialPlacementsPage from "@\/pages\/editorial\/EditorialPlacementsPage";/);
  assert.doesNotMatch(app, /EditorialPlaceholderPages/);
});

test("navigation is untouched — the Placements link already existed from Wave 2.1A", () => {
  assert.match(nav, /"\/editorial\/placements"/);
  assert.match(nav, /pageTitle: "Editorial Placements"/);
});

// ─── Shell ───────────────────────────────────────────────────────────────────

test("the page renders inside EditorialPageShell so it carries the coexistence banner", () => {
  assert.match(page, /import \{ EditorialPageShell \} from "@\/components\/editorial\/editorial-page-shell";/);
  assert.match(pageCode, /<EditorialPageShell heading="Placements"/);
  assert.match(pageCode, /<\/EditorialPageShell>/);
});

// ─── NO BACKEND EXPANSION ────────────────────────────────────────────────────

test("the screen sits on EXACTLY the two pre-existing placement routes — nothing new", () => {
  // Both routes predate this work; the page only consumes their generated
  // hooks. If a third placement route ever appeared, this would catch it.
  assert.match(route, /router\.get\(\s*"\/admin\/editorial\/placements"/);
  assert.match(route, /router\.put\(\s*"\/admin\/editorial\/placements"/);
  assert.equal((route.match(/"\/admin\/editorial\/placements"/g) ?? []).length, 2);
  assert.match(pageCode, /useGetEditorialPlacement,/);
  assert.match(pageCode, /useReplaceEditorialPlacement,/);
});

// ─── RBAC ────────────────────────────────────────────────────────────────────

test("in-page gating uses website.posts:edit, matching the PUT route's own permission", () => {
  assert.match(pageCode, /const canEdit = can\("website\.posts", "edit"\);/);
  // Exactly one permission flag — the route guard already covers :view.
  assert.equal((pageCode.match(/can\("website\.[a-z]+", "[a-z]+"\)/g) ?? []).length, 1);
  assert.match(route, /requireAdminPermission\("website\.posts", "edit"\)/);
  assert.match(route, /requireAdminPermission\("website\.posts", "view"\)/);
});

test("a view-only admin still sees the slot's contents — only the WRITE controls are gated", () => {
  // The list itself is rendered unconditionally.
  const listBlock = pageCode.slice(pageCode.indexOf("<ul ref={listRef}"), pageCode.indexOf("</ul>"));
  assert.doesNotMatch(listBlock, /canEdit \?/, "rows must not be hidden from view-only admins");
  // Row actions, the candidate picker and Save are all behind canEdit.
  assert.match(pageCode, /\{canEdit && \(\s*<>/);
  assert.match(pageCode, /\{canEdit && !placement\.isError && \(/);
  assert.match(pageCode, /\{canEdit \? \(/);
  assert.match(pageCode, /data-testid="placements-read-only"/);
});

test("save() refuses to fire without canEdit, so the gate is not only visual", () => {
  assert.match(pageCode, /const save = \(\) => \{\s*if \(!canEdit \|\| !dirty \|\| saving\) return;/);
});

// ─── Scoped-save honesty: ONE PUT, and only from the Save button ─────────────

test("exactly ONE mutation call exists, and it is bound to the Save button", () => {
  assert.equal((pageCode.match(/replacePlacement\.mutate\(/g) ?? []).length, 1);
  assert.match(pageCode, /data-testid="button-save-placement"\s*\n\s*onClick=\{save\}/);
});

test("add, remove and move are LOCAL edits — no mutation is reachable from any of them", () => {
  // Each handler sets local state only.
  assert.match(pageCode, /onClick=\{\(\) => setSelected\(addPlacement\(selected, item\.post\.id\)\)\}/);
  assert.match(pageCode, /const remove = \(postId: number\) => \{/);
  assert.match(pageCode, /const move = \(index: number, direction: "up" \| "down"\) => \{/);
  for (const handler of ["const remove = ", "const move = "]) {
    const start = pageCode.indexOf(handler);
    const body = pageCode.slice(start, pageCode.indexOf("\n  };", start));
    assert.doesNotMatch(body, /mutate\(/, `${handler.trim()} must not write to the server`);
  }
});

test("the Save button is disabled unless there is a real, saveable change", () => {
  assert.match(pageCode, /disabled=\{!dirty \|\| saving \|\| placement\.isError\}/);
});

// ─── No accidental global invalidation ───────────────────────────────────────

test("a save invalidates ONLY this slot's query key — never the whole cache", () => {
  assert.equal((pageCode.match(/invalidateQueries\(/g) ?? []).length, 1);
  assert.match(
    pageCode,
    /invalidateQueries\(\{\s*queryKey: getGetEditorialPlacementQueryKey\(\{ channel, key: loadedKey \}\),\s*\}\)/,
  );
  // The catch-all forms that would blow away unrelated Editorial caches.
  assert.doesNotMatch(pageCode, /invalidateQueries\(\)/);
  assert.doesNotMatch(pageCode, /queryClient\.clear\(\)/);
  assert.doesNotMatch(pageCode, /resetQueries\(/);
  assert.doesNotMatch(pageCode, /invalidateQueries\(\{\s*queryKey: \[\]/);
});

// ─── Slot identity is (channel, key) ─────────────────────────────────────────

test("every read and every write carries BOTH channel and key", () => {
  assert.match(pageCode, /useGetEditorialPlacement\(\s*\{ channel, key: loadedKey \}/);
  assert.match(pageCode, /params: \{ key: loadedKey \}/);
  assert.match(pageCode, /data: toPlacementPayload\(channel, selected\)/);
});

test("the slot key is a FREE-TEXT input with a datalist, never a Select over invented names", () => {
  assert.match(pageCode, /<Input\s+id="placement-key"/);
  assert.match(pageCode, /<datalist id="placement-key-suggestions">/);
  // A Select exists on this page — for the CHANNEL, which genuinely is a
  // closed union — but not for the key.
  assert.match(pageCode, /<SelectTrigger id="placement-channel"/);
  const keyBlock = pageCode.slice(pageCode.indexOf('htmlFor="placement-key"'), pageCode.indexOf("Load slot"));
  assert.doesNotMatch(keyBlock, /<Select/);
});

test("changing the key draft does not refetch until Load slot is pressed", () => {
  assert.match(pageCode, /const \[loadedKey, setLoadedKey\] = useState\("featured"\);/);
  assert.match(pageCode, /const loadSlot = \(\) => \{\s*if \(keyProblem\) return;/);
  assert.match(pageCode, /data-testid="button-load-placement"/);
  // The query is keyed on loadedKey, not on the draft.
  assert.doesNotMatch(pageCode, /useGetEditorialPlacement\(\s*\{ channel, key: keyDraft \}/);
  assert.match(pageCode, /enabled: loadedKey\.trim\(\)\.length > 0/);
});

// ─── The candidate picker ────────────────────────────────────────────────────

test("the picker is channel-scoped and opt-in, so opening the page costs no search", () => {
  assert.match(pageCode, /toPlacementCandidateQuery\(\{ channel, search: debounced, publishedOnly \}\)/);
  assert.match(pageCode, /enabled: pickerOpen \|\| debounced\.trim\(\)\.length > 0/);
  assert.match(pageCode, /useDebouncedValue\(search, 250\)/);
});

test("candidates already in the slot are filtered out of the picker", () => {
  assert.match(pageCode, /const options = filterPlacementCandidates\(candidateItems, selected\);/);
});

test("a SAVED row shows no invented status, while a CANDIDATE row shows its real one", () => {
  // The placements response carries no status, so a saved row must not
  // borrow one from unrelated search activity in the same session.
  assert.match(pageCode, /annotation: null,/);
  assert.match(pageCode, /const state = postStateAnnotation\(item\.translations\);/);
  assert.match(pageCode, /data-testid=\{`placement-candidate-state-\$\{item\.post\.id\}`\}/);
});

// ─── Errors are the server's ─────────────────────────────────────────────────

test("a rejected save renders the SERVER's wording verbatim — nothing is predicted client-side", () => {
  assert.match(pageCode, /setSaveError\(editorialErrorMessage\(err\)\)/);
  assert.match(pageCode, /data-testid="placements-error-alert"/);
  // The cross-channel and duplicate-post rules belong to the server; this
  // page must not restate either as its own message.
  assert.doesNotMatch(pageCode, /cannot be placed in/i);
  assert.doesNotMatch(pageCode, /already in this slot/i);
});

// ─── Accessibility ───────────────────────────────────────────────────────────

test("reordering is keyboard-operable buttons with labels, not drag-and-drop", () => {
  assert.match(pageCode, /aria-label=\{`Move \$\{info\.label\} up`\}/);
  assert.match(pageCode, /aria-label=\{`Move \$\{info\.label\} down`\}/);
  assert.match(pageCode, /aria-label=\{`Remove \$\{info\.label\} from this slot`\}/);
  assert.doesNotMatch(pageCode, /draggable/);
  assert.doesNotMatch(pageCode, /onDragStart|onDrop/);
});

test("a move or a removal is ANNOUNCED through a polite live region", () => {
  assert.match(pageCode, /role="status" aria-live="polite" data-testid="placements-announcer"/);
  assert.match(pageCode, /setAnnouncement\(placementMoveAnnouncement\(/);
  assert.match(pageCode, /role="status" aria-live="polite" data-testid="placement-results-count"/);
});

test("focus is moved deliberately after a removal, so the keyboard is never stranded", () => {
  assert.match(pageCode, /\[data-remove-placement\]/);
  assert.match(pageCode, /input-placement-search'\]"\)\?\.focus\(\)/);
});

test("every control that can carry an error is wired to its message", () => {
  assert.match(pageCode, /aria-invalid=\{Boolean\(keyProblem\) \|\| undefined\}/);
  assert.match(pageCode, /aria-describedby="placement-key-help"/);
  assert.match(pageCode, /id="placement-key-help"/);
  assert.match(pageCode, /<Label htmlFor="placement-channel">/);
  assert.match(pageCode, /<Label htmlFor="placement-key">/);
  assert.match(pageCode, /aria-label="Search posts to place in this slot"/);
});

test("the two sections are landmarked and the RTL-capable labels use dir=\"auto\"", () => {
  assert.match(pageCode, /aria-label="Choose a slot"/);
  assert.match(pageCode, /aria-label=\{`Slot \$\{slot\}`\}/);
  assert.equal((pageCode.match(/dir="auto"/g) ?? []).length, 2, "both the saved row and the candidate row");
});

// ─── Responsive ──────────────────────────────────────────────────────────────

test("the slot selector collapses to one column on a narrow viewport", () => {
  assert.match(pageCode, /grid gap-3 rounded-md border border-border bg-card p-3 sm:grid-cols-\[12rem_1fr_auto\]/);
  assert.match(pageCode, /flex flex-wrap items-center justify-between gap-2/);
  assert.match(pageCode, /max-h-48 space-y-1 overflow-y-auto/);
});

// ─── Honesty ─────────────────────────────────────────────────────────────────

test("the screen states plainly that a placement is not public yet", () => {
  assert.match(pageCode, /data-testid="placements-not-public-note"/);
  assert.match(pageCode, /\{PLACEMENTS_NOT_PUBLIC_YET_NOTE\}/);
  assert.match(pageCode, /\{PLACEMENTS_LIFECYCLE_NOTE\}/);
});
