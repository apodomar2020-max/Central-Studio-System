/**
 * Source-inspection coverage for Calendar Phase 3's navigation wiring —
 * same style as scheduleDeletionProtection.test.ts / branches.test.ts (this
 * app has no React component-rendering test harness, so existing frontend
 * coverage confirms expected code patterns are present in the real source
 * rather than mounting components). Pure logic (the URL builders and time
 * rounding) is covered with real assertions in
 * lib/scheduleCalendarNavigation.test.ts instead — this file only checks
 * that calendar.tsx and schedules.tsx are actually wired to each other and
 * that schedules.tsx's pre-existing create/edit flow was not touched.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const calendarSource = read("artifacts/admin/src/pages/calendar.tsx");
const schedulesSource = read("artifacts/admin/src/pages/schedules.tsx");
const sheetSource = read("artifacts/admin/src/components/calendar/OccurrenceDetailsSheet.tsx");

test("Calendar cards open the OccurrenceDetailsSheet rather than navigating directly or opening any Calendar-owned dialog", () => {
  assert.match(calendarSource, /import\s*{\s*OccurrenceDetailsSheet\s*}\s*from\s*"@\/components\/calendar\/OccurrenceDetailsSheet"/);
  assert.match(calendarSource, /openOccurrenceInScheduleManager/);
  assert.match(calendarSource, /setSelectedOccurrence\(occurrence\)/);
  assert.match(calendarSource, /<OccurrenceDetailsSheet/);
  // No Calendar-owned Dialog/Form for schedules exists — the only Dialog
  // usage anywhere in this file would be a regression of "no Calendar
  // create dialogs / edit forms".
  assert.doesNotMatch(calendarSource, /<Dialog/);
  assert.doesNotMatch(calendarSource, /useForm/);
  assert.doesNotMatch(calendarSource, /useMutation/);
});

test("The Sheet's Edit Schedule button reuses the existing navigation helpers — no duplicated navigation logic", () => {
  assert.match(sheetSource, /import\s*{\s*buildBalletScheduleListPath,\s*buildScheduleEditPath\s*}\s*from\s*"@\/lib\/scheduleCalendarNavigation"/);
  assert.match(sheetSource, /isBallet\s*\?\s*buildBalletScheduleListPath\(\)\s*:\s*buildScheduleEditPath\(occurrence\.scheduleId\)/);
  assert.match(sheetSource, />\s*Edit Schedule\s*</);
});

test("The roster query is enabled only when an occurrence is selected and the user has both bookings.view and attendance.view", () => {
  assert.match(sheetSource, /can\("bookings", "view"\)\s*&&\s*can\("attendance", "view"\)/);
  assert.match(sheetSource, /enabled: occurrence != null && canViewRoster/);
  assert.match(sheetSource, /You do not have permission to view booking details\./);
});

test("Card clicks stop propagation so they never also trigger the day column's create-slot click", () => {
  const cardBlock = calendarSource.match(/function OccurrenceCard[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.match(cardBlock, /onClick=\{\(event\) => \{\s*event\.stopPropagation\(\);\s*onOpen\(occurrence\);/);
});

test("Empty day-column space navigates to schedule creation with date/branch/room context, gated on schedules.create", () => {
  assert.match(calendarSource, /handleEmptySlotClick/);
  assert.match(calendarSource, /onClick=\{canCreateSchedule \? \(event\) => handleEmptySlotClick\(event, dateKey\) : undefined\}/);
  assert.match(calendarSource, /buildScheduleCreatePath\(\{ date: dateKey, startTime, branchId, roomId \}\)/);
  assert.match(calendarSource, /can\("schedules", "create"\)/);
});

test("The 'Add Schedule' button is Calendar's only creation affordance and is gated on schedules.create", () => {
  assert.match(calendarSource, /button-calendar-add-schedule/);
  assert.match(calendarSource, /canCreateSchedule && \(/);
  assert.match(calendarSource, /handleAddScheduleClick/);
});

test("Conflict indicators from Phase 2D remain intact after adding navigation", () => {
  assert.match(calendarSource, /calendar-conflict-badge-/);
  assert.match(calendarSource, /border-destructive/);
  assert.match(calendarSource, />Conflict<\/span>/);
});

test("Schedules page reads Calendar's deep-link query params via wouter's useSearch/useLocation", () => {
  assert.match(schedulesSource, /import\s*{\s*useLocation,\s*useSearch\s*}\s*from\s*"wouter"/);
  assert.match(schedulesSource, /const urlSearch = useSearch\(\);/);
  assert.match(schedulesSource, /params\.get\("editScheduleId"\)/);
  assert.match(schedulesSource, /params\.get\("date"\)/);
  assert.match(schedulesSource, /params\.get\("startTime"\)/);
  assert.match(schedulesSource, /params\.get\("branchId"\)/);
  assert.match(schedulesSource, /params\.get\("roomId"\)/);
});

test("Deep-link edit reuses the existing openEdit — no second edit form is created", () => {
  assert.match(schedulesSource, /if \(target && canEdit\) openEdit\(target\);/);
  // Only one dialog exists in this file — its title switches between Edit
  // and Add depending on `editing`, exactly as before this phase.
  const dialogMatches = schedulesSource.match(/<Dialog open=\{open\}/g) ?? [];
  assert.equal(dialogMatches.length, 1, "exactly one schedule Dialog must exist");
});

test("Deep-link create reuses openCreateWithContext, which itself reuses the existing form/onSubmit — not a new create path", () => {
  assert.match(schedulesSource, /const openCreateWithContext = \(context: \{[^}]*\}\) => \{/);
  assert.match(schedulesSource, /if \(canCreate\) \{\s*openCreateWithContext\(\{/);
  // openCreateWithContext must funnel into the same setOpen/form.reset the
  // original openCreate uses, not a parallel dialog/state pair.
  const contextFnBlock = schedulesSource.match(/const openCreateWithContext[\s\S]*?setOpen\(true\);\s*\};/)?.[0] ?? "";
  assert.match(contextFnBlock, /form\.reset\(/);
  assert.match(contextFnBlock, /setOpen\(true\);/);
});

test("Deep-link handling clears the query string after consuming it, and does not run more than once", () => {
  assert.match(schedulesSource, /deepLinkHandledRef/);
  assert.match(schedulesSource, /navigate\("\/schedules", \{ replace: true \}\)/);
});

test("Pre-existing direct /schedules usage (create button, edit button, submit) is completely unchanged", () => {
  assert.match(schedulesSource, /addLabel="Add Schedule" addTestId="button-add-schedule" onAdd=\{canCreate \? openCreate : undefined\}/);
  assert.match(schedulesSource, /button-edit-schedule-\$\{schedule\.id\}/);
  assert.match(schedulesSource, /button-submit-schedule/);
  assert.match(schedulesSource, /const onSubmit = \(values: FormValues\) => \{/);
});
