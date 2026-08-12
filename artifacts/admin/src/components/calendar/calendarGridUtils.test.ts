import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  calculateCalendarTimeRange,
  formatHourLabel,
  hourLabelTranslateClass,
  isCompactCardHeight,
  showsSecondaryLine,
  packDayColumns,
  packDayRowsStacked,
  GRID_START_MIN,
  GRID_END_MIN,
} from "./CalendarOccurrenceCard";

test("calculateCalendarTimeRange — returns default 12 PM–12 AM range when occurrences is empty", () => {
  const result = calculateCalendarTimeRange([]);
  assert.equal(result.startMinute, GRID_START_MIN);
  assert.equal(result.endMinute, GRID_END_MIN);
});

test("calculateCalendarTimeRange — earliest event exactly on the hour (8:00 AM) starts the grid at 8:00 AM", () => {
  const result = calculateCalendarTimeRange([
    { source: "class", scheduleId: 1, occurrenceDate: "2026-08-03", startTime: "08:00", endTime: "09:00", bookingCount: 5 },
  ]);
  assert.equal(result.startMinute, 480);
  assert.equal(result.endMinute, GRID_END_MIN);
});

test("calculateCalendarTimeRange — earliest event mid-hour (8:30 AM) rounds the grid start back to 8:00 AM, not 8:30", () => {
  const result = calculateCalendarTimeRange([
    { source: "class", scheduleId: 1, occurrenceDate: "2026-08-03", startTime: "08:30", endTime: "09:30", bookingCount: 5 },
  ]);
  assert.equal(result.startMinute, 480);
});

test("calculateCalendarTimeRange — earliest event at 9:20 AM rounds the grid start back to 9:00 AM", () => {
  const result = calculateCalendarTimeRange([
    { source: "class", scheduleId: 1, occurrenceDate: "2026-08-03", startTime: "09:20", endTime: "10:00", bookingCount: 5 },
  ]);
  assert.equal(result.startMinute, 540);
});

test("calculateCalendarTimeRange — never shrinks below the default 12 PM–12 AM range for afternoon/evening-only events", () => {
  const result = calculateCalendarTimeRange([
    { source: "reservation", scheduleId: 3, occurrenceDate: "2026-08-03", startTime: "23:15", endTime: "23:45", bookingCount: 0 },
  ]);
  assert.equal(result.startMinute, GRID_START_MIN);
  assert.equal(result.endMinute, GRID_END_MIN);
});

test("calculateCalendarTimeRange — expands backward to the earliest full hour across multiple events, end stays clamped to midnight", () => {
  const result = calculateCalendarTimeRange([
    { source: "class", scheduleId: 1, occurrenceDate: "2026-08-03", startTime: "08:00", endTime: "09:00", bookingCount: 2 },
    { source: "ballet", scheduleId: 2, occurrenceDate: "2026-08-03", startTime: "14:00", endTime: "15:30", bookingCount: 0 },
    { source: "reservation", scheduleId: 3, occurrenceDate: "2026-08-03", startTime: "22:00", endTime: "23:00", bookingCount: 0 },
  ]);
  assert.equal(result.startMinute, 480);
  assert.equal(result.endMinute, 1440);
});

test("calculateCalendarTimeRange — clamps to 0 for a pre-dawn event and rounds its odd end time up to the next full hour", () => {
  const result = calculateCalendarTimeRange([
    { source: "class", scheduleId: 1, occurrenceDate: "2026-08-03", startTime: "00:15", endTime: "01:00", bookingCount: 1 },
  ]);
  assert.equal(result.startMinute, 0);
  assert.equal(result.endMinute, 1440);
});

test("formatHourLabel — always shows full-hour labels with minutes, never a bare hour", () => {
  assert.equal(formatHourLabel(480), "8:00 AM");
  assert.equal(formatHourLabel(540), "9:00 AM");
  assert.equal(formatHourLabel(600), "10:00 AM");
  assert.equal(formatHourLabel(660), "11:00 AM");
  assert.equal(formatHourLabel(720), "12:00 PM");
  assert.equal(formatHourLabel(1440), "12:00 AM");
});

test("formatHourLabel — still formats non-hour minutes correctly (used by the live now-indicator, not grid labels)", () => {
  assert.equal(formatHourLabel(450), "7:30 AM");
  assert.equal(formatHourLabel(810), "1:30 PM");
  assert.equal(formatHourLabel(1410), "11:30 PM");
});

test("hourLabelTranslateClass — anchors the first label to its own top edge (never pokes above the container)", () => {
  assert.equal(hourLabelTranslateClass(0, 5), "");
});

