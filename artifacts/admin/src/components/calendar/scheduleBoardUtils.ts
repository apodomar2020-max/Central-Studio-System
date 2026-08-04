/**
 * Schedule Board (experimental view, prototype) — pure positioning helpers.
 *
 * The board rotates the existing Week/Day grid 90°: days become rows, hours
 * become columns, and an event's real duration is represented by WIDTH
 * instead of height. Deliberately reuses the existing engine wherever the
 * underlying problem is identical rather than reinventing it:
 *   - calculateCalendarTimeRange (12PM–12AM default, full-hour expansion)
 *   - packDayColumns's lane-assignment algorithm — "smallest lane index
 *     such that this interval doesn't collide with anything already in that
 *     lane" is exactly the same problem as "which vertical stack row does
 *     this event belong in within its day's row," just relabeled.
 *
 * This file (and ScheduleBoardView/Row/Event) is fully isolated from the
 * existing Google-style grid — CalendarGrid.tsx, CalendarSlot.tsx,
 * CalendarOccurrenceCard.tsx, and CalendarResourceView.tsx are untouched.
 */
import type { CalendarOccurrence } from "@workspace/api-client-react";
import {
  packDayColumns,
  toMinutes,
  type PositionedOccurrence,
} from "./CalendarOccurrenceCard";

/** Pixels per minute along the time (horizontal) axis. */
export const BOARD_PX_PER_MIN = 2;

/** Height of one stacked event row (a "lane") within a day row. */
export const BOARD_LANE_HEIGHT_PX = 52;

/** Vertical gap between stacked lanes within the same day row. */
export const BOARD_LANE_GAP_PX = 6;

/** Vertical padding above/below the stacked lanes within a day row. */
export const BOARD_ROW_PADDING_PX = 8;

/** Minimum event width so even a very short event stays clickable/legible. */
export const BOARD_MIN_EVENT_WIDTH_PX = 60;

/** Operational studio hours range for Schedule Board: 12:00 PM (720 min) to 1:00 AM (1500 min). */
export const BOARD_START_MIN = 12 * 60;
export const BOARD_END_MIN = 25 * 60;

export interface BoardPositionedOccurrence extends PositionedOccurrence {
  leftPx: number;
  widthPx: number;
  leftPercent: number;
  widthPercent: number;
  /** Which stacked row (0-based) this event occupies within its day row. */
  laneIndex: number;
}

export interface PackedBoardRow {
  events: BoardPositionedOccurrence[];
  /** How many stacked lanes this day row needs (always >= 1). */
  laneCount: number;
}

/**
 * Returns operational studio hours for Schedule Board, dynamically expanding
 * to accommodate late-night/post-midnight events when present.
 */
export function computeBoardTimeRange(occurrences?: CalendarOccurrence[]): {
  startMinute: number;
  endMinute: number;
} {
  const validOccurrences = (occurrences || []).filter(
    (occ) => occ && typeof occ.startTime === "string" && typeof occ.endTime === "string",
  );

  let startMinute = BOARD_START_MIN;
  let endMinute = BOARD_END_MIN;

  if (validOccurrences.length > 0) {
    let minStart = Infinity;
    let maxEnd = -Infinity;

    for (const occ of validOccurrences) {
      const start = toMinutes(occ.startTime);
      let end = toMinutes(occ.endTime);
      if (end < start) {
        end += 24 * 60;
      }
      if (start < minStart) minStart = start;
      if (end > maxEnd) maxEnd = end;
    }

    if (minStart !== Infinity && maxEnd !== -Infinity) {
      const roundedStart = Math.floor(minStart / 60) * 60;
      const roundedEnd = Math.ceil(maxEnd / 60) * 60;

      startMinute = Math.min(BOARD_START_MIN, roundedStart);
      endMinute = Math.max(BOARD_END_MIN, roundedEnd);
    }
  }

  return { startMinute, endMinute };
}

/**
 * Lays out one day's occurrences along the time axis, stacking any that
 * overlap in time into additional lanes (rows) instead of narrowing them —
 * assigning each event to the first stacked lane where its visual time span
 * does not collide with previous events in that lane.
 */
export function packBoardRow(
  dayOccurrences: CalendarOccurrence[],
  gridStartMin: number = BOARD_START_MIN,
  gridEndMin: number = BOARD_END_MIN,
): PackedBoardRow {
  const sorted = [...(dayOccurrences || [])].sort((a, b) => {
    const startA = toMinutes(a.startTime);
    const startB = toMinutes(b.startTime);
    if (startA !== startB) return startA - startB;
    const durA = toMinutes(a.endTime) - startA;
    const durB = toMinutes(b.endTime) - startB;
    return durB - durA;
  });

  const totalMin = gridEndMin - gridStartMin;
  const laneEndMinutes: number[] = [];

  const events: BoardPositionedOccurrence[] = sorted.map((occurrence) => {
    let rawStartMin = toMinutes(occurrence.startTime);
    let rawEndMin = toMinutes(occurrence.endTime);
    if (rawEndMin < rawStartMin) {
      rawEndMin += 24 * 60;
    }
    const rawDuration = Math.max(15, rawEndMin - rawStartMin);

    // Minimum display duration (30 min equivalent) so card titles are readable and don't visually overlap
    const displayDuration = Math.max(30, rawDuration);
    const effectiveEndMin = rawStartMin + displayDuration;

    // Find the first lane where this event's start time clears the lane's effective end time
    let laneIndex = laneEndMinutes.findIndex((laneEnd) => laneEnd <= rawStartMin);
    if (laneIndex === -1) {
      laneIndex = laneEndMinutes.length;
      laneEndMinutes.push(effectiveEndMin);
    } else {
      laneEndMinutes[laneIndex] = effectiveEndMin;
    }

    // Visible bounds within timeline [gridStartMin, gridEndMin]
    const visibleStartMin = Math.max(gridStartMin, Math.min(gridEndMin, rawStartMin));
    const visibleEndMin = Math.max(gridStartMin, Math.min(gridEndMin, rawEndMin));

    const leftPercent = Math.max(0, ((visibleStartMin - gridStartMin) / totalMin) * 100);
    const visibleDurationMin = Math.max(30, visibleEndMin - visibleStartMin);
    const widthPercent = (visibleDurationMin / totalMin) * 100;

    const leftPx = Math.max(0, (visibleStartMin - gridStartMin) * BOARD_PX_PER_MIN);
    const widthPx = Math.max(BOARD_MIN_EVENT_WIDTH_PX, (visibleEndMin - visibleStartMin) * BOARD_PX_PER_MIN);

    return {
      ...occurrence,
      col: laneIndex,
      totalCols: laneEndMinutes.length,
      leftPx,
      widthPx,
      leftPercent,
      widthPercent,
      laneIndex,
    };
  });

  const laneCount = Math.max(1, laneEndMinutes.length);

  return { events, laneCount };
}

/** Total pixel height of a day row for a given lane count. */
export function boardRowHeight(laneCount: number): number {
  return laneCount * BOARD_LANE_HEIGHT_PX + Math.max(0, laneCount - 1) * BOARD_LANE_GAP_PX + BOARD_ROW_PADDING_PX * 2;
}

