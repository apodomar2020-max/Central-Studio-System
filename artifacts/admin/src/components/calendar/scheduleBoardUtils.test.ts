import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  packBoardRow,
  boardRowHeight,
  computeBoardTimeRange,
  BOARD_PX_PER_MIN,
  BOARD_LANE_HEIGHT_PX,
  BOARD_LANE_GAP_PX,
  BOARD_MIN_EVENT_WIDTH_PX,
} from "./scheduleBoardUtils";
import { GRID_START_MIN } from "./CalendarOccurrenceCard";
import { BOARD_START_MIN, BOARD_END_MIN } from "./scheduleBoardUtils";

test("computeBoardTimeRange — returns operational studio hours range for 13 1-hour columns", () => {
  const result = computeBoardTimeRange([]);
  assert.equal(result.startMinute, BOARD_START_MIN);
  assert.equal(result.endMinute, BOARD_END_MIN);
});

test("packBoardRow — a single event gets lane 0 and its width represents real duration", () => {
  const { events, laneCount } = packBoardRow(
    [{ source: "class", scheduleId: 1, occurrenceDate: "2026-08-04", startTime: "13:00", endTime: "14:00", bookingCount: 0 }],
    GRID_START_MIN,
  );
  assert.equal(laneCount, 1);
  assert.equal(events[0].laneIndex, 0);
  assert.equal(events[0].leftPx, (13 * 60 - GRID_START_MIN) * BOARD_PX_PER_MIN);
  assert.equal(events[0].widthPx, 60 * BOARD_PX_PER_MIN);
});

test("packBoardRow — three simultaneous events stack into three lanes (vertical), never narrowed horizontally", () => {
  const { events, laneCount } = packBoardRow(
    [
      { source: "class", scheduleId: 1, occurrenceDate: "2026-08-04", startTime: "16:00", endTime: "16:45", bookingCount: 0 },
      { source: "ballet", scheduleId: 2, occurrenceDate: "2026-08-04", startTime: "16:00", endTime: "16:45", bookingCount: 0 },
      { source: "reservation", scheduleId: 3, occurrenceDate: "2026-08-04", startTime: "16:00", endTime: "16:45", bookingCount: 0 },
    ],
    GRID_START_MIN,
  );
  assert.equal(laneCount, 3);
  assert.deepEqual(events.map((e) => e.laneIndex).sort(), [0, 1, 2]);
  // Every event keeps the SAME full duration-based width — none are narrowed
  // because they overlap (that's the whole point of stacking vertically).
  const width = 45 * BOARD_PX_PER_MIN;
  assert.ok(events.every((e) => e.widthPx === width));
});

test("packBoardRow — non-overlapping events share lane 0 (no unnecessary stacking)", () => {
  const { events, laneCount } = packBoardRow(
    [
      { source: "class", scheduleId: 1, occurrenceDate: "2026-08-04", startTime: "13:00", endTime: "14:00", bookingCount: 0 },
      { source: "class", scheduleId: 2, occurrenceDate: "2026-08-04", startTime: "14:00", endTime: "15:00", bookingCount: 0 },
    ],
    GRID_START_MIN,
  );
  assert.equal(laneCount, 1);
  assert.ok(events.every((e) => e.laneIndex === 0));
});

test("packBoardRow — events overlapping in visual display time are assigned separate stacked lanes (no vertical overlap)", () => {
  const { events, laneCount } = packBoardRow(
    [
      { source: "reservation", scheduleId: 1, occurrenceDate: "2026-08-04", startTime: "11:00", endTime: "12:30", bookingCount: 0 },
      { source: "class", scheduleId: 2, occurrenceDate: "2026-08-04", startTime: "12:00", endTime: "13:00", bookingCount: 0 },
    ],
    GRID_START_MIN,
  );
  assert.equal(laneCount, 2);
  assert.notEqual(events[0].laneIndex, events[1].laneIndex);
});

