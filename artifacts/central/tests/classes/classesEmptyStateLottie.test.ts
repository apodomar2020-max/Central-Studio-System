import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../../app/(tabs)/classes.tsx", import.meta.url), "utf8");

test("the no-classes result reuses the Ballet performance Lottie at a slower speed", () => {
  assert.match(source, /EMPTY_CLASSES_ANIMATION = require\("@\/assets\/animations\/empty-performance\.json"\)/);
  const emptyBranch = source.slice(source.indexOf("displayedClasses.length === 0"), source.indexOf(") : (", source.indexOf("displayedClasses.length === 0")));
  assert.match(emptyBranch, /<LottieView/);
  assert.match(emptyBranch, /source=\{EMPTY_CLASSES_ANIMATION\}/);
  assert.match(emptyBranch, /autoPlay/);
  assert.match(emptyBranch, /loop/);
  assert.match(emptyBranch, /speed=\{0\.65\}/);
  assert.doesNotMatch(emptyBranch, /<XI name="search"/);
});

test("Clear Filters uses the same solid primary action treatment as Ballet Classes", () => {
  assert.match(source, /clearBtn: \{[\s\S]{0,140}paddingHorizontal: 24, paddingVertical: 13, borderRadius: 24,[\s\S]{0,80}backgroundColor: CYAN/);
  assert.match(source, /clearBtnText: \{ fontSize: 14, fontFamily: "Archivo_800ExtraBold", color: INK_900 \}/);
});
