import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const landing = read("artifacts/central/app/ballet/index.tsx");
const classes = read("artifacts/central/app/ballet/classes.tsx");
const status = read("artifacts/central/app/ballet/application-status.tsx");

test("landing uses the authoritative weekly Schedule metric, not Class-card length", () => {
  assert.match(landing, /activeWeeklySessionsCount/);
  assert.doesNotMatch(landing, /balletClasses\.length|balletClassCount/);
});

test("Classes page derives a visible weekly Schedule counter after filtering", () => {
  assert.match(classes, /visibleWeeklyScheduleCount/);
  assert.match(classes, /countActiveBalletWeeklySchedules\(visibleClasses\)/);
  assert.doesNotMatch(classes, /visibleClasses\.length[^\n]*counter/);
});

test("Classes page renders one card per normalized Class while preserving all schedule rows", () => {
  assert.match(classes, /visibleClasses\.map/);
  assert.match(classes, /key=\{item\.id\}/);
  assert.match(classes, /scheduleSummary\(item\)/);
});

test("Classes page refreshes on focus and supports pull-to-refresh", () => {
  assert.match(classes, /useFocusEffect/);
  assert.match(classes, /RefreshControl/);
  assert.match(classes, /onRefresh/);
});

test("Application Status uses normalized Group schedule aggregation without singular aliases", () => {
  assert.match(status, /groupBalletSchedulesByGroupId/);
  assert.doesNotMatch(status, /cls\.schedules \?\? \(cls\.schedule/);
});

test("Application Status schedule catalogue refreshes on focus", () => {
  assert.match(status, /useFocusEffect/);
});

test("child-specific cancellation and lifecycle safeguards remain present", () => {
  assert.match(status, /hasExplicitApplicationContext/);
  assert.match(status, /expectedAssignmentId/);
  assert.match(status, /application\.childName/);
});
