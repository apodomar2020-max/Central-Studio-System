/**
 * Pre-merge gap closure — Fix 2 (category configuration visibility).
 *
 * The repo has no DOM testing library (see financeUi.test.ts /
 * balletCancellationUi.test.ts), so — following the same established
 * convention — these are source-inspection tests asserting the structural
 * guarantee: Admin must be able to see (a) which categories have no
 * configured price, and (b) which active classes depend on one of those
 * missing prices, without the pricing behavior itself silently changing.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const classPricingRoute = read("artifacts/api-server/src/routes/classPricing.ts");
const classPricingTab = read("artifacts/admin/src/pages/settings/ClassPricingTab.tsx");
const classesPage = read("artifacts/admin/src/pages/classes.tsx");

// ─── Backend: computed, read-only, additive ────────────────────────────────

test("classPricing.ts: active-class-per-category counts are computed read-only and never influence a resolved price", () => {
  assert.match(classPricingRoute, /getActiveClassCountsByCategory/);
  // It must be a pure SELECT/count — never an INSERT/UPDATE/DELETE on
  // classesTable, i.e. visibility must not become a side effect.
  const fnBody = classPricingRoute.slice(
    classPricingRoute.indexOf("async function getActiveClassCountsByCategory"),
    classPricingRoute.indexOf("router.get(\"/settings/class-pricing\""),
  );
  assert.match(fnBody, /db\s*\n?\s*\.select\(/);
  assert.doesNotMatch(fnBody, /\.insert\(|\.update\(|\.delete\(/);
});

test("classPricing.ts: the admin GET and PATCH responses both include activeClassCountsByCategory, the public GET does not", () => {
  const adminGetBlock = classPricingRoute.slice(
    classPricingRoute.indexOf('router.get("/admin/settings/class-pricing"'),
    classPricingRoute.indexOf('router.patch('),
  );
  assert.match(adminGetBlock, /activeClassCountsByCategory/);

  const patchBlock = classPricingRoute.slice(classPricingRoute.indexOf('router.patch('));
  assert.match(patchBlock, /activeClassCountsByCategory/);

  const publicGetBlock = classPricingRoute.slice(
    classPricingRoute.indexOf('router.get("/settings/class-pricing"'),
    classPricingRoute.indexOf('router.get("/admin/settings/class-pricing"'),
  );
  assert.doesNotMatch(publicGetBlock, /activeClassCountsByCategory/);
});

// ─── Admin: Settings → Class Pricing (aggregate visibility) ────────────────

test("ClassPricingTab.tsx: warns when a category has active classes but its price is unconfigured, without altering the save behavior", () => {
  assert.match(classPricingTab, /categoryGaps/);
  assert.match(classPricingTab, /activeClassCountsByCategory/);
  assert.match(classPricingTab, /banner-category-price-gap/);
  // The warning must be purely presentational — the submit handler must
  // still just PATCH whatever the form holds, no gap-driven blocking logic.
  assert.match(classPricingTab, /updateClassPricingMutation\.mutate\(values\)/);
});

test("ClassPricingTab.tsx: shows the active-class count inline next to each of the three category fields", () => {
  for (const key of ["adults", "teens", "kids"]) {
    assert.match(classPricingTab, new RegExp(`activeClassesFor\\("${key}"\\)`));
  }
});

// ─── Admin: Classes page (per-class visibility) ────────────────────────────

test("classes.tsx: flags classes with a category ASSIGNED but that category's price UNCONFIGURED — a distinct condition from unassigned", () => {
  assert.match(classesPage, /unassignedPricingCount/); // pre-existing: no category at all
  assert.match(classesPage, /unconfiguredCategoryPriceClasses/); // new: category set, price missing
  assert.match(classesPage, /hasUnconfiguredCategoryPrice/);
  assert.match(classesPage, /banner-category-price-unconfigured/);
});

test("classes.tsx: the unconfigured-price banner names the specific affected classes, not just a count", () => {
  const banner = classesPage.slice(
    classesPage.indexOf("banner-category-price-unconfigured"),
    classesPage.indexOf("banner-category-price-unconfigured") + 1200,
  );
  assert.match(banner, /unconfiguredCategoryPriceClasses\.map\(\(cls\)/);
  assert.match(banner, /cls\.title/);
});

test("classes.tsx: the per-row \"No price set\" badge and the unassigned badge are visually and semantically distinct conditions", () => {
  assert.match(classesPage, /badge-pricing-unconfigured-/);
  assert.match(classesPage, /badge-pricing-unassigned-/);
  // The unconfigured badge only renders when a category IS assigned.
  const cell = classesPage.slice(classesPage.indexOf("cls.pricingCategory ? ("), classesPage.indexOf("TableCell>", classesPage.indexOf("cls.pricingCategory ? (")));
  assert.match(cell, /hasUnconfiguredCategoryPrice\(cls\.pricingCategory\)/);
});

test("classes.tsx: visibility queries never write — class-pricing summary is fetched via GET only", () => {
  const queryBlock = classesPage.slice(
    classesPage.indexOf("admin-class-pricing-summary"),
    classesPage.indexOf("CATEGORY_PRICE_FIELD"),
  );
  assert.match(queryBlock, /method:\s*"GET"|fetch\(`\$\{API\}\/api\/admin\/settings\/class-pricing`,\s*\{\s*\n?\s*headers/);
  assert.doesNotMatch(queryBlock, /method:\s*"(POST|PATCH|PUT|DELETE)"/);
});
