/**
 * Wave 2.1C — Website → Editorial → Authors screen contract.
 *
 * The page is a `.tsx` that imports `@/` aliases and generated React Query
 * hooks, so it cannot be mounted under `node --test` (there is no
 * jsdom/testing-library anywhere in this workspace). It is therefore asserted
 * by source inspection, the established Admin convention. The behaviour that
 * CAN be executed for real — validation, payload mapping, byline readiness,
 * filtering and every piece of copy — lives in lib/editorial-authors.ts and is
 * covered functionally in lib/editorialAuthors.test.ts.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("./EditorialAuthorsPage.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const nav = readFileSync(new URL("../../components/layout/nav-config.ts", import.meta.url), "utf8");

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
const pageCode = stripComments(page);

/** The create/edit Dialog region, used for "not in the dialog" assertions. */
const dialogBlock = pageCode.slice(pageCode.indexOf("<Dialog open="));

// ─── Routing / placeholder retirement ────────────────────────────────────────

test("the route and its guard are exactly as Wave 2.1A left them", () => {
  assert.match(app, /editorialAuthors: \[\["website\.posts", "view"\]\],/);
  assert.match(
    app,
    /<Route path="\/editorial\/authors">\{guarded\(ROUTE_PERMS\.editorialAuthors, <EditorialAuthorsPage \/>\)\}<\/Route>/,
  );
});



test("App.tsx binds the real Authors page module", () => {
  // Final Editorial Phase A retired the shared placeholder module entirely.
  assert.match(app, /import EditorialAuthorsPage from "@\/pages\/editorial\/EditorialAuthorsPage";/);
  assert.doesNotMatch(app, /EditorialPlaceholderPages/);
});

test("navigation is untouched — the Authors link already existed from Wave 2.1A", () => {
  assert.match(nav, /"\/editorial\/authors"/);
  assert.match(nav, /pageTitle: "Editorial Authors"/);
});

// ─── Shell ───────────────────────────────────────────────────────────────────

