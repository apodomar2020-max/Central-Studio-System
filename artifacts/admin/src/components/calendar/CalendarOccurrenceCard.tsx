import { AlertTriangle } from "lucide-react";
import type { CalendarOccurrence } from "@workspace/api-client-react";
import { getCalendarCategoryTokens } from "./calendarTokens";

export const GRID_START_MIN = 12 * 60;
export const GRID_END_MIN = 24 * 60;
export const PX_PER_MIN = 1;

/**
 * Hour labels are vertically centered on their tick line via a CSS
 * transform (`-translate-y-1/2`). Centering the first mark (top:0) or last
 * mark (top:gridHeight) would render half the label outside the gutter's
 * overflow-hidden bounds. Rather than reserving extra space (which — for
 * position:absolute children — padding on the container does NOT actually
 * provide, since absolute offsets are measured from the padding-box origin
 * regardless of the padding value), anchor edge labels to their own edge
 * instead: the first label's TOP sits exactly on its tick line, the last
 * label's BOTTOM sits exactly on its tick line. Both stay fully inside the
 * container and remain exactly aligned to their line — just not centered on
 * it, the way an interior label is.
 */
export function hourLabelTranslateClass(index: number, count: number): string {
  if (index === 0) return "";
  if (index === count - 1) return "-translate-y-full";
  return "-translate-y-1/2";
}

/** Width of the time-label gutter column — wide enough for "12:00 PM". */
export const TIME_GUTTER_WIDTH_PX = 72;

export function toMinutes(time: string): number {
  if (!time) return 0;
  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Always shows minutes (e.g. "8:00 AM", "12:00 PM") — never a bare hour. */
export function formatHourLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60) % 24;
  const mins = minutes % 60;
  const period = hours >= 12 ? "PM" : "AM";
  const display = hours % 12 === 0 ? 12 : hours % 12;
  return `${display}:${mins.toString().padStart(2, "0")} ${period}`;
}

/**
 * Default visible range is 12:00 PM–12:00 AM. Expands outward — never
 * shrinks — to the nearest full hour so every event is visible and the grid
 * only ever shows whole-hour lines/labels. Never shifts the grid by a half
 * hour: an event at 8:30 AM rounds the start back to 8:00 AM, not 8:00/8:30.
 */
export function calculateCalendarTimeRange(occurrences: CalendarOccurrence[]): {
  startMinute: number;
  endMinute: number;
} {
  const validOccurrences = (occurrences || []).filter(
    (occ) => occ && typeof occ.startTime === "string" && typeof occ.endTime === "string",
  );

  if (validOccurrences.length === 0) {
    return { startMinute: GRID_START_MIN, endMinute: GRID_END_MIN };
  }

  let minStart = Infinity;
  let maxEnd = -Infinity;

  for (const occ of validOccurrences) {
    const start = toMinutes(occ.startTime);
    const end = toMinutes(occ.endTime);
    if (start < minStart) minStart = start;
    if (end > maxEnd) maxEnd = end;
  }

  if (minStart === Infinity || maxEnd === -Infinity) {
    return { startMinute: GRID_START_MIN, endMinute: GRID_END_MIN };
  }

  const roundedStart = Math.floor(minStart / 60) * 60;
  const roundedEnd = Math.ceil(maxEnd / 60) * 60;

  const startMinute = Math.max(0, Math.min(GRID_START_MIN, roundedStart));
  const endMinute = Math.min(24 * 60, Math.max(GRID_END_MIN, roundedEnd));

  return { startMinute, endMinute };
}

export type PositionedOccurrence = CalendarOccurrence & {
  col: number;
  totalCols: number;
  /**
   * Week/Day view only (see packDayRowsStacked). When set, this pixel value
   * is used as the card's final `top` instead of the natural
   * (startTime - gridStartMin) calculation — Resource View's packDayColumns
   * never sets this, so CalendarOccurrenceCard's fallback keeps Resource
   * View byte-for-byte unchanged.
   */
  stackTopPx?: number;
};

