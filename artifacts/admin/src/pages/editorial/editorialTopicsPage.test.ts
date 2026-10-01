/**
 * Wave 2.1C — Website → Editorial → Topics screen contract.
 *
 * The page is a `.tsx` that imports `@/` aliases and generated React Query
 * hooks, so it cannot be mounted under `node --test` (there is no
 * jsdom/testing-library anywhere in this workspace). It is therefore asserted
 * by source inspection, the established Admin convention documented in
 * editorialRoutes.test.ts and websiteSettingsLanguagesPage.test.ts. The
 * behaviour that CAN be executed for real — validation, the slug suggestion,
 * filtering and every piece of confirmation copy — lives in
 * lib/editorial-topics.ts and is covered functionally in
 * lib/editorialTopics.test.ts.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("./EditorialTopicsPage.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const nav = readFileSync(new URL("../../components/layout/nav-config.ts", import.meta.url), "utf8");

/**
 * Negative assertions ("this control does not exist") must look at real code,
 * not at prose that merely *describes* the rule — the file header explains
 * why there is no status field, and that sentence must not satisfy a check
 * for the absence of one.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
const pageCode = stripComments(page);

/** The create/edit Dialog region, used for "not in the dialog" assertions. */
const dialogBlock = pageCode.slice(pageCode.indexOf("<Dialog open="));

// ─── Routing / placeholder retirement ────────────────────────────────────────

test("the route and its guard are exactly as Wave 2.1A left them", () => {
  assert.match(app, /editorialTopics: \[\["website\.posts", "view"\]\],/);
  assert.match(
    app,
    /<Route path="\/editorial\/topics">\{guarded\(ROUTE_PERMS\.editorialTopics, <EditorialTopicsPage \/>\)\}<\/Route>/,
  );
});



test("App.tsx binds the real Topics page module", () => {
  // Final Editorial Phase A retired the shared placeholder module entirely,
  // so "not the placeholder file" is now proven by its absence rather than by
  // inspecting an import list that no longer exists.
  assert.match(app, /import EditorialTopicsPage from "@\/pages\/editorial\/EditorialTopicsPage";/);
  assert.doesNotMatch(app, /EditorialPlaceholderPages/);
});

test("navigation is untouched — the Topics link already existed from Wave 2.1A", () => {
  assert.match(nav, /"\/editorial\/topics"/);
  assert.match(nav, /pageTitle: "Editorial Topics"/);
});

// ─── Shell ───────────────────────────────────────────────────────────────────

