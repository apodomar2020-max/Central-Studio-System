import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const home = readFileSync(new URL("../../app/(tabs)/index.tsx", import.meta.url), "utf8");
const packages = readFileSync(new URL("../../components/AvailablePackagesSection.tsx", import.meta.url), "utf8");

test("Home does not render cached catalogue content before a fresh mount fetch", () => {
  assert.match(home, /useListHeroItems\([\s\S]{0,130}refetchOnMount: "always"/);
  assert.match(home, /heroFresh[\s\S]{0,220}\? \(allHero \?\? \[\]\)/);
  assert.match(home, /!homeClassesFresh \|\| schedsLoading \|\| classesLoading/);
  assert.match(home, /!instructorsFresh \|\| instLoading/);
  assert.match(home, /<AvailablePackagesSection mode="home" requireFreshData \/>/);
  assert.match(packages, /const dataReady = !requireFreshData \|\| isFetchedAfterMount/);
});

test("fresh Home responses revise remote image URLs instead of reusing old native image cache entries", () => {
  assert.ok((home.match(/withMediaRevision\(/g) ?? []).length >= 5);
  assert.match(packages, /imageRevision=\{requireFreshData \? dataUpdatedAt : undefined\}/);
});