test("the page renders inside EditorialPageShell without duplicating global page identity", () => {
  assert.match(page, /import \{ EditorialPageShell \} from "@\/components\/editorial\/editorial-page-shell";/);
  assert.match(pageCode, /<EditorialPageShell\s+actions=\{/);
  assert.doesNotMatch(pageCode, /heading="Authors"/);
  assert.match(pageCode, /<\/EditorialPageShell>/);
  assert.match(pageCode, /actions=\{\s*canCreate \?/);
});

// ─── RBAC: TWO flags gating DIFFERENT things ────────────────────────────────
// This is the one meaningfully different contract versus Topics/Languages:
// website.posts genuinely separates create from edit, so a single collapsed
// flag (the Wave 2.1B Languages shape) would wrongly show an Add button to an
// admin who may edit but not create.

test("in-page gating uses two distinct website.posts permissions", () => {
  assert.match(page, /const canCreate = can\("website\.posts", "create"\);/);
  assert.match(page, /const canEdit = can\("website\.posts", "edit"\);/);
  assert.equal(
    (pageCode.match(/can\("website\.posts", "(create|edit)"\)/g) ?? []).length,
    2,
    "exactly two permission checks — not one collapsed flag, not a third family",
  );
  assert.doesNotMatch(pageCode, /can\("(?!website\.posts")/, "no second permission family may be consulted");
});

test("canCreate gates ONLY the Add button, canEdit gates ONLY the row actions", () => {
  assert.match(pageCode, /canCreate \? \(\s*<Button className="gap-2 shrink-0" data-testid="button-add-author"/);
  assert.match(pageCode, /\{canEdit && \(\s*<>/, "row actions must be wrapped in the canEdit gate");
  // The two flags must not be conflated in either direction.
  assert.doesNotMatch(pageCode, /canEdit \? \(\s*<Button className="gap-2 shrink-0" data-testid="button-add-author"/);
  assert.doesNotMatch(pageCode, /\{canCreate && \(\s*<>/);
  assert.doesNotMatch(pageCode, /canCreate \|\| canEdit|canEdit \|\| canCreate/);
  assert.doesNotMatch(pageCode, /const canEdit = canCreate|const canCreate = canEdit/);
});

test("a view-only admin still gets the full list — nothing about fetching or rendering is gated", () => {
  const listBlock = pageCode.slice(pageCode.indexOf("<TableBody>"), pageCode.indexOf("</TableBody>"));
  assert.doesNotMatch(listBlock, /canEdit \?/, "rows must not be hidden from view-only admins");
  assert.doesNotMatch(listBlock, /canCreate \?/);
  assert.doesNotMatch(pageCode, /if \(!can(Edit|Create)\) return/);
  assert.doesNotMatch(pageCode, /useListEditorialAuthors\([^)]*can(Edit|Create)/);
});

test("this wave grants no permission to any role", () => {
  assert.doesNotMatch(pageCode, /permissions\s*[:=]/);
  assert.doesNotMatch(pageCode, /isSuperAdmin/);
});

// ─── systemUserId is absent everywhere (D1) ─────────────────────────────────

test("systemUserId is not exposed anywhere — no field, no picker, no read-only display", () => {
  assert.doesNotMatch(pageCode, /systemUserId/);
  assert.doesNotMatch(pageCode, /system_user/i);
  // And no cross-family fetch of the admin directory was introduced.
  assert.doesNotMatch(pageCode, /api\/admin\/users/);
  assert.doesNotMatch(pageCode, /adminUsers/);
});

// ─── Cache alignment — THE load-bearing invariant of this wave ──────────────

test("the list hook is called with NO params, so the cache entry matches useEditorialReferenceData", () => {
  assert.match(
    pageCode,
    /const \{ data: rows, isLoading, isError \} = useListEditorialAuthors\(\);/,
    "useListEditorialAuthors must be called with no arguments at all",
  );
  assert.doesNotMatch(pageCode, /useListEditorialAuthors\(\s*\{/, "no params object may be passed");
  assert.doesNotMatch(pageCode, /useListEditorialAuthors\([^)]+\)/, "no argument of any kind may be passed");
});

test("every mutation invalidates with the key builder called with NO arguments", () => {
  assert.match(
    pageCode,
    /queryClient\.invalidateQueries\(\{ queryKey: getListEditorialAuthorsQueryKey\(\) \}\)/,
    "invalidation must use the no-argument key builder (prefix match)",
  );
  assert.doesNotMatch(
    pageCode,
    /getListEditorialAuthorsQueryKey\([^)]+\)/,
    "passing params to the key builder would fragment the reference-data cache",
  );
  // create, edit, archive, reactivate — every mutation path.
  assert.equal((pageCode.match(/\binvalidateAuthors\(\);/g) ?? []).length, 4);
});

test("filtering is client-side over the complete array — that is what makes the no-params call possible", () => {
  assert.match(pageCode, /filterAuthors\(rows \?\? \[\], filters\)/);
});

test("no mutation on this page touches another entity's cache", () => {
  assert.doesNotMatch(pageCode, /getListEditorialTopicsQueryKey/);
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
});

// ─── Lifecycle is a row action, never a dialog field ────────────────────────

test("the create/edit dialog contains no status control", () => {
  assert.doesNotMatch(dialogBlock, /status/i, "status must not appear anywhere inside the dialog");
});

test("archive and reactivate are row actions on the generic PATCH", () => {
  assert.match(pageCode, /data: \{ status: "archived" \}/);
  assert.match(pageCode, /data: \{ status: "active" \}/);
  assert.match(pageCode, /aria-label=\{`Archive \$\{author\.publicName\}`\}/);
  assert.match(pageCode, /aria-label=\{`Reactivate \$\{author\.publicName\}`\}/);
});

test("archiving goes through the shared confirm with the lib's non-destructive copy", () => {
  assert.match(pageCode, /await confirmAction\(archiveAuthorConfirmation\(author\)\)/);
  assert.doesNotMatch(pageCode, /window\.confirm/);
  assert.doesNotMatch(pageCode, /confirmAction\(\s*\{/, "copy (incl. destructive: false) is owned by the tested lib");
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
  assert.match(pageCode, /<SelectTrigger id="author-channel"/);
  assert.match(pageCode, /id="author-channel"[\s\S]{0,200}?readOnly\s+disabled/);
  assert.match(pageCode, /\{AUTHOR_CHANNEL_IMMUTABLE_EXPLANATION\}/);
});

test("the update payload is built by the tested mapper and never carries channel or status", () => {
  const update = pageCode.slice(pageCode.indexOf("updateAuthor.mutate("), pageCode.indexOf("const handleArchive"));
  assert.match(update, /data: toAuthorUpdatePayload\(form, target\)/);
  assert.doesNotMatch(update, /\bchannel:/);
  assert.doesNotMatch(update, /\bstatus:/);
});

test("the create payload is built by the tested mapper, so an empty biography becomes null", () => {
  assert.match(pageCode, /\{ data: toAuthorCreatePayload\(form\) \}/);
  // No hand-rolled payload that could send "" instead of null.
  assert.doesNotMatch(pageCode, /biography: form\.biography/);
  assert.doesNotMatch(pageCode, /avatarUrl: form\.avatarUrl/);
});

// ─── Byline column (D3) ──────────────────────────────────────────────────────

test("the Byline column is derived by the tested pure functions", () => {
  assert.match(pageCode, /<TableHead>Byline<\/TableHead>/);
  assert.match(pageCode, /\{bylineStatusLabel\(author\)\}/);
  assert.match(pageCode, /bylineState\(author\) === "ready" \? "default" : "outline"/);
  assert.match(pageCode, /data-testid=\{`badge-byline-author-\$\{author\.id\}`\}/);
  // The derivation is never re-implemented inline.
  assert.doesNotMatch(pageCode, /author\.biography[^)]*trim\(\)\.length/);
});

test("nothing on this screen is labelled globally publish-ready", () => {
  assert.doesNotMatch(pageCode, /publish-ready/i);
  assert.doesNotMatch(pageCode, /Publish ready/i);
  assert.match(pageCode, /\{BYLINE_COLUMN_EXPLANATION\}/);
});

test("the biography field is optional and carries the byline-scoped helper text", () => {
  assert.match(pageCode, /<Textarea\s+id="author-biography"/);
  assert.match(pageCode, /\{AUTHOR_BIOGRAPHY_HELP\}/);
  // Optional means no required marker and no validation error slot.
  assert.doesNotMatch(pageCode, /errors\.biography/);
  assert.doesNotMatch(pageCode, /aria-invalid=\{Boolean\(errors\.biography\)/);
});

// ─── Frozen byline (edit only) ───────────────────────────────────────────────

test("the frozen-byline notice is rendered persistently on EDIT and never on create", () => {
  assert.match(pageCode, /\{!isCreate && \(/);
  assert.match(pageCode, /data-testid="author-frozen-byline-notice"/);
  assert.match(pageCode, /\{AUTHOR_FROZEN_BYLINE_NOTICE\}/);
  const notice = pageCode.slice(
    pageCode.indexOf("{!isCreate && ("),
    pageCode.indexOf('<div className="grid gap-4 py-4">'),
  );
  assert.match(notice, /AUTHOR_FROZEN_BYLINE_NOTICE/, "the notice must sit in the edit-only branch");
  // Not a dismissible toast — it stays on screen while the form is open.
  assert.doesNotMatch(notice, /onClick|useState/);
});

// ─── Avatar / media ──────────────────────────────────────────────────────────

test("the avatar field has a preview image that is decorative", () => {
  assert.match(pageCode, /data-testid="author-avatar-preview"/);
  assert.match(pageCode, /src=\{avatarPreview\}\s*\n\s*alt=""/);
  // The list cell's avatar is decorative too — the name is adjacent.
  assert.match(pageCode, /src=\{author\.avatarUrl\}\s*\n\s*alt=""/);
});

test("a media-validation 400 is rendered verbatim INLINE under the avatar field", () => {
  assert.match(pageCode, /if \(status === 400 && isAvatarMediaError\(message, form\.avatarUrl\)\) \{\s*setAvatarServerError\(message\);/);
  assert.match(pageCode, /id="author-avatar-url-help"/);
  assert.match(pageCode, /\{errors\.avatarUrl \?\? avatarServerError \?\?/);
  assert.match(pageCode, /aria-describedby="author-avatar-url-help"/);
  // Both create and edit route through the same handler.
  assert.equal((pageCode.match(/onError: routeMutationError\(/g) ?? []).length, 2);
});

test("a 400 is routed to the avatar field only by the server's own url-prefixed message — never merely because the avatar field is non-empty", () => {
  // The old, imprecise heuristic (any 400 + a non-empty avatar field) must
  // be genuinely gone, not just no-longer-the-primary-path.
  assert.doesNotMatch(pageCode, /form\.avatarUrl\.trim\(\)\.length > 0/);
  assert.match(pageCode, /isAvatarMediaError/);
  // The classifier is imported from the lib module, not reimplemented here.
  assert.match(pageCode, /isAvatarMediaError,?\s*\n/); // present in the import block
});

test("the client does a shape check only — the host allowlist never blocks a save", () => {
  assert.match(pageCode, /\?\? AUTHOR_AVATAR_ALLOWED_HOSTS_HINT\}/);
  // No allowlist array is reimplemented on the page.
  assert.doesNotMatch(pageCode, /picsum\.photos/);
  assert.doesNotMatch(pageCode, /ALLOWED_MEDIA_HOSTS/);
});

test("the save button reports a pending state — avatar validation is slow server-side", () => {
  assert.match(pageCode, /const saving = createAuthor\.isPending \|\| updateAuthor\.isPending;/);
  assert.match(pageCode, /disabled=\{saving\} data-testid="button-save-author"/);
  assert.match(pageCode, /saving \? "Saving…"/);
});

// ─── Table / states ──────────────────────────────────────────────────────────

test("the table has eight columns and every placeholder state spans all of them", () => {
  const header = pageCode.slice(pageCode.indexOf("<TableHeader>"), pageCode.indexOf("</TableHeader>"));
  assert.equal((header.match(/<TableHead[ >]/g) ?? []).length, 8);
  assert.equal((pageCode.match(/colSpan=\{8\}/g) ?? []).length, 3, "loading, error and empty states");
  assert.doesNotMatch(pageCode, /colSpan=\{(?!8\})/);
});

test("loading, error and empty states each occupy a single cell inside a real row", () => {
  assert.match(pageCode, /isLoading \? \(\s*<TableRow>\s*<TableCell colSpan=\{8\}/);
  assert.match(pageCode, /isError \? \(\s*<TableRow>\s*<TableCell colSpan=\{8\}[^>]*text-destructive/);
  assert.match(pageCode, /No authors yet\./);
  assert.match(pageCode, /No authors match the current search and filters\./);
});

test("state is conveyed by words, not by colour alone", () => {
  assert.match(pageCode, /author\.status === "active" \? "Active" : "Archived"/);
  assert.match(pageCode, /\{channelLabel\(author\.channel\)\}/);
});

// ─── Toolbar / filters ───────────────────────────────────────────────────────

test("search is debounced and the State filter defaults to All (D2)", () => {
  assert.match(page, /import \{ TableToolbar \} from "@\/components\/admin\/table-toolbar";/);
  assert.match(pageCode, /useDebouncedValue\(search, \d+\)/);
  assert.match(pageCode, /useState<StatusFilter>\(DEFAULT_AUTHOR_FILTERS\.status\)/);
  assert.match(pageCode, /useState<ChannelFilter>\(DEFAULT_AUTHOR_FILTERS\.channel\)/);
  assert.match(pageCode, /\{ value: "all", label: "All" \}/);
});

// ─── Accessibility / responsive ──────────────────────────────────────────────

test("icon-only buttons carry accessible names and every decorative glyph is hidden", () => {
  assert.match(pageCode, /aria-label=\{`Edit \$\{author\.publicName\}`\}/);
  assert.equal(
    (pageCode.match(/aria-hidden="true"/g) ?? []).length,
    (pageCode.match(/<(Plus|Pencil|Archive|RotateCcw|Info) /g) ?? []).length,
  );
});

test("every form field has a Label, and errors are wired through aria-describedby", () => {
  for (const id of ["author-channel", "author-public-name", "author-role", "author-biography", "author-avatar-url"]) {
    assert.match(pageCode, new RegExp(`<Label htmlFor="${id}">`), `missing Label for ${id}`);
  }
  assert.match(pageCode, /aria-invalid=\{Boolean\(errors\.publicName\) \|\| undefined\}/);
  assert.match(pageCode, /aria-invalid=\{Boolean\(errors\.role\) \|\| undefined\}/);
  assert.match(pageCode, /aria-invalid=\{Boolean\(errors\.avatarUrl \|\| avatarServerError\) \|\| undefined\}/);
  assert.match(pageCode, /<form onSubmit=\{handleSubmit\} noValidate>/);
});

test("the table scrolls horizontally and the taller dialog is constrained on narrow screens", () => {
  assert.match(pageCode, /<div className="border rounded-md overflow-x-auto">/);
  assert.match(pageCode, /<DialogContent className="sm:max-w-lg max-h-\[85vh\] overflow-y-auto">/);
});

// ─── Wave 2.1B / 2.1C sibling regression ────────────────────────────────────

test("neither the Languages screen nor the Topics screen is referenced or refactored here", () => {
  assert.doesNotMatch(pageCode, /editorial-languages/);
  assert.doesNotMatch(pageCode, /WebsiteSettingsLanguagesPage/);
  assert.doesNotMatch(pageCode, /editorial-topics/);
  assert.doesNotMatch(pageCode, /EditorialTopicsPage/);
});