test("hourLabelTranslateClass — anchors the last label to its own bottom edge (never pokes below the container)", () => {
  assert.equal(hourLabelTranslateClass(4, 5), "-translate-y-full");
});

test("hourLabelTranslateClass — centers every interior label on its tick line, same as before", () => {
  assert.equal(hourLabelTranslateClass(1, 5), "-translate-y-1/2");
  assert.equal(hourLabelTranslateClass(2, 5), "-translate-y-1/2");
  assert.equal(hourLabelTranslateClass(3, 5), "-translate-y-1/2");
});

test("hourLabelTranslateClass — a single-mark grid anchors to the top (never centers past its only edge)", () => {
  assert.equal(hourLabelTranslateClass(0, 1), "");
});

test("packDayRowsStacked — Phase 6G: non-overlapping events keep their natural chronological top and always get col:0/totalCols:1 (full width)", () => {
  const result = packDayRowsStacked(
    [
      { source: "class", scheduleId: 1, occurrenceDate: "2026-08-04", startTime: "09:00", endTime: "10:00", bookingCount: 0 },
      { source: "class", scheduleId: 2, occurrenceDate: "2026-08-04", startTime: "11:00", endTime: "12:00", bookingCount: 0 },
    ],
    GRID_START_MIN,
  );
  assert.equal(result[0].stackTopPx, (9 * 60 - GRID_START_MIN));
  assert.equal(result[1].stackTopPx, (11 * 60 - GRID_START_MIN));
  assert.deepEqual(result.map((r) => [r.col, r.totalCols]), [[0, 1], [0, 1]]);
});

test("packDayRowsStacked — three simultaneous 09:00 events stack vertically, one below another, instead of splitting into columns", () => {
  const result = packDayRowsStacked(
    [
      { source: "class", scheduleId: 1, occurrenceDate: "2026-08-04", startTime: "09:00", endTime: "09:30", bookingCount: 0 },
      { source: "ballet", scheduleId: 2, occurrenceDate: "2026-08-04", startTime: "09:00", endTime: "09:30", bookingCount: 0 },
      { source: "reservation", scheduleId: 3, occurrenceDate: "2026-08-04", startTime: "09:00", endTime: "09:30", bookingCount: 0 },
    ],
    GRID_START_MIN,
  );
  const naturalTop = 9 * 60 - GRID_START_MIN;
  assert.equal(result[0].stackTopPx, naturalTop);
  // Each subsequent overlapping card is pushed below the previous card's bottom + gap, not narrowed into a column.
  assert.equal(result[1].stackTopPx, result[0].stackTopPx + 30 + 3);
  assert.equal(result[2].stackTopPx, result[1].stackTopPx + 30 + 3);
  assert.ok(result.every((r) => r.totalCols === 1), "every stacked card is full width (totalCols 1), never split");
});

test("packDayRowsStacked — self-corrects to the natural position once a real time gap follows an overlapping cluster", () => {
  const result = packDayRowsStacked(
    [
      { source: "class", scheduleId: 1, occurrenceDate: "2026-08-04", startTime: "09:00", endTime: "10:00", bookingCount: 0 },
      { source: "class", scheduleId: 2, occurrenceDate: "2026-08-04", startTime: "09:00", endTime: "09:30", bookingCount: 0 },
      // Starts well after both above events truly end — must NOT inherit any cascade drift.
      { source: "class", scheduleId: 3, occurrenceDate: "2026-08-04", startTime: "13:00", endTime: "14:00", bookingCount: 0 },
    ],
    GRID_START_MIN,
  );
  assert.equal(result[2].stackTopPx, 13 * 60 - GRID_START_MIN);
});

test("packDayRowsStacked — Phase 6H regression: a card starting exactly when a stacked cluster's real end time is reached must not visually collide with that cluster's cascaded (pushed-down) bottom", () => {
  // Four 13:00-starting events (one short, three ending exactly at 14:00) —
  // stacking pushes the later ones well past 14:00 on screen. A fifth event
  // that starts at exactly 14:00 has no REAL time overlap with the cluster,
  // but its natural pixel position can still fall inside where the cascade
  // pushed the later stacked cards — it must be pushed down too.
  const result = packDayRowsStacked(
    [
      { source: "class", scheduleId: 1, occurrenceDate: "2026-08-04", startTime: "13:00", endTime: "13:15", bookingCount: 0 },
      { source: "class", scheduleId: 2, occurrenceDate: "2026-08-04", startTime: "13:00", endTime: "14:00", bookingCount: 0 },
      { source: "class", scheduleId: 3, occurrenceDate: "2026-08-04", startTime: "13:00", endTime: "14:00", bookingCount: 0 },
      { source: "class", scheduleId: 4, occurrenceDate: "2026-08-04", startTime: "13:00", endTime: "14:00", bookingCount: 0 },
      { source: "ballet", scheduleId: 5, occurrenceDate: "2026-08-04", startTime: "14:00", endTime: "15:00", bookingCount: 0 },
    ],
    GRID_START_MIN,
  );
  const fifth = result[4];
  const fourth = result[3];
  const fourthBottom = fourth.stackTopPx + Math.max(24, 60);
  assert.ok(
    fifth.stackTopPx >= fourthBottom + 3,
    `expected the 14:00 card to render at or below the previous card's bottom + gap (${fourthBottom + 3}), got ${fifth.stackTopPx}`,
  );
});