/**
 * Resource View layout: overlapping events split into narrow side-by-side
 * columns within the same room track (Google-Calendar-meetings style).
 * Left unchanged — still used by CalendarResourceView only.
 */
export function packDayColumns(dayOccurrences: CalendarOccurrence[]): PositionedOccurrence[] {
  const sorted = [...dayOccurrences].sort(
    (a, b) =>
      toMinutes(a.startTime) - toMinutes(b.startTime) ||
      toMinutes(a.endTime) - toMinutes(b.endTime),
  );
  const columnEndMinutes: number[] = [];
  const placed = sorted.map((occurrence) => {
    const startMin = toMinutes(occurrence.startTime);
    const endMin = toMinutes(occurrence.endTime);
    let col = columnEndMinutes.findIndex((end) => end <= startMin);
    if (col === -1) {
      col = columnEndMinutes.length;
      columnEndMinutes.push(endMin);
    } else {
      columnEndMinutes[col] = endMin;
    }
    return { ...occurrence, col };
  });
  const totalCols = Math.max(1, columnEndMinutes.length);
  return placed.map((occurrence) => ({ ...occurrence, totalCols }));
}

/** Small gap (px) kept between vertically stacked cards that share a time slot. */
export const STACK_GAP_PX = 3;

/**
 * Week/Day view layout (Phase 6G/6H) — overlapping events stack vertically,
 * full column width, instead of splitting into narrow side-by-side columns.
 * Each card keeps its own duration-based height and its true, chronological
 * start-time position; it's only pushed further down than that natural
 * position when placing it there would visually collide with the card(s)
 * already stacked above it in this day.
 *
 * The check is a running pixel bottom, not a real-time-overlap check: a
 * card that starts exactly when an earlier cluster's real end time is
 * reached can still collide with that cluster's *cascaded* (pushed-down)
 * bottom, so comparing real end times alone is not sufficient to guarantee
 * "never overlap visually" — comparing accumulated pixel position is. This
 * still self-heals for realistic data: once a real time gap is large enough
 * that a card's natural position already clears the running pixel bottom,
 * it uses that natural position and the running bottom "catches up" — no
 * permanent drift is carried for the rest of the day.
 */
export function packDayRowsStacked(
  dayOccurrences: CalendarOccurrence[],
  gridStartMin: number,
): PositionedOccurrence[] {
  const sorted = [...dayOccurrences].sort(
    (a, b) =>
      toMinutes(a.startTime) - toMinutes(b.startTime) ||
      toMinutes(a.endTime) - toMinutes(b.endTime),
  );

  let cascadeBottomPx: number | null = null;
  const results: PositionedOccurrence[] = [];

  for (const occurrence of sorted) {
    const startMin = toMinutes(occurrence.startTime);
    const endMin = Math.max(toMinutes(occurrence.endTime), startMin + 15);
    const naturalTopPx = (startMin - gridStartMin) * PX_PER_MIN;
    const heightPx = Math.max(24, (endMin - startMin) * PX_PER_MIN);

    const stackTopPx: number = cascadeBottomPx === null ? naturalTopPx : Math.max(naturalTopPx, cascadeBottomPx + STACK_GAP_PX);

    results.push({ ...occurrence, col: 0, totalCols: 1, stackTopPx });

    cascadeBottomPx = stackTopPx + heightPx;
  }

  return results;
}

export function formatConflictSummary(conflict: NonNullable<PositionedOccurrence["conflict"]>): string {
  const location = [conflict.branchName, conflict.roomName].filter(Boolean).join(" · ") || "No location set";
  const title = conflict.classTitle || "Occupied";
  return `${title} · ${conflict.startTime}–${conflict.endTime} · ${location}`;
}

/**
 * Calendar cards are minimal scanning cards: the title is always shown.
 * Location, capacity, booking count, and the conflict description never
 * render on-card regardless of height — those stay in
 * OccurrenceDetailsSheet / ReservationDetailsSheet, opened via onOpen.
 * `isCompactCardHeight` controls padding for very short cards.
 */
