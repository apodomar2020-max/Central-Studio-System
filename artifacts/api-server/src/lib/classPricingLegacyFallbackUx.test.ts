/**
 * Class Pricing settings — Legacy Fallback clarity (Admin ClassPricingTab.tsx).
 *
 * Source-inspection tests, following this repo's established convention for
 * Admin UI coverage where no DOM testing library exists (see
 * classPricingCategoryVisibility.test.ts, classesAudiencePricingUx.test.ts):
 * these assertions read the source text rather than executing the component.
 *
 * Scope: presentation-only. The three category prices and the Single Class
 * Price are visually separated into "General Class Walk-in Pricing" (active)
 * and "Legacy Fallback" (safety net) sections, with clearer, non-technical
 * copy. Nothing here touches field names, the API payload, validation, or
 * save/resolver behavior — these tests exist to lock that boundary in place.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const classPricingTab = read("artifacts/admin/src/pages/settings/ClassPricingTab.tsx");

// ─── Reorganization ─────────────────────────────────────────────────────────

test("the three category prices are grouped under a distinct 'General Class Walk-in Pricing' heading", () => {
  assert.match(classPricingTab, /General Class Walk-in Pricing/);
  const sectionStart = classPricingTab.indexOf("General Class Walk-in Pricing");
  const adultsFieldIdx = classPricingTab.indexOf('name="adultsWalkinPriceEgp"');
  const legacyHeadingIdx = classPricingTab.indexOf("Legacy Fallback");
  assert.ok(sectionStart > 0 && sectionStart < adultsFieldIdx, "heading must precede the category fields");
  assert.ok(adultsFieldIdx < legacyHeadingIdx, "category section must render before the Legacy Fallback section");
});

test("Single Class Price is moved into its own 'Legacy Fallback' section, distinct from the category prices", () => {
  const legacySectionStart = classPricingTab.indexOf('data-testid="section-legacy-fallback"');
  assert.ok(legacySectionStart > 0, "the Legacy Fallback section must exist");
  const singleClassFieldIdx = classPricingTab.indexOf('name="singleClassPriceEgp"');
  assert.ok(singleClassFieldIdx > legacySectionStart, "Single Class Price field must be inside the Legacy Fallback section");
  // The old combined heading text is gone — the two concerns are no longer conflated in one label.
  assert.doesNotMatch(classPricingTab, /Single Class Price \(legacy fallback\)/);
});

test("the Legacy Fallback section is visually marked as non-primary, reusing the existing secondary-badge convention", () => {
  const legacySectionStart = classPricingTab.indexOf('data-testid="section-legacy-fallback"');
  const legacySection = classPricingTab.slice(legacySectionStart, legacySectionStart + 600);
  assert.match(legacySection, /<Badge variant="secondary">/, "must reuse the existing Badge component, not a new one");
});

// ─── Explanation copy ───────────────────────────────────────────────────────

test("the legacy fallback has a short, non-technical explanation near it", () => {
  assert.match(classPricingTab, /Fallback price used for classes without a configured Walk-in Pricing Category\./);
});

// ─── Regression: no field name, API payload, validation, or save behavior touched ─

test("no stored field name or data-testid changed — only labels/layout/copy", () => {
  for (const name of ["singleClassPriceEgp", "adultsWalkinPriceEgp", "teensWalkinPriceEgp", "kidsWalkinPriceEgp"]) {
    assert.match(classPricingTab, new RegExp(`name="${name}"`));
  }
  for (const testid of [
    "input-single-class-price",
    "input-adults-walkin-price",
    "input-teens-walkin-price",
    "input-kids-walkin-price",
    "button-save-class-pricing",
    "banner-category-price-gap",
  ]) {
    assert.match(classPricingTab, new RegExp(`data-testid="${testid}"`));
  }
});

test("the submit handler is untouched — still just PATCHes whatever the form holds, no new fields introduced", () => {
  assert.match(classPricingTab, /const onClassPricingSubmit = \(values: ClassPricingForm\) => \{/);
  assert.match(classPricingTab, /updateClassPricingMutation\.mutate\(values\)/);
  assert.match(classPricingTab, /method: "PATCH", body: JSON\.stringify\(data\)/);
});

test("the category-gap warning banner logic (categoryGaps / activeClassCountsByCategory) is unchanged by this reorganization", () => {
  assert.match(classPricingTab, /categoryGaps/);
  assert.match(classPricingTab, /activeClassCountsByCategory/);
  assert.match(classPricingTab, /activeClassesFor\("adults"\)/);
  assert.match(classPricingTab, /activeClassesFor\("teens"\)/);
  assert.match(classPricingTab, /activeClassesFor\("kids"\)/);
});