test("packDayColumns (Resource View) is unchanged — still splits overlapping events into side-by-side columns", () => {
  const result = packDayColumns([
    { source: "class", scheduleId: 1, occurrenceDate: "2026-08-04", startTime: "09:00", endTime: "09:30", bookingCount: 0 },
    { source: "class", scheduleId: 2, occurrenceDate: "2026-08-04", startTime: "09:00", endTime: "09:30", bookingCount: 0 },
  ]);
  assert.deepEqual(result.map((r) => r.col), [0, 1]);
  assert.ok(result.every((r) => r.totalCols === 2));
  assert.ok(result.every((r) => r.stackTopPx === undefined), "packDayColumns never sets stackTopPx");
});

test("isCompactCardHeight — only affects padding, never content; true below 32px", () => {
  assert.equal(isCompactCardHeight(24), true);
  assert.equal(isCompactCardHeight(31), true);
  assert.equal(isCompactCardHeight(32), false);
  assert.equal(isCompactCardHeight(100), false);
});

test("CalendarOccurrenceCard source — title always renders unconditionally; the old 3-tier size system is gone; no time range ever shown", () => {
  const cardSource = readFileSync(
    resolve(process.cwd(), "artifacts/admin/src/components/calendar/CalendarOccurrenceCard.tsx"),
    "utf8",
  );
  assert.match(cardSource, /\{displayTitle\}/);
  // The old Phase 6F 3-tier ("small"/"medium"/"large") system is gone —
  // Phase 6H's single showsSecondaryLine(height) threshold replaced it.
  assert.doesNotMatch(cardSource, /size === "medium"/);
  assert.doesNotMatch(cardSource, /size === "large"/);
  assert.doesNotMatch(cardSource, /organizerOrInstructor/);
  // Never shown on-card, at any height.
  assert.doesNotMatch(cardSource, /occurrence\.startTime\}–\{occurrence\.endTime\}/);
});

test("CalendarOccurrenceCard source — never renders location, booking count, or capacity on-card (moved to detail sheets)", () => {
  const cardSource = readFileSync(
    resolve(process.cwd(), "artifacts/admin/src/components/calendar/CalendarOccurrenceCard.tsx"),
    "utf8",
  );
  assert.doesNotMatch(cardSource, /occurrence\.branchName/);
  assert.doesNotMatch(cardSource, /occurrence\.roomName/);
  assert.doesNotMatch(cardSource, /occurrence\.bookingCount/);
  assert.doesNotMatch(cardSource, /occurrence\.capacity/);
  assert.doesNotMatch(cardSource, />\s*\{occurrence\.bookingCount\}|booked</);
});

test("CalendarOccurrenceCard source — keeps the conflict indicator and category background/border tokens", () => {
  const cardSource = readFileSync(
    resolve(process.cwd(), "artifacts/admin/src/components/calendar/CalendarOccurrenceCard.tsx"),
    "utf8",
  );
  assert.match(cardSource, /calendar-conflict-badge-/);
  assert.match(cardSource, /getCalendarCategoryTokens/);
  assert.match(cardSource, /tokens\.bg/);
  assert.match(cardSource, /tokens\.border/);
  assert.match(cardSource, /border-destructive/);
});

test("CalendarOccurrenceCard source — title uses the theme-safe foreground token, never a category color, for text", () => {
  const cardSource = readFileSync(
    resolve(process.cwd(), "artifacts/admin/src/components/calendar/CalendarOccurrenceCard.tsx"),
    "utf8",
  );
  assert.match(cardSource, /text-foreground/);
  assert.doesNotMatch(cardSource, /tokens\.text/);
});

