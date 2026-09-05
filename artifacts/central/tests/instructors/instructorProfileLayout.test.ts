import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../../components/InstructorProfileView.tsx", import.meta.url), "utf8");

test("instructor profile uses the simplified reference layout", () => {
  assert.doesNotMatch(source, /function StatCard/);
  assert.doesNotMatch(source, /<StatCard/);
  assert.doesNotMatch(source, /STUDIO_LOGO|central_studio_logo_transparent/);
  assert.match(source, />Experiences<\/Text>/);
  assert.equal((source.match(/>Achievements<\/Text>/g) ?? []).length, 1);
});
