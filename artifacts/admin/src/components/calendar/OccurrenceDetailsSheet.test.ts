/**
 * Source-inspection coverage for Phase 4A.2's Occurrence Details Sheet — same
 * style as calendarScheduleNavigationWiring.test.ts (no React rendering
 * harness exists in this app). Confirms the Sheet component exists and is
 * wired correctly, without mounting it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const sheetSource = read("artifacts/admin/src/components/calendar/OccurrenceDetailsSheet.tsx");
const calendarSource = read("artifacts/admin/src/pages/calendar.tsx");

test("OccurrenceDetailsSheet component exists and uses Sheet, not Dialog", () => {
  assert.match(sheetSource, /export function OccurrenceDetailsSheet/);
  assert.match(sheetSource, /import\s*{[\s\S]*?Sheet,[\s\S]*?SheetContent,[\s\S]*?SheetDescription,[\s\S]*?SheetFooter,[\s\S]*?SheetHeader,[\s\S]*?SheetTitle,?[\s\S]*?}\s*from\s*"@\/components\/ui\/sheet"/);
  assert.match(sheetSource, /<Sheet /);
  assert.doesNotMatch(sheetSource, /<Dialog/);
});

test("Calendar opens the Sheet on card click instead of navigating directly to edit", () => {
  assert.match(calendarSource, /<OccurrenceDetailsSheet/);
  // Class/ballet occurrences route to setSelectedOccurrence (this Sheet);
  // reservation occurrences route to setSelectedReservationId
  // (ReservationDetailsSheet) instead — both are opened from the same
  // click handler, neither navigates directly.
  assert.match(calendarSource, /const handleOccurrenceCardClick = \(occurrence: CalendarOccurrence\) => {/);
  assert.match(calendarSource, /if \(occurrence\.source === "reservation"\) {\s*setSelectedReservationId\(occurrence\.scheduleId\);\s*} else {\s*setSelectedOccurrence\(occurrence\);\s*}/);
});

test("The roster query is enabled only when the Sheet is open, for class/ballet occurrences, and only with roster permission", () => {
  assert.match(sheetSource, /useGetAdminCalendarOccurrenceRoster/);
  // isClassOrBallet excludes "reservation" — reservations have no
  // scheduleId/occurrenceDate roster of their own (ReservationDetailsSheet
  // owns that data instead), so the roster endpoint must never be called
  // for them even if permissions allow it.
  assert.match(sheetSource, /const isClassOrBallet = occurrence\?\.source === "class" \|\| occurrence\?\.source === "ballet";/);
  assert.match(sheetSource, /enabled: occurrence != null && isClassOrBallet && canViewRoster/);
});

test("The roster query's source param is derived from the occurrence's source (ballet vs class), not hardcoded", () => {
  assert.match(sheetSource, /const rosterSource = occurrence\?\.source === "ballet" \? "ballet" : "class";/);
  assert.match(sheetSource, /rosterParams = {\s*source: rosterSource,/);
});

test("Permission checks gate the roster section on bookings.view AND attendance.view", () => {
  assert.match(sheetSource, /const canViewRoster = can\("bookings", "view"\) && can\("attendance", "view"\);/);
  assert.match(sheetSource, /You do not have permission to view booking details\./);
});

test("The Edit Schedule button reuses the existing navigation helpers", () => {
  assert.match(sheetSource, /import\s*{\s*buildBalletScheduleListPath,\s*buildScheduleEditPath\s*}\s*from\s*"@\/lib\/scheduleCalendarNavigation"/);
  assert.match(sheetSource, /buildBalletScheduleListPath\(\)\s*:\s*buildScheduleEditPath\(occurrence\.scheduleId\)/);
  assert.match(sheetSource, />\s*Edit Schedule\s*</);
});

test("Calendar remains navigation-only — no Dialog, useForm, or mutation calls were added to it", () => {
  assert.doesNotMatch(calendarSource, /<Dialog/);
  assert.doesNotMatch(calendarSource, /useForm/);
  assert.doesNotMatch(calendarSource, /useMutation/);
});
