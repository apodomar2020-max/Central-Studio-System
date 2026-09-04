import assert from "node:assert/strict";
import test from "node:test";

import { packageMatchesAgeBand, parsePackageAgeBand } from "./packageAgeBands";

test("class age-group labels map to Package Center filters", () => {
  assert.equal(parsePackageAgeBand("Adults"), "adults");
  assert.equal(parsePackageAgeBand("TEENS"), "teens");
  assert.equal(parsePackageAgeBand("Kids"), "kids");
  assert.equal(parsePackageAgeBand("unknown"), null);
});

test("package filters use the same 5–12, 13–17, and 18+ age bands as admin", () => {
  const kids = { allowAllAges: false, minAge: 5, maxAge: 12 };
  const teens = { allowAllAges: false, minAge: 13, maxAge: 17 };
  const adults = { allowAllAges: false, minAge: 18, maxAge: null };

  assert.equal(packageMatchesAgeBand(kids, "kids"), true);
  assert.equal(packageMatchesAgeBand(kids, "teens"), false);
  assert.equal(packageMatchesAgeBand(teens, "teens"), true);
  assert.equal(packageMatchesAgeBand(teens, "adults"), false);
  assert.equal(packageMatchesAgeBand(adults, "adults"), true);
  assert.equal(packageMatchesAgeBand(adults, "kids"), false);
});

test("all-age packages remain available in every customer category", () => {
  const allAges = { allowAllAges: true, minAge: null, maxAge: null };
  assert.equal(packageMatchesAgeBand(allAges, "kids"), true);
  assert.equal(packageMatchesAgeBand(allAges, "teens"), true);
  assert.equal(packageMatchesAgeBand(allAges, "adults"), true);
});
