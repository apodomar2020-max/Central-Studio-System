/**
 * Wave 2.1B — Website → Configuration → Languages screen contract.
 *
 * The page is a `.tsx` that imports `@/` aliases and generated React Query
 * hooks, so it cannot be mounted under `node --test` (there is no
 * jsdom/testing-library anywhere in this workspace). It is therefore asserted
 * by source inspection, the established Admin convention documented in
 * pages/editorial/editorialRoutes.test.ts and pages/branches.test.ts. The
 * behaviour that CAN be executed for real — validation, ordering and every
 * piece of confirmation copy — lives in lib/editorial-languages.ts and is
 * covered functionally in lib/editorialLanguages.test.ts.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("./WebsiteSettingsLanguagesPage.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../../../App.tsx", import.meta.url), "utf8");
const placeholders = readFileSync(
  new URL("../../editorial/EditorialPlaceholderPages.tsx", import.meta.url),
  "utf8",
);
const nav = readFileSync(new URL("../../../components/layout/nav-config.ts", import.meta.url), "utf8");

/**
 * Negative assertions ("this control does not exist") must look at real code,
 * not at prose that merely *describes* the rule — a comment saying
 * "isDefault is never sent here" would otherwise fail a check for `isDefault`.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
const pageCode = stripComments(page);
const placeholderCode = stripComments(placeholders);

// ─── RBAC / access ───────────────────────────────────────────────────────────

test("the route guard stays website.settings:view and is untouched by this wave", () => {
  assert.match(app, /websiteSettings: \[\["website\.settings", "view"\]\],/);
  assert.match(
    app,
    /<Route path="\/website\/settings\/languages">\{guarded\(ROUTE_PERMS\.websiteSettings, <WebsiteSettingsLanguagesPage \/>\)\}<\/Route>/,
  );
});

test("in-page mutation controls are gated on website.settings:edit", () => {
  assert.match(page, /const canEdit = can\("website\.settings", "edit"\);/);
  assert.match(page, /\{canEdit && \(\s*<Button className="gap-2 shrink-0" data-testid="button-add-language"/);
  assert.match(page, /\{canEdit && \(\s*<>/, "row actions must be wrapped in the canEdit gate");
});

test("a view-only admin still gets the full list — nothing about fetching or rendering is gated", () => {
  const listBlock = pageCode.slice(pageCode.indexOf("<TableBody>"), pageCode.indexOf("</TableBody>"));
  assert.doesNotMatch(listBlock, /canEdit \?/, "rows must not be hidden from view-only admins");
  assert.doesNotMatch(pageCode, /if \(!canEdit\) return/, "the page must never refuse to render for view-only admins");
  assert.doesNotMatch(page, /useListEditorialLanguages\([^)]*canEdit/);
});

test("this wave grants no permission to any role — Super Admin keeps its existing bypass", () => {
  assert.doesNotMatch(pageCode, /permissions\s*[:=]/);
  assert.doesNotMatch(pageCode, /isSuperAdmin/);
});

// ─── List ────────────────────────────────────────────────────────────────────

test("loading, error and empty states are all rendered", () => {
  assert.match(page, /isLoading \? \(/);
  assert.match(page, /Languages could not be loaded\./);
  assert.match(page, /No languages registered yet\./);
});

test("INACTIVE languages are visible by default — activeOnly is never sent", () => {
  assert.match(page, /useListEditorialLanguages\(\);/);
  assert.doesNotMatch(pageCode, /activeOnly/);
});

test("the table renders code, names, direction, default, state, counts and order", () => {
  for (const head of ["Code", "Name", "Native name", "Direction", "Default", "State", "Draft", "Published", "Archived", "Order", "Actions"]) {
    assert.match(page, new RegExp(`<TableHead[^>]*>${head}</TableHead>`), `missing column: ${head}`);
  }
  assert.match(page, /\{language\.translationCounts\.draft\}/);
  assert.match(page, /\{language\.translationCounts\.published\}/);
  assert.match(page, /\{language\.translationCounts\.archived\}/);
  assert.match(page, /\{language\.displayOrder\}/);
});

test("direction is rendered through directionLabel, never as an icon alone", () => {
  assert.match(page, /\{directionLabel\(language\.direction\)\}/);
});

test("the default language carries a visible Default badge", () => {
  assert.match(page, /\{language\.isDefault && \(/);
  assert.match(page, /data-testid=\{`badge-default-\$\{language\.code\}`\}/);
  assert.match(page, /Default\s*<\/Badge>/);
});

test("active and inactive rows are distinguished by a labelled badge", () => {
  assert.match(page, /\{language\.isActive \? "Active" : "Inactive"\}/);
});

// ─── Create ──────────────────────────────────────────────────────────────────

test("Add language opens the create dialog and submits the generated create hook", () => {
  assert.match(page, /const openCreate = \(\) => \{/);
  assert.match(page, /useCreateEditorialLanguage/);
  assert.match(page, /createLanguage\.mutate\(/);
});

test("required fields are enforced before the create request is made", () => {
  assert.match(page, /const nextErrors = validateLanguageForm\(form, \{ requireCode: isCreate \}\);/);
  assert.match(page, /if \(hasFormErrors\(nextErrors\)\) return;/);
});

test("the code sent is canonicalised and the code DISPLAYED afterwards is the server's own", () => {
  assert.match(page, /code: canonicalizeEditorialLanguageCode\(form\.code\),/);
  assert.match(page, /onSuccess: \(created\) => \{/);
  assert.match(page, /\$\{created\.name\} \(\$\{created\.code\}\)/);
  assert.doesNotMatch(pageCode, /\$\{form\.code\}/, "never echo the operator's raw input as the stored code");
});

test("a successful create invalidates the languages query and closes the dialog", () => {
  const block = page.slice(page.indexOf("createLanguage.mutate("), page.indexOf("const target = dialog.language"));
  assert.match(block, /invalidateLanguages\(\);/);
  assert.match(block, /closeDialog\(\);/);
});

test("a duplicate-code 409 is surfaced inline with the backend's own message", () => {
  assert.match(page, /if \(status === 409\) \{[\s\S]*?setCodeConflict\(message\);/);
  assert.match(page, /const message = editorialErrorMessage\(err\);/);
  assert.match(page, /\{errors\.code \?\? codeConflict \?\?/);
});

// ─── Edit ────────────────────────────────────────────────────────────────────

test("the edit dialog renders code read-only with an explanation", () => {
  assert.match(page, /readOnly\s*\n\s*disabled/);
  assert.match(page, /\{LANGUAGE_CODE_IMMUTABLE_EXPLANATION\}/);
});

test("the update request is presentation-only — code, isActive and isDefault are never sent", () => {
  const update = pageCode.slice(pageCode.indexOf("updateLanguage.mutate("), pageCode.indexOf("const handleActivate"));
  assert.match(update, /name: form\.name\.trim\(\),/);
  assert.match(update, /nativeName: form\.nativeName\.trim\(\),/);
  assert.match(update, /direction: form\.direction,/);
  assert.match(update, /displayOrder: Number\(form\.displayOrder\.trim\(\)\),/);
  assert.doesNotMatch(update, /\bcode:/);
  assert.doesNotMatch(update, /isActive|isDefault/);
});

test("a successful edit refetches the list", () => {
  const update = page.slice(page.indexOf("updateLanguage.mutate("), page.indexOf("const handleActivate"));
  assert.match(update, /invalidateLanguages\(\);/);
});

// ─── Activate / deactivate ───────────────────────────────────────────────────

test("an inactive language offers Activate, an active one offers Deactivate", () => {
  assert.match(page, /\{language\.isActive \? \(/);
  assert.match(page, /aria-label=\{`Deactivate \$\{language\.name\}`\}/);
  assert.match(page, /aria-label=\{`Activate \$\{language\.name\}`\}/);
});

test("activation is non-destructive: no confirmation, dedicated endpoint, list refetched", () => {
  const activate = pageCode.slice(pageCode.indexOf("const handleActivate"), pageCode.indexOf("const handleDeactivate"));
  assert.doesNotMatch(activate, /confirmAction/);
  assert.match(activate, /activateLanguage\.mutate\(/);
  assert.match(activate, /invalidateLanguages\(\);/);
});

test("deactivation is confirmed through useAdminConfirm with the shared policy copy", () => {
  const block = page.slice(page.indexOf("const handleDeactivate"), page.indexOf("const handleSetDefault"));
  assert.match(block, /const copy = deactivateConfirmation\(language\);/);
  assert.match(block, /if \(!\(await confirmAction\(copy\)\)\) return;/);
  assert.match(block, /deactivateLanguage\.mutate\(/);
  assert.match(block, /invalidateLanguages\(\);/);
});

test("a deactivate 409 (current default / last active language) is surfaced verbatim", () => {
  const block = page.slice(page.indexOf("const handleDeactivate"), page.indexOf("const handleSetDefault"));
  assert.match(block, /onError: failWith\("Could not deactivate language"\)/);
  assert.match(page, /const failWith = \(title: string\) => \(err: unknown\) => \{[\s\S]*?editorialErrorMessage\(err\)/);
});

test("a deactivated language stays in the list — the row is state-driven, never filtered out", () => {
  const listBlock = pageCode.slice(pageCode.indexOf("languages.map((language)"), pageCode.indexOf("</TableBody>"));
  assert.doesNotMatch(listBlock, /\.filter\(/);
  assert.doesNotMatch(pageCode, /languages\.filter\(\(l\) => l\.isActive\)/);
});

// ─── Default language ────────────────────────────────────────────────────────

test("Make default is confirmed and uses the dedicated endpoint, not a generic PATCH", () => {
  const block = pageCode.slice(pageCode.indexOf("const handleSetDefault"), pageCode.indexOf("const saving ="));
  assert.match(block, /const copy = setDefaultConfirmation\(language, currentDefaultName\);/);
  assert.match(block, /if \(!\(await confirmAction\(copy\)\)\) return;/);
  assert.match(block, /setDefaultLanguage\.mutate\(/);
  assert.doesNotMatch(block, /updateLanguage/);
  assert.match(page, /useSetDefaultEditorialLanguage/);
});

test("promoting a default refetches, so the previous default's badge updates", () => {
  const block = page.slice(page.indexOf("const handleSetDefault"), page.indexOf("const saving ="));
  assert.match(block, /invalidateLanguages\(\);/);
});

test("Make default is offered only for an active, non-default language", () => {
  assert.match(page, /\{!language\.isDefault && language\.isActive && \(/);
});

// ─── Policy regression ───────────────────────────────────────────────────────

test("NO DELETE CONTROL EXISTS ANYWHERE on this screen", () => {
  assert.doesNotMatch(pageCode, /Trash2|Trash\b/, "no trash icon is imported or rendered");
  assert.doesNotMatch(pageCode, /useDelete|useRemove|deleteLanguage|removeLanguage/, "no delete mutation hook or handler");
  assert.doesNotMatch(pageCode, /method: "DELETE"/);
  // No control (button text, aria-label or test id) offers deletion/removal.
  const controls = pageCode.match(/(data-testid=|aria-label=|confirmLabel:|>\s*[A-Z][a-z]+[^<]*<\/Button>)[^\n]*/g) ?? [];
  for (const control of controls) {
    assert.doesNotMatch(control, /delete|remove|trash/i, `delete-like control found: ${control}`);
  }
});

