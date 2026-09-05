import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  claimNavigationTarget,
  navigationTargetKey,
  releaseNavigationTarget,
  resetNavigationPressGateForTests,
} from "./navigationPressGate";

test.beforeEach(resetNavigationPressGateForTests);

test("rapid presses for the same destination are accepted only once", () => {
  assert.equal(claimNavigationTarget("/notifications", 1_000), true);
  assert.equal(claimNavigationTarget("/notifications", 1_050), false);
  assert.equal(claimNavigationTarget("/notifications", 2_201), true);
});

test("different destinations remain independently navigable", () => {
  assert.equal(claimNavigationTarget("/notifications", 1_000), true);
  assert.equal(claimNavigationTarget("/package-center", 1_010), true);
});

test("object routes use a stable destination and params key", () => {
  const first = { pathname: "/class/[id]", params: { id: "8", scheduleId: "3" } };
  const reordered = { params: { scheduleId: "3", id: "8" }, pathname: "/class/[id]" };
  assert.equal(navigationTargetKey(first), navigationTargetKey(reordered));
  assert.equal(claimNavigationTarget(first, 1_000), true);
  assert.equal(claimNavigationTarget(reordered, 1_100), false);
});

test("failed navigation can release its claim for an immediate retry", () => {
  const target = "/class/42";
  assert.equal(claimNavigationTarget(target, 1_000), true);
  releaseNavigationTarget(target);
  assert.equal(claimNavigationTarget(target, 1_001), true);
});

function tsxFiles(directory: URL): URL[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) return tsxFiles(child);
    return entry.name.endsWith(".tsx") ? [child] : [];
  });
}

test("app screens and shared components do not bypass the duplicate-push guard", () => {
  const roots = [new URL("../app/", import.meta.url), new URL("../components/", import.meta.url)];
  for (const file of roots.flatMap(tsxFiles)) {
    const sourceWithoutComments = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(sourceWithoutComments, /\brouter\.push\s*\(/, `${file.pathname} bypasses pushOnce`);
  }
});
