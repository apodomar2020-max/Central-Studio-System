import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
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

test("My Ballet Classes derives the counter from the selected child's entitled Schedules", () => {
  assert.match(classes, /visibleWeeklyScheduleCount/);
  assert.match(classes, /selectedChild\.weeklyScheduleCount/);
  assert.doesNotMatch(classes, /visibleClasses\.length[^\n]*counter|balletClasses\.length/);
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

test("Classes page uses only the authenticated child entitlement endpoint", () => {
  assert.match(classes, /fetchMyBalletClasses/);
  assert.doesNotMatch(classes, /fetchBalletClasses|fetchBalletLevels/);
  assert.match(classes, /\/api\/ballet\/classes\/my|fetchMyBalletClasses/);
});

test("child selector uses stable keys and preserves selection across refresh", () => {
  assert.match(classes, /key=\{child\.selectorKey\}/);
  assert.match(classes, /setSelectedChildKey\(child\.selectorKey\)/);
  assert.match(classes, /resolveBalletChildSelection\(response\.children, current\)/);
  assert.doesNotMatch(classes, /children\[0\]|applications\[0\]/);
});

test("non-entitled lifecycle states render explicit empty states without a public fallback", () => {
  for (const copy of ["No Ballet Classes Yet", "Application Pending", "Assessment In Progress", "Placement In Progress", "Payment Pending", "Activation Pending", "Schedule Not Assigned Yet", "Enrollment Ended"]) {
    assert.match(classes, new RegExp(copy));
  }
  assert.match(classes, /Sign In to View Classes/);
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

test("Expo Router app directory contains no Node-based test modules", () => {
  const visit = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? visit(path) : [path];
  });
  const routeFiles = visit(resolve(process.cwd(), "artifacts/central/app"));
  assert.equal(routeFiles.some((path) => /\.(test|spec)\.tsx?$/.test(path)), false);
  for (const path of routeFiles.filter((value) => /\.tsx?$/.test(value))) {
    assert.doesNotMatch(readFileSync(path, "utf8"), /["']node:(?:assert|fs|path|test)(?:\/strict)?["']/);
  }
});
