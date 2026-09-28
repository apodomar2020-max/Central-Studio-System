/**
 * Final Editorial, Phase A — Website → Settings → Links screen contract.
 *
 * Source inspection, for the same reason every other Admin page test uses it:
 * the page is a `.tsx` importing `@/` aliases and generated React Query
 * hooks, and there is no jsdom/testing-library anywhere in this workspace.
 * Everything that CAN be executed for real — the form shape, the verbatim
 * validation, the dirty rule and the partial PATCH payload — lives in
 * lib/editorial-website-links.ts and is covered functionally in
 * lib/editorialWebsiteLinks.test.ts.
 *
 * Mirrors websiteSettingsLanguagesPage.test.ts, the sibling screen in the
 * same Website → Configuration group.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("./WebsiteSettingsLinksPage.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../../../App.tsx", import.meta.url), "utf8");
const nav = readFileSync(new URL("../../../components/layout/nav-config.ts", import.meta.url), "utf8");
const settingsRoute = readFileSync(
  new URL("../../../../../api-server/src/routes/adminEditorialSettings.ts", import.meta.url),
  "utf8",
);

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
const pageCode = stripComments(page);

// ─── Routing / placeholder retirement ────────────────────────────────────────

test("the route and its guard are exactly as Wave 2.1A left them", () => {
  assert.match(
    app,
    /<Route path="\/website\/settings\/links">\{guarded\(ROUTE_PERMS\.websiteSettings, <WebsiteSettingsLinksPage \/>\)\}<\/Route>/,
  );
});

test("App.tsx binds the real Links page module, and the placeholder is gone", () => {
  assert.match(
    app,
    /import WebsiteSettingsLinksPage from "@\/pages\/website\/settings\/WebsiteSettingsLinksPage";/,
  );
  assert.doesNotMatch(app, /EditorialPlaceholderPages/);
});

test("navigation is untouched — the Links entry already existed from Wave 2.1A", () => {
  assert.match(nav, /"\/website\/settings\/links"/);
  assert.match(nav, /pageTitle: "Website Links"/);
});

// ─── The page chrome follows the sibling Languages screen ────────────────────

test("plain Admin page chrome, NOT EditorialPageShell — same call Languages made", () => {
  // The Editorial coexistence banner is scoped to the Editorial nav group;
  // this screen configures shared website settings.
  assert.doesNotMatch(pageCode, /EditorialPageShell/);
  assert.match(pageCode, /className="admin2-final-page admin2-cms-workspace space-y-6"/);
  assert.match(pageCode, /data-testid="website-links-page"/);
});

// ─── NO BACKEND EXPANSION ────────────────────────────────────────────────────

test("the screen sits on EXACTLY the two pre-existing links routes — nothing new", () => {
  assert.match(settingsRoute, /router\.get\(\s*"\/admin\/editorial\/settings\/links"/);
  assert.match(settingsRoute, /router\.patch\(\s*"\/admin\/editorial\/settings\/links"/);
  assert.equal((settingsRoute.match(/"\/admin\/editorial\/settings\/links"/g) ?? []).length, 2);
  assert.match(pageCode, /useGetEditorialWebsiteLinks,/);
  assert.match(pageCode, /useUpdateEditorialWebsiteLinks,/);
});

test("the SINGLETON contract is honoured — no add, no remove, no reorder, no link type", () => {
  // The backend has one row and two columns; a generic list UI would promise
  // capabilities the API does not have.
  for (const forbidden of [/data-testid="button-add-link/, /button-remove-link/, /Move .* up/, /draggable/]) {
    assert.doesNotMatch(pageCode, forbidden);
  }
  // The fields are driven off the contract's own field list.
  assert.match(pageCode, /\{WEBSITE_LINK_FIELDS\.map\(\(field\) => \{/);
});

// ─── RBAC ────────────────────────────────────────────────────────────────────

test("in-page gating uses website.settings:edit, matching the PATCH route's permission", () => {
  assert.match(pageCode, /const canEdit = can\("website\.settings", "edit"\);/);
  // The shared WorkspaceRouteNav switcher filters its items on :view (the
  // Backgrounds/Users pattern); that is navigation, not in-page gating.
  const gatingCode = pageCode.replace(/<WorkspaceRouteNav[\s\S]*?\/>/, "");
  assert.equal((gatingCode.match(/can\("website\.[a-z]+", "[a-z]+"\)/g) ?? []).length, 1);
  assert.match(settingsRoute, /requireAdminPermission\("website\.settings", "edit"\)/);
  assert.match(settingsRoute, /requireAdminPermission\("website\.settings", "view"\)/);
});

test("a view-only admin still SEES both links — the inputs are disabled, not hidden", () => {
  assert.match(pageCode, /disabled=\{!canEdit \|\| saving\}/);
  assert.match(pageCode, /data-testid="website-links-read-only"/);
  // The field loop itself is not behind canEdit.
  const fieldBlock = pageCode.slice(pageCode.indexOf("WEBSITE_LINK_FIELDS.map"), pageCode.indexOf("WEBSITE_LINKS_HTTPS_NOTE"));
  assert.doesNotMatch(fieldBlock, /canEdit \? \(/, "the fields must not be hidden from a view-only admin");
});

test("save() refuses to fire without canEdit, so the gate is not only visual", () => {
  assert.match(pageCode, /const save = \(\) => \{\s*if \(!canEdit \|\| !dirty \|\| invalid \|\| saving\) return;/);
});

// ─── Scoped-save honesty: ONE PATCH, only from the Save button ───────────────

test("exactly ONE mutation call exists, and it is bound to the Save button", () => {
  assert.equal((pageCode.match(/updateLinks\.mutate\(/g) ?? []).length, 1);
  assert.match(pageCode, /data-testid="button-save-website-links"\s*\n\s*onClick=\{save\}/);
});

test("typing mutates LOCAL state only — no write is reachable from onChange", () => {
  assert.match(
    pageCode,
    /onChange=\{\(e\) => setForm\(\(current\) => \(\{ \.\.\.current, \[field\]: e\.target\.value \}\)\)\}/,
  );
  const onChangeLine = pageCode.slice(pageCode.indexOf("onChange={(e) => setForm"));
  assert.doesNotMatch(onChangeLine.slice(0, 200), /mutate\(/);
  // There is no debounce-and-autosave anywhere on this screen.
  assert.doesNotMatch(pageCode, /useDebounced/);
  assert.doesNotMatch(pageCode, /autoSave/i);
});

test("the payload sent is the PARTIAL one — only fields that actually changed", () => {
  assert.match(pageCode, /\{ data: toWebsiteLinksPayload\(form, baseline\) \}/);
});

test("Save is disabled unless the form is dirty AND valid", () => {
  assert.match(pageCode, /disabled=\{!dirty \|\| invalid \|\| saving\}/);
  assert.match(pageCode, /const invalid = hasWebsiteLinksFormErrors\(errors\);/);
  assert.match(pageCode, /const dirty = areWebsiteLinksDirty\(form, baseline\);/);
});

// ─── No accidental global invalidation ───────────────────────────────────────

test("a save invalidates ONLY the links query key — never the whole cache", () => {
  assert.equal((pageCode.match(/invalidateQueries\(/g) ?? []).length, 1);
  assert.match(
    pageCode,
    /invalidateQueries\(\{ queryKey: getGetEditorialWebsiteLinksQueryKey\(\) \}\)/,
  );
  assert.doesNotMatch(pageCode, /invalidateQueries\(\)/);
  assert.doesNotMatch(pageCode, /queryClient\.clear\(\)/);
  assert.doesNotMatch(pageCode, /resetQueries\(/);
});

test("the baseline is re-adopted from the SERVER's answer after a save", () => {
  // Both the effect and onSuccess set form AND baseline, so a save cannot
  // leave the screen permanently dirty.
  assert.equal((pageCode.match(/setBaseline\(next\);/g) ?? []).length, 2);
  assert.match(pageCode, /onSuccess: \(row\) => \{\s*const next = toWebsiteLinksFormValues\(row\);/);
});

test("a background refetch that changed nothing cannot discard what is being typed", () => {
  assert.match(
    pageCode,
    /\}, \[data\?\.updatedAt, data\?\.googlePlayUrl, data\?\.appStoreUrl\]\);/,
  );
});

// ─── Validation is the server's ──────────────────────────────────────────────

test("inline validation comes from the shared pure module, not from a second copy", () => {
  assert.match(pageCode, /const errors = validateWebsiteLinksForm\(form\);/);
  // No hand-rolled URL rule lives in the page.
  assert.doesNotMatch(pageCode, /new URL\(/);
  assert.doesNotMatch(pageCode, /https:\\\/\\\//);
});

test("a rejected save renders the SERVER's wording verbatim, inline and as a toast", () => {
  assert.match(pageCode, /setSaveError\(editorialErrorMessage\(err\)\)/);
  assert.match(pageCode, /description: editorialErrorMessage\(err\)/);
  assert.match(pageCode, /data-testid="website-links-error-alert"/);
});

// ─── No SSRF surface ─────────────────────────────────────────────────────────

test("nothing ever fetches a stored link — the preview is an ordinary opt-in anchor", () => {
  assert.doesNotMatch(pageCode, /fetch\(/);
  assert.doesNotMatch(pageCode, /<img/);
  assert.doesNotMatch(pageCode, /<iframe/);
  assert.doesNotMatch(pageCode, /rel="prefetch"|<link rel/);
  assert.match(pageCode, /rel="noreferrer noopener"/);
  assert.match(pageCode, /target="_blank"/);
  // And the preview only appears for a value that already validated.
  assert.match(pageCode, /\{!message && trimmed\.length > 0 && \(/);
});

// ─── States ──────────────────────────────────────────────────────────────────

test("loading, load-error, unset and unsaved states are all distinctly rendered", () => {
  assert.match(pageCode, /data-testid="website-links-loading"/);
  assert.match(pageCode, /data-testid="website-links-load-error"/);
  assert.match(pageCode, /data-testid="website-links-empty-state"/);
  assert.match(pageCode, /data-testid=\{`website-link-unset-\$\{field\}`\}/);
  assert.match(pageCode, /data-testid="website-links-dirty"/);
  // A blank link is presented as a supported state, not as an error.
  assert.match(pageCode, /\{WEBSITE_LINKS_EMPTY_STATE\}/);
});

// ─── Accessibility ───────────────────────────────────────────────────────────

test("each input is labelled, described and marked invalid when it is", () => {
  assert.match(pageCode, /<Label htmlFor=\{`website-link-\$\{field\}`\}>/);
  assert.match(pageCode, /id=\{`website-link-\$\{field\}`\}/);
  assert.match(pageCode, /aria-invalid=\{Boolean\(message\) \|\| undefined\}/);
  assert.match(pageCode, /aria-describedby=\{`website-link-\$\{field\}-help`\}/);
  assert.match(pageCode, /id=\{`website-link-\$\{field\}-help`\}/);
  assert.match(pageCode, /inputMode="url"/);
  assert.match(pageCode, /autoComplete="off"/);
});

test("both error surfaces are announced as alerts", () => {
  assert.equal((pageCode.match(/role="alert"/g) ?? []).length, 2);
  assert.match(pageCode, /aria-label="App store download links"/);
});

// ─── Responsive ──────────────────────────────────────────────────────────────

test("the form is width-capped and stacks naturally on a narrow viewport", () => {
  assert.match(pageCode, /className="max-w-2xl space-y-4 rounded-md border border-border bg-card p-4"/);
  assert.match(pageCode, /className="grid gap-1\.5" key=\{field\}/);
  assert.match(pageCode, /className="w-fit text-xs underline text-muted-foreground"/);
});
