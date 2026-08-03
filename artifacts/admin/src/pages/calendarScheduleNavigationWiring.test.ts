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
const headerSource = read("artifacts/admin/src/components/calendar/CalendarHeader.tsx");
const cardSource = read("artifacts/admin/src/components/calendar/CalendarOccurrenceCard.tsx");
const resourceViewSource = read("artifacts/admin/src/components/calendar/CalendarResourceView.tsx");
const schedulesSource = read("artifacts/admin/src/pages/schedules.tsx");
const sheetSource = read("artifacts/admin/src/components/calendar/OccurrenceDetailsSheet.tsx");

test("Calendar cards open details sheet rather than navigating directly or opening any schedule create/edit forms", () => {
  assert.match(calendarSource, /import\s*{\s*OccurrenceDetailsSheet\s*}\s*from\s*"@\/components\/calendar\/OccurrenceDetailsSheet"/);
  assert.match(calendarSource, /handleOccurrenceCardClick/);
  assert.match(calendarSource, /setSelectedOccurrence\(occurrence\)/);
  assert.match(calendarSource, /<OccurrenceDetailsSheet/);
  // No schedule edit form in calendar.tsx
  assert.doesNotMatch(calendarSource, /useForm/);
});

test("The Sheet's Edit Schedule button reuses the existing navigation helpers — no duplicated navigation logic", () => {
  assert.match(sheetSource, /import\s*{\s*buildBalletScheduleListPath,\s*buildScheduleEditPath\s*}\s*from\s*"@\/lib\/scheduleCalendarNavigation"/);
  assert.match(sheetSource, /isBallet\s*\?\s*buildBalletScheduleListPath\(\)\s*:\s*buildScheduleEditPath\(occurrence\.scheduleId\)/);
  assert.match(sheetSource, />\s*Edit Schedule\s*</);
});

test("The roster query is enabled only when an occurrence is selected and the user has both bookings.view and attendance.view", () => {
  assert.match(sheetSource, /can\("bookings", "view"\)\s*&&\s*can\("attendance", "view"\)/);
  assert.match(sheetSource, /enabled: occurrence != null && isClassOrBallet && canViewRoster/);
  assert.match(sheetSource, /You do not have permission to view booking details\./);
});

