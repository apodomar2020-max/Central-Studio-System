/**
 * Class Audience & Pricing UX refinement (Admin classes.tsx).
 *
 * Source-inspection tests, following this repo's established convention for
 * Admin UI coverage where no DOM testing library exists (see financeUi.test.ts,
 * balletCancellationUi.test.ts, classPricingCategoryVisibility.test.ts):
 * classes.tsx cannot be imported directly in a plain node/tsx test process —
 * it references Vite-only globals (`import.meta.env`) at module scope that
 * only exist inside a Vite bundle — so these assertions read the source text
 * instead of executing the component.
 *
 * Scope: this feature is presentation-only. Nothing here touches the API,
 * the database, booking eligibility, or pricing resolution — these tests
 * exist to lock that boundary in place as much as to verify the new UX.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const classesPage = read("artifacts/admin/src/pages/classes.tsx");

// ─── Reorganization ─────────────────────────────────────────────────────────

test("the three audience fields are grouped under one labeled section, in the required order (Age Eligibility, Pricing Category, Display Audience)", () => {
  const sectionStart = classesPage.indexOf('data-testid="section-audience-and-pricing"');
  assert.ok(sectionStart > 0, "the combined section must exist");
  assert.match(classesPage.slice(sectionStart, sectionStart + 200), /Audience &amp; Pricing/);

  const ageEligibilityIdx = classesPage.indexOf('data-testid="select-class-age-preset"', sectionStart);
  const pricingCategoryIdx = classesPage.indexOf('data-testid="select-class-pricing-category"', sectionStart);
  const displayAudienceIdx = classesPage.indexOf('data-testid="select-class-age-group"', sectionStart);

  assert.ok(ageEligibilityIdx > sectionStart, "Age Eligibility must be inside the section");
  assert.ok(pricingCategoryIdx > ageEligibilityIdx, "Pricing Category must render after Age Eligibility");
  assert.ok(displayAudienceIdx > pricingCategoryIdx, "Display Audience must render after Pricing Category");
});

test("no stored field name, API payload shape, or existing data-testid changed — only labels/layout", () => {
  // The three form field names (wired via react-hook-form `name=`) are exactly
  // what they were before this change — confirms no schema/API-contract drift.
  assert.match(classesPage, /name="ageGroup"/);
  assert.match(classesPage, /name="pricingCategory"/);
  assert.match(classesPage, /name="minAge"/);
  assert.match(classesPage, /name="maxAge"/);
  // allowAllAges is driven by the Age Eligibility preset selector, not its
  // own FormField — confirm it's still wired via setValue/watch, unchanged.
  assert.match(classesPage, /form\.setValue\("allowAllAges"/);
  assert.match(classesPage, /watchedAllowAllAges = form\.watch\("allowAllAges"\)/);
  // Every pre-existing testid a prior test or the user's manual QA might
  // already reference is preserved verbatim.
  for (const testid of ["select-class-age-group", "select-class-pricing-category", "select-class-age-preset"]) {
    assert.match(classesPage, new RegExp(`data-testid="${testid}"`));
  }
});

// ─── Relabeling ──────────────────────────────────────────────────────────────

test("Legacy Age Group is relabeled Display Audience, with an explicit does-not-affect-eligibility-or-pricing note", () => {
  assert.doesNotMatch(classesPage, /Legacy Age Group/);
  assert.match(classesPage, /Display Audience/);
  assert.match(classesPage, /does not control\s*\n?\s*booking eligibility or pricing/);
});

test("each of the three fields states which concern it actually controls", () => {
  assert.match(classesPage, /controls who can book/);
  assert.match(classesPage, /controls walk-in price/);
  assert.match(classesPage, /mobile browsing\/filter labels only/);
});

// ─── Suggestion (non-blocking, never auto-applied) ─────────────────────────

test("the pricing-category suggestion is derived from Age Eligibility only, with a documented no-suggestion case for All Ages / mixed ranges", () => {
  const fnStart = classesPage.indexOf("function suggestedPricingCategoryFromEligibility");
  assert.ok(fnStart > 0, "derivation function must exist");
  const fnBody = classesPage.slice(fnStart, classesPage.indexOf("\n}", fnStart));
  assert.match(fnBody, /allowAllAges \|\| minAge == null\) return null/, "All Ages / unset range must yield no suggestion");
  assert.match(fnBody, /maxAge <= 12/, "kids upper bound");
  assert.match(fnBody, /minAge >= 13/, "teens lower bound");
  assert.match(fnBody, /maxAge <= 17/, "teens upper bound");
  assert.match(fnBody, /minAge >= 18/, "adults lower bound");
  assert.match(fnBody, /return null/, "a range spanning multiple bands must fall through to no suggestion");
});

test("the suggestion is presented as an opt-in Apply action, not applied automatically", () => {
  const suggestionBlockStart = classesPage.indexOf("showPricingSuggestion &&");
  assert.ok(suggestionBlockStart > 0);
  const block = classesPage.slice(suggestionBlockStart, suggestionBlockStart + 800);
  assert.match(block, /Suggested:/);
  assert.match(block, /onClick=\{\(\) => form\.setValue\("pricingCategory", eligibilitySuggestedCategory/, "Apply must be an explicit click handler, not an effect that writes on its own");
  // The suggestion must never be pre-selected as the field's own value —
  // it only fires when the current value differs from the suggestion.
  assert.match(classesPage, /eligibilitySuggestedCategory !== watchedPricingCategory/);
});

// ─── Consistency warning (non-blocking) ────────────────────────────────────

test("the audience-mismatch warning is a plain derived boolean, never a Zod issue — it can never block saving", () => {
  assert.match(classesPage, /const audienceMismatch = new Set\(audienceBuckets\)\.size > 1;/);
  // superRefine (the ONLY mechanism in this file that can block a save) must
  // not reference the mismatch/suggestion state at all.
  const superRefineStart = classesPage.indexOf(".superRefine((value, ctx) => {");
  const superRefineEnd = classesPage.indexOf("});", superRefineStart);
  const superRefineBody = classesPage.slice(superRefineStart, superRefineEnd);
  assert.doesNotMatch(superRefineBody, /audienceMismatch|pricingCategory|ageGroup/, "the hard-validation block must stay scoped to the existing age-range rules only");
});

test("existing hard validation (minAge required unless All Ages, maxAge >= minAge) is untouched", () => {
  assert.match(classesPage, /if \(!value\.allowAllAges && value\.minAge == null\)/);
  assert.match(classesPage, /Minimum age is required\./);
  assert.match(classesPage, /if \(value\.minAge != null && value\.maxAge != null && value\.minAge > value\.maxAge\)/);
  assert.match(classesPage, /Maximum age cannot be below minimum age\./);
});

test("the mismatch warning renders as the same non-blocking amber convention already used elsewhere on this page", () => {
  const warningStart = classesPage.indexOf('data-testid="warning-audience-mismatch"');
  assert.ok(warningStart > 0);
  const warningBlock = classesPage.slice(classesPage.lastIndexOf("<div", warningStart), warningStart + 100);
  assert.match(warningBlock, /border-amber-500\/30 bg-amber-500\/10/);
});

// ─── Regression: no API/schema/eligibility/pricing-resolver surface touched ─

test("onSubmit still sends exactly the same payload shape — no new/renamed fields added to the API call", () => {
  const onSubmitStart = classesPage.indexOf("const onSubmit = (values: FormValues) => {");
  const onSubmitEnd = classesPage.indexOf("};", onSubmitStart);
  const onSubmitBody = classesPage.slice(onSubmitStart, onSubmitEnd);
  assert.match(onSubmitBody, /const parsed = formSchema\.parse\(values\);/);
  assert.match(onSubmitBody, /\.\.\.parsed,/);
  // No pricing-resolver, booking-eligibility, or new API field logic was
  // introduced into the submit path by this UX change.
  assert.doesNotMatch(onSubmitBody, /resolveSingleClassPriceEgp|suggestedPricingCategoryFromEligibility|audienceMismatch/);
});
