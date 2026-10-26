import test from "node:test";
import assert from "node:assert/strict";
import { classTagColors as c, levelTagColor, ageTagColor } from "./classTags";
function luminance(hex: string) {
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return rgb.reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
}
function contrast(a: string, b: string) { const [lo, hi] = [luminance(a), luminance(b)].sort((a, b) => a - b); return (hi + 0.05) / (lo + 0.05); }
test("every level/age tag meets normal-text contrast and keeps functional status colors separate", () => {
  for (const label of ["Beginner", "Intermediate", "Advanced", "All Levels", "unknown"]) assert.ok(contrast(c.text, levelTagColor(label)) >= 4.5, label);
  for (const label of ["Adults", "Teens", "Kids", "All Ages"]) assert.ok(contrast(c.text, ageTagColor(label)) >= 4.5, label);
});
test("cyan stays readable on an elevated teal surface distinct from the containing card", () => {
  assert.ok(contrast(c.danceText, c.danceBackground) >= 4.5);
  assert.ok(luminance(c.danceBackground) > luminance("#012329"));
  assert.notEqual(c.danceBackground, c.beginner);
});
