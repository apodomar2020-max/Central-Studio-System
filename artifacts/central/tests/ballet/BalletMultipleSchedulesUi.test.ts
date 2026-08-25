import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const landing = read("artifacts/central/app/ballet/index.tsx");
const classes = read("artifacts/central/app/ballet/classes.tsx");
const status = read("artifacts/central/app/ballet/application-status.tsx");
const bookings = read("artifacts/central/app/(tabs)/bookings.tsx");

function inlineStyle(source: string, name: string): string {
  const match = source.match(new RegExp(`\\n\\s*${name}: (\\{[^\\n]+\\}),`));
  assert.ok(match, `missing inline style ${name}`);
  return match[1];
}

test("landing omits the retired Ballet summary metrics", () => {
  assert.doesNotMatch(landing, /activeWeeklySessionsCount|activeStudentsCount|Classes\/week/);
  assert.doesNotMatch(landing, /balletClasses\.length|balletClassCount/);
});

test("My Ballet Classes derives the counter from the selected child's entitled Schedules", () => {
  assert.match(classes, /visibleWeeklyScheduleCount/);
  assert.match(classes, /selectedChild\.weeklyScheduleCount/);
  assert.doesNotMatch(classes, /visibleClasses\.length[^\n]*counter|balletClasses\.length/);
});

test("Classes page renders one card per entitled weekly schedule", () => {
  assert.match(classes, /visibleClasses\.flatMap/);
  assert.match(classes, /item\.schedules\.map/);
  assert.match(classes, /visibleSchedules\.map/);
  assert.match(classes, /<BalletScheduleCard/);
  assert.doesNotMatch(classes, /scheduleSummary\(item\)/);
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

test("My Ballet Classes child pills match the My Bookings filter source values", () => {
  for (const styleName of [
    "filterScroll",
    "filterChip",
    "filterChipActive",
    "filterAvatar",
    "filterAvatarText",
    "filterChipText",
    "filterChipTextActive",
  ]) {
    assert.equal(inlineStyle(classes, styleName), inlineStyle(bookings, styleName), `${styleName} must match My Bookings`);
  }
  assert.match(classes, /child\.childName\.slice\(0, 2\)\.toUpperCase\(\)/);
  assert.match(bookings, /st\.slice\(0, 2\)\.toUpperCase\(\)/);
});

test("Ballet selector remains single-child only with Bookings press behavior", () => {
  const selector = classes.slice(classes.indexOf("{children.map((child)"), classes.indexOf("</ScrollView>", classes.indexOf("{children.map((child)")));
  assert.doesNotMatch(selector, /activeOpacity/);
  assert.doesNotMatch(classes, /SELECT CHILD|All Students/);
  assert.match(classes, /key=\{child\.selectorKey\}/);
  assert.match(bookings, /st === "All" \? "All Students" : st/);
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

test("Application Status shows the paid plan expiry and resets its background crop only at the bottom", () => {
  assert.match(status, /label="Expiration Date" value=\{formatDateValue\(attendance\.subscriptionExpiresAt\)\}/);
  assert.doesNotMatch(status, /label="Billing Month"/);
  assert.match(inlineStyle(status, "applicationChrome"), /backgroundColor: "#000000"/);
  assert.match(inlineStyle(status, "pageBackgroundCrop"), /bottom: 36/);
  assert.match(inlineStyle(status, "pageBackgroundImage"), /bottom: -36/);
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