test("the screen's own prose reinforces that languages are never deleted", () => {
  assert.match(page, /Languages are never deleted/);
});

test("error handling goes exclusively through the Wave 2.1A helper", () => {
  assert.match(page, /import \{ editorialErrorMessage \} from "@\/lib\/editorial-errors";/);
  assert.doesNotMatch(pageCode, /err instanceof Error \? err\.message/, "no second error parser");
});

test("only the languages query is invalidated — authors, topics and posts are untouched", () => {
  assert.match(page, /queryClient\.invalidateQueries\(\{ queryKey: getListEditorialLanguagesQueryKey\(\) \}\)/);
  assert.equal((pageCode.match(/invalidateQueries\(/g) ?? []).length, 1);
  assert.doesNotMatch(pageCode, /Author|Topic|Post|Placement/);
  assert.doesNotMatch(pageCode, /queryClient\.clear\(|new QueryClient/);
});

// ─── Accessibility / responsive ──────────────────────────────────────────────

test("every form control has a real Label htmlFor matched to a control id", () => {
  const ids = ["language-code", "language-name", "language-native-name", "language-direction", "language-display-order"];
  for (const id of ids) {
    assert.match(page, new RegExp(`<Label htmlFor="${id}">`), `missing <Label htmlFor="${id}">`);
    assert.match(page, new RegExp(`id="${id}"`), `missing control id="${id}"`);
  }
  // Every Label on this page is an associated one.
  assert.equal((page.match(/<Label /g) ?? []).length, ids.length);
  assert.equal((page.match(/<Label htmlFor=/g) ?? []).length, ids.length);
});

test("error states set aria-invalid and point at their description", () => {
  assert.match(page, /aria-invalid=\{Boolean\(errors\.code \|\| codeConflict\) \|\| undefined\}/);
  assert.match(page, /aria-describedby="language-code-help"/);
  assert.match(page, /aria-describedby=\{errors\.name \? "language-name-error" : undefined\}/);
  assert.match(page, /aria-describedby=\{errors\.nativeName \? "language-native-name-error" : undefined\}/);
  assert.match(page, /aria-describedby=\{errors\.displayOrder \? "language-display-order-error" : undefined\}/);
});

test("icon-only buttons carry meaningful accessible names and hide the glyph", () => {
  assert.match(page, /aria-label=\{`Edit \$\{language\.name\}`\}/);
  assert.equal((page.match(/aria-hidden="true"/g) ?? []).length, (page.match(/<(Pencil|EyeOff|RotateCcw|Star) /g) ?? []).length);
  // "Make default" is a text button, not an icon.
  assert.match(page, />\s*Make default\s*</);
});

test("the table scrolls horizontally and the dialog is width-constrained on narrow screens", () => {
  assert.match(page, /<div className="border rounded-md overflow-x-auto">/);
  assert.match(page, /<DialogContent className="sm:max-w-lg">/);
  assert.match(page, /flex flex-wrap items-start justify-between gap-3/);
});

// ─── Wave 2.1A regression ────────────────────────────────────────────────────

test("the Website Links placeholder is exactly as Wave 2.1A left it", () => {
  assert.match(placeholders, /export function WebsiteSettingsLinksPage\(\) \{\n {2}return \(\n {4}<SettingsPlaceholder\n {6}heading="Links"\n {6}description="Global public-website links referenced by Editorial content\."\n {6}body="The website links form is delivered in a later Wave 2\.1 sub-wave\. This page currently exists only to confirm navigation, routing and permissions\."\n {4}\/>\n {2}\);\n\}/);
  assert.match(app, /<Route path="\/website\/settings\/links">\{guarded\(ROUTE_PERMS\.websiteSettings, <WebsiteSettingsLinksPage \/>\)\}<\/Route>/);
});

test("no other Wave 2.1A placeholder was touched", () => {
  for (const component of [
    "EditorialPostsListPage", "EditorialPostCreatePage", "EditorialPostDetailPage",
    "EditorialPostTranslationPage", "EditorialAuthorsPage", "EditorialTopicsPage",
    "EditorialPlacementsPage",
  ]) {
    assert.match(placeholders, new RegExp(`export function ${component}\\(`));
  }
  assert.equal((placeholders.match(/delivered in a later Wave 2\.1 sub-wave/g) ?? []).length, 8);
});

test("navigation is untouched — Editorial, News, Performance and Backgrounds entries are unchanged", () => {
  assert.match(nav, /\/website\/settings\/languages/);
  assert.match(nav, /\/website\/settings\/links/);
  assert.match(nav, /\/website\/news/);
  assert.match(nav, /\/website\/performances/);
  assert.match(nav, /\/website\/backgrounds/);
  assert.match(nav, /\/editorial\/posts/);
});