test("CalendarOccurrenceCard source — title (and optional secondary line) are each single-line with ellipsis, and the card vertically centers its content block", () => {
  const cardSource = readFileSync(
    resolve(process.cwd(), "artifacts/admin/src/components/calendar/CalendarOccurrenceCard.tsx"),
    "utf8",
  );
  assert.match(cardSource, /truncate/);
  // flex-col justify-center centers the 1-2 line content block vertically —
  // replaces the old single-line-only "flex items-center" from Phase 6F.
  assert.match(cardSource, /flex flex-col justify-center/);
});

test("calendarTokens — night: (not dark:) gates the light-mode override, matching this app's .night theme toggle", () => {
  const tokensSource = readFileSync(
    resolve(process.cwd(), "artifacts/admin/src/components/calendar/calendarTokens.ts"),
    "utf8",
  );
  assert.match(tokensSource, /night:bg-/);
  assert.doesNotMatch(tokensSource, /dark:bg-/);
  assert.doesNotMatch(tokensSource, /dark:text-/);
});

test("index.css — registers a night custom variant so night: utility classes actually apply", () => {
  const cssSource = readFileSync(resolve(process.cwd(), "artifacts/admin/src/index.css"), "utf8");
  assert.match(cssSource, /@custom-variant night \(&:is\(\.night \*\)\);/);
});

test("Week/Day view (CalendarGrid) delegates rendering to ScheduleBoardView layout", () => {
  const gridSource = readFileSync(
    resolve(process.cwd(), "artifacts/admin/src/components/calendar/CalendarGrid.tsx"),
    "utf8",
  );
  assert.match(gridSource, /ScheduleBoardView/);
  assert.doesNotMatch(gridSource, /packDayColumns/);
});

test("Phase 6G — Resource View (CalendarResourceView) is untouched — still uses column packing, not stacking", () => {
  const resourceViewSource = readFileSync(
    resolve(process.cwd(), "artifacts/admin/src/components/calendar/CalendarResourceView.tsx"),
    "utf8",
  );
  assert.match(resourceViewSource, /packDayColumns/);
  assert.doesNotMatch(resourceViewSource, /packDayRowsStacked/);
});

test("Admin content wrapper is globally full-width with responsive shell-owned padding", () => {
  const appSource = readFileSync(resolve(process.cwd(), "artifacts/admin/src/App.tsx"), "utf8");
  const shellCssSource = readFileSync(
    resolve(process.cwd(), "artifacts/admin/src/components/layout/admin2-shell.css"),
    "utf8",
  );
  assert.match(appSource, /className="admin2-page-content relative max-w-none"/);
  assert.match(shellCssSource, /\.admin2-page-content\{width:100%;padding:/);
  assert.match(shellCssSource, /@media\(max-width:1023px\)\{[\s\S]*?\.admin2-page-content\{padding:/);
  assert.doesNotMatch(appSource, /mx-auto max-w-\[1540px\]/);
});

test("Phase 6H — packDayRowsStacked source still exists and Resource View is still untouched", () => {
  const cardSource = readFileSync(
    resolve(process.cwd(), "artifacts/admin/src/components/calendar/CalendarOccurrenceCard.tsx"),
    "utf8",
  );
  const resourceViewSource = readFileSync(
    resolve(process.cwd(), "artifacts/admin/src/components/calendar/CalendarResourceView.tsx"),
    "utf8",
  );
  assert.match(cardSource, /export function packDayRowsStacked/);
  assert.match(resourceViewSource, /packDayColumns/);
  assert.doesNotMatch(resourceViewSource, /packDayRowsStacked/);
});

test("showsSecondaryLine — tall enough cards (>=40px) can show one secondary line (instructor/organizer); short cards never do", () => {
  assert.equal(showsSecondaryLine(24), false);
  assert.equal(showsSecondaryLine(39), false);
  assert.equal(showsSecondaryLine(40), true);
  assert.equal(showsSecondaryLine(100), true);
});

test("CalendarOccurrenceCard source — secondary line, when shown, is instructor or organizer/type only — never location or booking count", () => {
  const cardSource = readFileSync(
    resolve(process.cwd(), "artifacts/admin/src/components/calendar/CalendarOccurrenceCard.tsx"),
    "utf8",
  );
  assert.match(cardSource, /showsSecondaryLine\(height\) && !!secondaryText/);
  assert.match(cardSource, /occurrence\.instructorName/);
  assert.doesNotMatch(cardSource, /occurrence\.branchName/);
  assert.doesNotMatch(cardSource, /occurrence\.roomName/);
  assert.doesNotMatch(cardSource, /occurrence\.bookingCount/);
});
