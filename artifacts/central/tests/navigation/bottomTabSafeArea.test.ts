import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const layoutSource = read("artifacts/central/app/(tabs)/_layout.tsx");
const tabScreenSources = [
  read("artifacts/central/app/(tabs)/index.tsx"),
  read("artifacts/central/app/(tabs)/classes.tsx"),
  read("artifacts/central/app/(tabs)/bookings.tsx"),
  read("artifacts/central/app/(tabs)/profile.tsx"),
  read("artifacts/central/app/(tabs)/packages.tsx"),
];

test("classic bottom tabs add only the device's real bottom safe-area inset", () => {
  assert.match(layoutSource, /const bottomInset = isWeb \? 0 : insets\.bottom;/);
  assert.match(layoutSource, /height: TAB_HEIGHT \+ bottomInset,/);
  assert.match(layoutSource, /paddingBottom: bottomInset,/);
  assert.match(layoutSource, /const TAB_HEIGHT\s*=\s*60;/);
});

test("a zero-inset device keeps the original 60px navigation bar", () => {
  const baseHeight = Number(layoutSource.match(/const TAB_HEIGHT\s*=\s*(\d+);/)?.[1]);
  assert.equal(baseHeight + 0, 60);
});

test("every classic tab screen reserves its bottom inset for scrollable content", () => {
  for (const source of tabScreenSources) {
    assert.match(source, /paddingBottom:[^\n]*insets\.bottom/);
  }
});