test("packBoardRow — a 90-minute event is exactly 1.5x the width of a 60-minute event", () => {
  const { events } = packBoardRow(
    [
      { source: "class", scheduleId: 1, occurrenceDate: "2026-08-04", startTime: "12:00", endTime: "13:30", bookingCount: 0 },
      { source: "class", scheduleId: 2, occurrenceDate: "2026-08-04", startTime: "14:00", endTime: "15:00", bookingCount: 0 },
    ],
    GRID_START_MIN,
  );
  assert.equal(events[0].widthPx, events[1].widthPx * 1.5);
});

test("packBoardRow — a short 30-minute event still meets the minimum readable/clickable width floor", () => {
  const { events } = packBoardRow(
    [{ source: "class", scheduleId: 1, occurrenceDate: "2026-08-04", startTime: "12:00", endTime: "12:30", bookingCount: 0 }],
    GRID_START_MIN,
  );
  assert.equal(events[0].widthPx, Math.max(BOARD_MIN_EVENT_WIDTH_PX, 30 * BOARD_PX_PER_MIN));
});

test("boardRowHeight — grows with lane count and always fits every stacked lane without collision", () => {
  const oneLane = boardRowHeight(1);
  const threeLanes = boardRowHeight(3);
  assert.ok(threeLanes > oneLane);
  // threeLanes must have room for 3 full lane heights plus 2 inter-lane gaps.
  assert.ok(threeLanes >= 3 * BOARD_LANE_HEIGHT_PX + 2 * BOARD_LANE_GAP_PX);
});

test("Schedule Board is the standard layout pattern — CalendarGrid uses ScheduleBoardView, Resource View remains untouched", () => {
  const gridSource = readFileSync(resolve(process.cwd(), "artifacts/admin/src/components/calendar/CalendarGrid.tsx"), "utf8");
  const slotSource = readFileSync(resolve(process.cwd(), "artifacts/admin/src/components/calendar/CalendarSlot.tsx"), "utf8");
  const resourceSource = readFileSync(resolve(process.cwd(), "artifacts/admin/src/components/calendar/CalendarResourceView.tsx"), "utf8");
  assert.match(gridSource, /ScheduleBoardView/);
  assert.doesNotMatch(slotSource, /ScheduleBoard/);
  assert.doesNotMatch(resourceSource, /ScheduleBoard/);
});

test("Calendar page wires Week, Day, and Resource views with shared timeline layout", () => {
  const calendarSource = readFileSync(resolve(process.cwd(), "artifacts/admin/src/pages/calendar.tsx"), "utf8");
  assert.match(calendarSource, /viewMode === "resource"/);
  assert.match(calendarSource, /<CalendarResourceView/);
  assert.match(calendarSource, /<CalendarGrid/);
});

test("CalendarHeader exposes Week, Day, and Resource — in that order", () => {
  const headerSource = readFileSync(resolve(process.cwd(), "artifacts/admin/src/components/calendar/CalendarHeader.tsx"), "utf8");
  assert.match(headerSource, /"week" \| "day" \| "resource"/);
  const weekIdx = headerSource.indexOf("button-calendar-view-week");
  const dayIdx = headerSource.indexOf("button-calendar-view-day");
  const resourceIdx = headerSource.indexOf("button-calendar-view-resource");
  assert.ok(weekIdx < dayIdx && dayIdx < resourceIdx, "expected Week, Day, Resource in that order");
});

test("ScheduleBoardEvent source — card click behavior matches the existing pattern (stopPropagation + onOpen)", () => {
  const eventSource = readFileSync(resolve(process.cwd(), "artifacts/admin/src/components/calendar/ScheduleBoardEvent.tsx"), "utf8");
  assert.match(eventSource, /onClick=\{\(event\) => \{\s*event\.stopPropagation\(\);\s*onOpen\(occurrence\);/);
  assert.match(eventSource, /calendar-conflict-badge|schedule-board-conflict-badge/);
});

test("ScheduleBoardEvent source — card content shows title only, secondary details in hover preview", () => {
  const eventSource = readFileSync(resolve(process.cwd(), "artifacts/admin/src/components/calendar/ScheduleBoardEvent.tsx"), "utf8");
  assert.doesNotMatch(eventSource, /occurrence\.bookingCount/);
  assert.match(eventSource, /displayTitle/);
  assert.match(eventSource, /HoverCardContent/);
});