export function isCompactCardHeight(heightPx: number): boolean {
  return heightPx < 32;
}

/**
 * Phase 6H — with vertical stacking giving every card near-full column
 * width, a tall-enough card has room for one secondary line (instructor, or
 * organizer/type for a private reservation) without crowding the title.
 * Short cards stay title-only.
 */
export function showsSecondaryLine(heightPx: number): boolean {
  return heightPx >= 40;
}

export interface CalendarOccurrenceCardProps {
  occurrence: PositionedOccurrence;
  onOpen: (occurrence: CalendarOccurrence) => void;
  gridStartMin?: number;
}

export function CalendarOccurrenceCard({
  occurrence,
  onOpen,
  gridStartMin = GRID_START_MIN,
}: CalendarOccurrenceCardProps) {
  const startMin = toMinutes(occurrence.startTime);
  const endMin = Math.max(toMinutes(occurrence.endTime), startMin + 15);
  // Resource View (packDayColumns) never sets stackTopPx, so this falls back
  // to the original natural-time calculation there — unchanged.
  const top = occurrence.stackTopPx ?? (startMin - gridStartMin) * PX_PER_MIN;
  const height = Math.max(24, (endMin - startMin) * PX_PER_MIN);
  const widthPct = 100 / occurrence.totalCols;

  const displayTitle = occurrence.title || occurrence.classTitle || "Untitled Event";
  const conflict = occurrence.conflict;
  const isReservation = occurrence.source === "reservation";
  const secondaryText = isReservation
    ? occurrence.organizerName || (occurrence.reservationType ? occurrence.reservationType.replace("_", " ") : "Private Event")
    : occurrence.instructorName;

  const tokens = getCalendarCategoryTokens(occurrence.source as any);

  const tooltip = conflict
    ? `${displayTitle} · ${occurrence.startTime}–${occurrence.endTime}\nConflicts with: ${formatConflictSummary(conflict)}`
    : `${displayTitle} · ${occurrence.startTime}–${occurrence.endTime}`;

  const compact = isCompactCardHeight(height);
  const paddingClass = compact ? "px-2 py-0" : "px-2.5 py-1";
  const showSecondary = showsSecondaryLine(height) && !!secondaryText;

  return (
    <div
      role="button"
      tabIndex={0}
      className={
        "admin2-calendar-event " +
        "absolute overflow-hidden rounded-md text-left shadow-sm flex flex-col justify-center " +
        "cursor-pointer transition-all hover:brightness-105 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
        paddingClass + " " +
        tokens.bg + " " +
        (conflict ? "border-2 border-destructive border-l-4 border-l-destructive" : tokens.border)
      }
      style={{
        top,
        height,
        left: `calc(${occurrence.col * widthPct}% + 2px)`,
        width: `calc(${widthPct}% - 4px)`,
      }}
      data-testid={`calendar-card-${occurrence.source}-${occurrence.scheduleId}-${occurrence.occurrenceDate}`}
      title={tooltip}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(occurrence);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        onOpen(occurrence);
      }}
    >
      {conflict && (
        <div
          className="absolute right-1 top-1 rounded bg-destructive p-0.5 text-destructive-foreground shadow-sm"
          data-testid={`calendar-conflict-badge-${occurrence.source}-${occurrence.scheduleId}-${occurrence.occurrenceDate}`}
        >
          <AlertTriangle className="h-3 w-3" aria-label="Scheduling conflict" />
        </div>
      )}
      <div className={"truncate text-xs font-semibold leading-tight text-foreground w-full " + (conflict ? "pr-4" : "")}>
        {displayTitle}
      </div>
      {showSecondary && (
        <div className="truncate text-[11px] font-medium leading-tight text-muted-foreground w-full">
          {secondaryText}
        </div>
      )}
    </div>
  );
}
