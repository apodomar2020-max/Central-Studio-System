/**
 * Wave 2.1B — Languages presentation logic.
 *
 * Real behaviour tests: lib/editorial-languages.ts is a pure module with no
 * React and no `import.meta.env`, so every rule and every piece of
 * operator-facing copy is exercised directly rather than by regex. The
 * screen itself is covered by source inspection in
 * pages/website/settings/websiteSettingsLanguagesPage.test.ts, matching the
 * established Admin convention for `.tsx`.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DIRECTION_OPTIONS,
  EDITORIAL_LANGUAGE_CODE_RE,
  EMPTY_LANGUAGE_FORM,
  LANGUAGE_CODE_IMMUTABLE_EXPLANATION,
  activateConfirmationMessage,
  canonicalizeEditorialLanguageCode,
  deactivateConfirmation,
  directionLabel,
  hasFormErrors,
  setDefaultConfirmation,
  sortLanguagesForDisplay,
  validateLanguageForm,
  type LanguageFormValues,
} from "./editorial-languages.ts";

const summary = (over: Partial<{ name: string; code: string; draft: number; published: number; archived: number }> = {}) => ({
  name: over.name ?? "Arabic",
  code: over.code ?? "ar",
  translationCounts: {
    draft: over.draft ?? 2,
    published: over.published ?? 5,
    archived: over.archived ?? 1,
  },
});

const form = (over: Partial<LanguageFormValues> = {}): LanguageFormValues => ({
  ...EMPTY_LANGUAGE_FORM,
  code: "en",
  name: "English",
  nativeName: "English",
  displayOrder: "0",
  ...over,
});

// ─── Code canonicalisation ───────────────────────────────────────────────────

test("canonicalises a locale tag the way the server does", () => {
  assert.equal(canonicalizeEditorialLanguageCode("EN-gb"), "en-GB");
  assert.equal(canonicalizeEditorialLanguageCode("  en-gb "), "en-GB");
  assert.equal(canonicalizeEditorialLanguageCode("zh-HANT-tw"), "zh-Hant-TW");
  assert.equal(canonicalizeEditorialLanguageCode("AR"), "ar");
  assert.equal(canonicalizeEditorialLanguageCode("es-419"), "es-419");
});

test("the canonicaliser and the code pattern are byte-identical to lib/db's", () => {
  const schema = readFileSync(
    new URL("../../../../lib/db/src/schema/editorialLanguages.ts", import.meta.url),
    "utf8",
  );
  const local = readFileSync(new URL("./editorial-languages.ts", import.meta.url), "utf8");

  const pattern = /export const EDITORIAL_LANGUAGE_CODE_RE =\s*(\/\^.*?\$\/);/s;
  const schemaRe = schema.match(pattern)?.[1];
  const localRe = local.match(pattern)?.[1];
  assert.ok(schemaRe && localRe, "both modules must declare EDITORIAL_LANGUAGE_CODE_RE");
  assert.equal(localRe, schemaRe, "the Admin mirror of the code pattern has drifted from lib/db");

  const body = (src: string) =>
    src
      .slice(src.indexOf("function canonicalizeEditorialLanguageCode"))
      .split("\n}")[0]
      .replace(/\s+/g, " ");
  assert.equal(body(local), body(schema), "the Admin mirror of the canonicaliser has drifted from lib/db");
});

// ─── Direction ───────────────────────────────────────────────────────────────

test("direction is rendered as real words, never an icon or a bare abbreviation", () => {
  assert.equal(directionLabel("ltr"), "Left to right (LTR)");
  assert.equal(directionLabel("rtl"), "Right to left (RTL)");
  assert.deepEqual(DIRECTION_OPTIONS.map((o) => o.value), ["ltr", "rtl"]);
});

// ─── Create / edit form validation ───────────────────────────────────────────

test("a valid create form produces no errors", () => {
  assert.equal(hasFormErrors(validateLanguageForm(form(), { requireCode: true })), false);
});

test("required fields are enforced on create", () => {
  const errors = validateLanguageForm(
    form({ code: "", name: "", nativeName: "", displayOrder: "" }),
    { requireCode: true },
  );
  assert.ok(errors.code);
  assert.ok(errors.name);
  assert.ok(errors.nativeName);
  assert.ok(errors.displayOrder);
});

test("an invalid locale tag is rejected inline, a valid one is not", () => {
  assert.ok(validateLanguageForm(form({ code: "english" }), { requireCode: true }).code);
  assert.ok(validateLanguageForm(form({ code: "e" }), { requireCode: true }).code);
  assert.ok(validateLanguageForm(form({ code: "en_GB" }), { requireCode: true }).code);
  for (const code of ["en", "ar", "EN-gb", "zh-HANT-tw", "es-419"]) {
    assert.equal(
      validateLanguageForm(form({ code }), { requireCode: true }).code,
      undefined,
      `${code} should be accepted`,
    );
  }
});

test("the code field is not validated on edit — it is not editable there", () => {
  const errors = validateLanguageForm(form({ code: "" }), { requireCode: false });
  assert.equal(errors.code, undefined);
});

test("display order must be a whole number of zero or more", () => {
  assert.ok(validateLanguageForm(form({ displayOrder: "-1" }), { requireCode: true }).displayOrder);
  assert.ok(validateLanguageForm(form({ displayOrder: "1.5" }), { requireCode: true }).displayOrder);
  assert.ok(validateLanguageForm(form({ displayOrder: "abc" }), { requireCode: true }).displayOrder);
  assert.equal(validateLanguageForm(form({ displayOrder: "7" }), { requireCode: true }).displayOrder, undefined);
});

test("name and nativeName respect the generated schema's 100-character ceiling", () => {
  const long = "x".repeat(101);
  assert.ok(validateLanguageForm(form({ name: long }), { requireCode: true }).name);
  assert.ok(validateLanguageForm(form({ nativeName: long }), { requireCode: true }).nativeName);
  assert.equal(validateLanguageForm(form({ name: "x".repeat(100) }), { requireCode: true }).name, undefined);
});

test("EDITORIAL_LANGUAGE_CODE_RE is case-sensitive, as the schema documents", () => {
  assert.equal(EDITORIAL_LANGUAGE_CODE_RE.test("en-GB"), true);
  assert.equal(EDITORIAL_LANGUAGE_CODE_RE.test("en-gb"), false);
});

// ─── Wave 2.0 policy copy ────────────────────────────────────────────────────

test("deactivation copy states retention, live-and-editable publishing, and the real restriction", () => {
  const copy = deactivateConfirmation(summary());
  assert.match(copy.title, /Deactivate Arabic\?/);
  assert.match(copy.description, /Nothing is deleted/);
  assert.match(copy.description, /retained exactly as it is/);
  assert.match(copy.description, /stay live on the website and stay editable/);
  assert.match(copy.description, /no NEW translation can be created/);
  assert.match(copy.description, /nothing new can be published in it/);
  assert.match(copy.description, /until the language is activated again/);
});

test("deactivation copy surfaces the language's published-translation count", () => {
  assert.match(deactivateConfirmation(summary({ published: 5 })).description, /Its 5 published translations/);
  assert.match(deactivateConfirmation(summary({ published: 1 })).description, /Its 1 published translation stays live/);
  assert.match(deactivateConfirmation(summary({ published: 0 })).description, /Its 0 published translations/);
});

test("deactivation copy never implies content is removed, hidden or unpublished", () => {
  const text = deactivateConfirmation(summary()).description.toLowerCase();
  for (const forbidden of ["will be removed", "hidden", "unpublish", "taken down", "disappear", "no longer visible"]) {
    assert.ok(!text.includes(forbidden), `deactivation copy must not say "${forbidden}"`);
  }
});

test("activation copy promises no translation status is touched", () => {
  assert.match(activateConfirmationMessage(summary()), /No translation's status is changed\./);
});

test("set-default copy is atomic-swap wording and touches no translation data", () => {
  const copy = setDefaultConfirmation(summary({ name: "Arabic" }), "English");
  assert.match(copy.title, /Make Arabic the default language\?/);
  assert.match(copy.description, /English stops being the default in the same operation/);
  assert.match(copy.description, /the swap is atomic/);
  assert.match(copy.description, /No translation is created, changed, published or unpublished\./);
  assert.equal(copy.destructive, false, "promoting a default is not a destructive action");
});

test("set-default copy still reads correctly when no incumbent is known", () => {
  const copy = setDefaultConfirmation(summary(), null);
  assert.match(copy.description, /The incumbent default is demoted in the same operation/);
});

test("the immutable-code explanation says why, not just that", () => {
  assert.match(LANGUAGE_CODE_IMMUTABLE_EXPLANATION, /cannot be changed/);
  assert.match(LANGUAGE_CODE_IMMUTABLE_EXPLANATION, /every stored translation is keyed to it/);
});

// ─── Ordering ────────────────────────────────────────────────────────────────

test("languages sort by display order, then code — inactive rows are never dropped", () => {
  const rows = [
    { code: "fr", displayOrder: 2, isActive: false },
    { code: "ar", displayOrder: 1, isActive: true },
    { code: "en", displayOrder: 1, isActive: true },
  ];
  assert.deepEqual(sortLanguagesForDisplay(rows).map((r) => r.code), ["ar", "en", "fr"]);
  assert.equal(sortLanguagesForDisplay(rows).length, 3);
});