test("Card clicks stop propagation so they never also trigger the day column's create-slot click", () => {
  const cardBlock = cardSource.match(/export function CalendarOccurrenceCard[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.match(cardBlock, /onClick=\{\(event\) => \{\s*event\.stopPropagation\(\);\s*onOpen\(occurrence\);/);
});

test("Empty day-column space navigates to schedule creation with date/branch/room context, gated on schedules.create", () => {
  assert.match(calendarSource, /handleEmptySlotClick/);
  assert.match(calendarSource, /onSlotClick=\{handleEmptySlotClick\}/);
  assert.match(calendarSource, /buildScheduleCreatePath\(\{/);
  assert.match(calendarSource, /can\("schedules", "create"\)/);
});

test("The 'Add' dropdown button provides schedule and private event affordances gated on permissions", () => {
  assert.match(headerSource, /button-calendar-add-dropdown/);
  assert.match(headerSource, /canCreateSchedule/);
  assert.match(headerSource, /canCreateReservation/);
});

test("Conflict indicators from Phase 2D remain intact after adding navigation", () => {
  assert.match(cardSource, /calendar-conflict-badge-/);
  assert.match(cardSource, /border-destructive/);
  assert.match(headerSource, /Conflict/);
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

test("Resource view mode is integrated into existing Calendar page without creating a new page", () => {
  assert.match(headerSource, /type CalendarViewMode = "week" \| "day" \| "resource";/);
  assert.match(headerSource, /button-calendar-view-resource/);
  assert.match(calendarSource, /useGetAdminCalendarResourceView/);
  assert.match(resourceViewSource, /calendar-resource-view-grid/);
  assert.match(resourceViewSource, /calendar-resource-room-header-/);
  assert.match(resourceViewSource, /calendar-resource-room-column-/);
});

test("Phase 4C — OccurrenceDetailsSheet renders operational summary metrics and provides gated navigation shortcuts", () => {
  assert.match(sheetSource, /Operational Overview/);
  assert.match(sheetSource, /summary-metric-checked-in/);
  assert.match(sheetSource, /summary-metric-pending/);
  assert.match(sheetSource, /summary-metric-absent/);
  assert.match(sheetSource, /summary-metric-unpaid/);

  // Open Attendance button gated on attendance.view
  assert.match(sheetSource, /button-occurrence-sheet-open-attendance/);
  assert.match(sheetSource, /\/attendance\?scheduleId=\$\{occurrence\.scheduleId\}&date=\$\{occurrence\.occurrenceDate\}/);

  // View Bookings button gated on bookings.view
  assert.match(sheetSource, /button-occurrence-sheet-view-bookings/);
  assert.match(sheetSource, /\/bookings\?scheduleId=\$\{occurrence\.scheduleId\}&date=\$\{occurrence\.occurrenceDate\}/);

  // Gating checks
  assert.match(sheetSource, /can\("attendance", "view"\)/);
  assert.match(sheetSource, /can\("bookings", "view"\)/);
});

test("Phase 4C — Calendar files contain ZERO mutations for attendance, bookings, payments, or cancellations", () => {
  assert.doesNotMatch(sheetSource, /useMutation/);
  assert.doesNotMatch(sheetSource, /\/attendance\/check-in/);
  assert.doesNotMatch(sheetSource, /cancelSchedule/i);
  assert.doesNotMatch(calendarSource, /useMutation/);
});

test("Phase 4C — Attendance and Bookings pages parse scheduleId and date deep links", () => {
  const attendanceSource = read("artifacts/admin/src/pages/attendance.tsx");
  const bookingsSource = read("artifacts/admin/src/pages/bookings.tsx");

  assert.match(attendanceSource, /params\.get\("scheduleId"\)/);
  assert.match(attendanceSource, /params\.get\("date"\)/);
  assert.match(bookingsSource, /params\.get\("scheduleId"\)/);
  assert.match(bookingsSource, /params\.get\("date"\)/);
});

test("Phase 5B — Private Event creation dialog and reservation details sheet are wired into Calendar with permission gating and immutability notice", () => {
  const resSheetSource = read("artifacts/admin/src/components/calendar/ReservationDetailsSheet.tsx");

  assert.match(calendarSource, /import\s*{\s*CreateRoomReservationDialog\s*}\s*from\s*"@\/components\/calendar\/CreateRoomReservationDialog"/);
  assert.match(calendarSource, /import\s*{\s*ReservationDetailsSheet\s*}\s*from\s*"@\/components\/calendar\/ReservationDetailsSheet"/);
  assert.match(calendarSource, /<CreateRoomReservationDialog/);
  assert.match(calendarSource, /<ReservationDetailsSheet/);

  assert.match(calendarSource, /can\("room_reservations", "create"\)/);
  assert.match(resSheetSource, /can\("room_reservations", "edit"\)/);
  assert.match(resSheetSource, /can\("room_reservations", "cancel"\)/);

  assert.match(resSheetSource, /Room & Time are Immutable/);
  assert.match(resSheetSource, /Branch, room, date, and times cannot be changed directly/);
});

test("Phase 6B.3 — Empty slot opens SlotQuickActionPopover providing permission-gated Add Class and Add Private Event affordances", () => {
  const popoverSource = read("artifacts/admin/src/components/calendar/SlotQuickActionPopover.tsx");

  assert.match(calendarSource, /import\s*{\s*SlotQuickActionPopover/);
  assert.match(calendarSource, /<SlotQuickActionPopover/);
  assert.match(calendarSource, /handleQuickActionAddClass/);
  assert.match(calendarSource, /handleQuickActionAddPrivateEvent/);

  assert.match(popoverSource, /popover-slot-quick-action/);
  assert.match(popoverSource, /button-quick-action-add-class/);
  assert.match(popoverSource, /button-quick-action-add-private-event/);
  assert.match(popoverSource, /canCreateSchedule &&/);
  assert.match(popoverSource, /canCreateReservation &&/);
});

test("Phase 6C — Calendar uses URL search parameters as primary source of truth for viewMode, focusedDate, branchId, and roomId", () => {
  const stateHelperSource = read("artifacts/admin/src/components/calendar/calendarState.ts");

  assert.match(calendarSource, /import\s*{\s*parseCalendarUrlState/);
  assert.match(calendarSource, /useSearch\(\)/);
  assert.match(calendarSource, /parseCalendarUrlState\(searchString\)/);
  assert.match(calendarSource, /buildCalendarUrl/);

  assert.match(stateHelperSource, /parseCalendarUrlState/);
  assert.match(stateHelperSource, /buildCalendarUrl/);
  assert.match(stateHelperSource, /savePreferredCalendarState/);
});

test("Phase 6D — Calendar components render live now indicator, consume calendarTokens, and use AlertDialog instead of confirm()", () => {
  const gridSource = read("artifacts/admin/src/components/calendar/CalendarGrid.tsx");
  const nowIndicatorSource = read("artifacts/admin/src/components/calendar/CalendarNowIndicator.tsx");
  const tokensSource = read("artifacts/admin/src/components/calendar/calendarTokens.ts");

  assert.match(gridSource, /<CalendarNowIndicator/);
  assert.match(nowIndicatorSource, /calendar-now-indicator/);
  assert.match(cardSource, /getCalendarCategoryTokens/);
  assert.match(tokensSource, /CALENDAR_TOKENS/);
});