test("the page renders inside EditorialPageShell without duplicating global page identity", () => {
  assert.match(page, /import \{ EditorialPageShell \} from "@\/components\/editorial\/editorial-page-shell";/);
  assert.match(pageCode, /<EditorialPageShell\s+actions=\{/);
  assert.doesNotMatch(pageCode, /heading="Topics"/);
  assert.match(pageCode, /<\/EditorialPageShell>/);
  // The Add button lives in the shell's actions slot, not in a hand-rolled header.
  assert.match(pageCode, /actions=\{\s*canCreate \?/);
});

// ─── RBAC: TWO flags, not the Languages single-flag pattern ──────────────────

test("in-page gating uses two distinct website.posts permissions", () => {
  assert.match(page, /const canCreate = can\("website\.posts", "create"\);/);
  assert.match(page, /const canEdit = can\("website\.posts", "edit"\);/);
  // Two separate checks, not one collapsed flag.
  assert.equal((pageCode.match(/can\("website\.posts", "(create|edit)"\)/g) ?? []).length, 2);
});

test("canCreate gates the Add button and canEdit gates the row actions", () => {
  assert.match(pageCode, /canCreate \? \(\s*<Button className="gap-2 shrink-0" data-testid="button-add-topic"/);
  assert.match(pageCode, /\{canEdit && \(\s*<>/, "row actions must be wrapped in the canEdit gate");
  // The create dialog is only reachable through the canCreate-gated button.
  assert.doesNotMatch(pageCode, /canEdit && [^)]*button-add-topic/);
});

test("a view-only admin still gets the full list — nothing about fetching or rendering is gated", () => {
  const listBlock = pageCode.slice(pageCode.indexOf("<TableBody>"), pageCode.indexOf("</TableBody>"));
  assert.doesNotMatch(listBlock, /canEdit \?/, "rows must not be hidden from view-only admins");
  assert.doesNotMatch(listBlock, /canCreate \?/);
  assert.doesNotMatch(pageCode, /if \(!can(Edit|Create)\) return/);
  assert.doesNotMatch(pageCode, /useListEditorialTopics\([^)]*can(Edit|Create)/);
});

test("this wave grants no permission to any role", () => {
  assert.doesNotMatch(pageCode, /permissions\s*[:=]/);
});

// ─── Cache alignment — THE load-bearing invariant of this wave ───────────────

test("the list hook is called with NO params, so the cache entry matches useEditorialReferenceData", () => {
  assert.match(
    pageCode,
    /const \{ data: rows, isLoading, isError \} = useListEditorialTopics\(\);/,
    "useListEditorialTopics must be called with no arguments at all",
  );
  assert.doesNotMatch(pageCode, /useListEditorialTopics\(\s*\{/, "no params object may be passed");
  assert.doesNotMatch(pageCode, /useListEditorialTopics\([^)]+\)/, "no argument of any kind may be passed");
});

test("every mutation invalidates with the key builder called with NO arguments", () => {
  assert.match(
    pageCode,
    /queryClient\.invalidateQueries\(\{ queryKey: getListEditorialTopicsQueryKey\(\) \}\)/,
    "invalidation must use the no-argument key builder (prefix match)",
  );
  assert.doesNotMatch(
    pageCode,
    /getListEditorialTopicsQueryKey\([^)]+\)/,
    "passing params to the key builder would fragment the reference-data cache",
  );
  // Exactly one invalidation helper, used by every mutation path.
  // create, edit, archive, reactivate — every mutation path.
  assert.equal((pageCode.match(/\binvalidateTopics\(\);/g) ?? []).length, 4);
});

test("filtering is client-side over the complete array — that is what makes the no-params call possible", () => {
  assert.match(pageCode, /filterTopics\(rows \?\? \[\], filters\)/);
  assert.doesNotMatch(pageCode, /channel: channelFilter[^}]*\}\s*\)\s*;?\s*\/\/ query/);
});

test("no mutation on this page touches another entity's cache", () => {
  assert.doesNotMatch(pageCode, /getListEditorialAuthorsQueryKey/);
  assert.doesNotMatch(pageCode, /getListEditorialLanguagesQueryKey/);
  assert.doesNotMatch(pageCode, /getListEditorialPostsQueryKey/);
});

test("the global QueryClient is untouched", () => {
  assert.doesNotMatch(pageCode, /new QueryClient/);
  assert.doesNotMatch(pageCode, /staleTime/);
});

// ─── No delete, ever ─────────────────────────────────────────────────────────

test("there is no delete control anywhere on this screen", () => {
  assert.doesNotMatch(pageCode, /useDelete/);
  assert.doesNotMatch(pageCode, /Trash/);
  assert.doesNotMatch(pageCode, /\bDelete\b/);
  assert.doesNotMatch(pageCode, /destructive"\s*>\s*Remove/);
});

// ─── Lifecycle is a row action, never a dialog field ────────────────────────

test("the create/edit dialog contains no status control", () => {
  assert.doesNotMatch(dialogBlock, /status/i, "status must not appear anywhere inside the dialog");
});

test("archive and reactivate are row actions on the generic PATCH", () => {
  assert.match(pageCode, /data: \{ status: "archived" \}/);
  assert.match(pageCode, /data: \{ status: "active" \}/);
  assert.match(pageCode, /aria-label=\{`Archive \$\{topic\.name\}`\}/);
  assert.match(pageCode, /aria-label=\{`Reactivate \$\{topic\.name\}`\}/);
});

test("archiving goes through the shared confirm with the lib's non-destructive copy", () => {
  assert.match(pageCode, /await confirmAction\(archiveTopicConfirmation\(topic\)\)/);
  assert.doesNotMatch(pageCode, /window\.confirm/);
  // The copy object (including destructive: false) is owned by the tested lib,
  // never inlined here.
  assert.doesNotMatch(pageCode, /confirmAction\(\s*\{/);
});

test("reactivating needs no confirm — it is non-destructive and immediately reversible", () => {
  const reactivate = pageCode.slice(
    pageCode.indexOf("const handleReactivate"),
    pageCode.indexOf("const saving"),
  );
  assert.doesNotMatch(reactivate, /confirmAction/);
});

// ─── Channel immutability ────────────────────────────────────────────────────

test("channel is a Select on create and readOnly+disabled on edit, with the fixed explanation", () => {
  assert.match(pageCode, /<SelectTrigger id="topic-channel"/);
  assert.match(pageCode, /id="topic-channel"[\s\S]{0,200}?readOnly\s+disabled/);
  assert.match(pageCode, /\{TOPIC_CHANNEL_IMMUTABLE_EXPLANATION\}/);
  // The update payload never carries a channel.
  assert.doesNotMatch(pageCode, /updateTopic\.mutate\([\s\S]{0,200}channel:/);
});

// ─── Slug: suggestion (D5) and the verbatim 409 (D6) ─────────────────────────

test("the slug suggestion state machine is delegated to the tested pure function", () => {
  assert.match(pageCode, /nextSlugForNameChange\(/);
  assert.match(pageCode, /const \[slugTouched, setSlugTouched\] = useState\(false\);/);
  assert.match(pageCode, /const handleSlugChange = \(nextSlug: string\) => \{\s*setSlugTouched\(true\);/);
  // Editing an existing topic starts "touched", so a name change never
  // rewrites a live slug.
  assert.match(pageCode, /setSlugTouched\(true\);[\s\S]{0,120}setDialog\(\{ kind: "edit"/);
  assert.match(pageCode, /isCreate \? "create" : "edit"/);
});

test("a 409 is rendered verbatim INLINE under the slug field, not rewritten and not only a toast", () => {
  assert.match(pageCode, /if \(status === 409\) \{\s*setSlugConflict\(message\);/);
  assert.match(pageCode, /id="topic-slug-help"/);
  assert.match(pageCode, /\{errors\.slug \?\? slugConflict \?\?/);
  assert.match(pageCode, /aria-describedby="topic-slug-help"/);
  // The backend's wording is never special-cased or corrected client-side.
  assert.doesNotMatch(pageCode, /already in use for this channel/);
  assert.doesNotMatch(pageCode, /replace\(\s*\/language/);
});

test("both create and edit route their 409 to the slug field", () => {
  assert.equal((pageCode.match(/setSlugConflict\(message\)/g) ?? []).length, 2);
});

// ─── Table / states ──────────────────────────────────────────────────────────

test("the table has six columns and every placeholder state spans all of them", () => {
  const header = pageCode.slice(pageCode.indexOf("<TableHeader>"), pageCode.indexOf("</TableHeader>"));
  assert.equal((header.match(/<TableHead[ >]/g) ?? []).length, 6);
  assert.equal((pageCode.match(/colSpan=\{6\}/g) ?? []).length, 3, "loading, error and empty states");
  assert.doesNotMatch(pageCode, /colSpan=\{(?!6\})/);
});

test("loading, error and empty states each occupy a single cell inside a real row", () => {
  assert.match(pageCode, /isLoading \? \(\s*<TableRow>\s*<TableCell colSpan=\{6\}/);
  assert.match(pageCode, /isError \? \(\s*<TableRow>\s*<TableCell colSpan=\{6\}[^>]*text-destructive/);
  assert.match(pageCode, /No topics yet\./);
  assert.match(pageCode, /No topics match the current search and filters\./);
});

test("state is conveyed by words, not by colour alone", () => {
  assert.match(pageCode, /topic\.status === "active" \? "Active" : "Archived"/);
  assert.match(pageCode, /\{channelLabel\(topic\.channel\)\}/);
});

// ─── Toolbar / filters ───────────────────────────────────────────────────────

test("search is debounced and the State filter defaults to All (D2)", () => {
  assert.match(page, /import \{ TableToolbar \} from "@\/components\/admin\/table-toolbar";/);
  assert.match(pageCode, /useDebouncedValue\(search, \d+\)/);
  assert.match(pageCode, /useState<StatusFilter>\(DEFAULT_TOPIC_FILTERS\.status\)/);
  assert.match(pageCode, /useState<ChannelFilter>\(DEFAULT_TOPIC_FILTERS\.channel\)/);
  assert.match(pageCode, /\{ value: "all", label: "All" \}/);
});

// ─── Accessibility / responsive ──────────────────────────────────────────────

test("icon-only buttons carry accessible names and every decorative glyph is hidden", () => {
  assert.match(pageCode, /aria-label=\{`Edit \$\{topic\.name\}`\}/);
  assert.equal(
    (pageCode.match(/aria-hidden="true"/g) ?? []).length,
    (pageCode.match(/<(Plus|Pencil|Archive|RotateCcw) /g) ?? []).length,
  );
});

test("every form field has a Label, and errors are wired through aria-describedby", () => {
  for (const id of ["topic-channel", "topic-name", "topic-slug"]) {
    assert.match(pageCode, new RegExp(`<Label htmlFor="${id}">`));
  }
  assert.match(pageCode, /aria-invalid=\{Boolean\(errors\.name\) \|\| undefined\}/);
  assert.match(pageCode, /aria-invalid=\{Boolean\(errors\.slug \|\| slugConflict\) \|\| undefined\}/);
  assert.match(pageCode, /<form onSubmit=\{handleSubmit\} noValidate>/);
});

test("the table scrolls horizontally and the dialog is width-constrained on narrow screens", () => {
  assert.match(pageCode, /<div className="border rounded-md overflow-x-auto">/);
  assert.match(pageCode, /<DialogContent className="sm:max-w-lg">/);
});

test("the save button reports a pending state", () => {
  assert.match(pageCode, /const saving = createTopic\.isPending \|\| updateTopic\.isPending;/);
  assert.match(pageCode, /disabled=\{saving\} data-testid="button-save-topic"/);
});

// ─── Wave 2.1B regression ────────────────────────────────────────────────────

test("the Wave 2.1B Languages screen is not referenced or refactored by this page", () => {
  assert.doesNotMatch(page, /editorial-languages/);
  assert.doesNotMatch(page, /WebsiteSettingsLanguagesPage/);
});
