import { AlertTriangle } from "lucide-react";
import type { CalendarOccurrence } from "@workspace/api-client-react";
import { getCalendarCategoryTokens } from "./calendarTokens";

export const GRID_START_MIN = 12 * 60;
export const GRID_END_MIN = 24 * 60;
export const PX_PER_MIN = 1;

export function toMinutes(time: string): number {
  if (!time) return 0;
  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function formatHourLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60) % 24;
  const mins = minutes % 60;
  const period = hours >= 12 ? "PM" : "AM";
  const display = hours % 12 === 0 ? 12 : hours % 12;
  const minsStr = mins > 0 ? `:${mins.toString().padStart(2, "0")}` : "";
  return `${display}${minsStr} ${period}`;
}

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

  let startMinute = Math.max(0, minStart - 30);
  let endMinute = Math.min(24 * 60, maxEnd + 30);

  const minDuration = 8 * 60; // Keep at least 8 hours visible
  if (endMinute - startMinute < minDuration) {
    endMinute = Math.min(24 * 60, startMinute + minDuration);
    if (endMinute - startMinute < minDuration) {
      startMinute = Math.max(0, endMinute - minDuration);
    }
  }

  return { startMinute, endMinute };
}

export type PositionedOccurrence = CalendarOccurrence & { col: number; totalCols: number };

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

export function formatConflictSummary(conflict: NonNullable<PositionedOccurrence["conflict"]>): string {
  const location = [conflict.branchName, conflict.roomName].filter(Boolean).join(" · ") || "No location set";
  const title = conflict.classTitle || "Occupied";
  return `${title} · ${conflict.startTime}–${conflict.endTime} · ${location}`;
}

/**
 * Phase 6F — Calendar cards are minimal scanning cards (Google Calendar /
 * Outlook style), not operational detail panels. Card height (in px) alone
 * decides how much secondary text is shown; everything else (location,
 * booking count, roster, etc.) lives in OccurrenceDetailsSheet /
 * ReservationDetailsSheet, opened via the existing onOpen click handler.
 */
export type CardSizeTier = "small" | "medium" | "large";

export function getCardSizeTier(heightPx: number): CardSizeTier {
  if (heightPx < 40) return "small";
  if (heightPx <= 70) return "medium";
  return "large";
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
  const top = (startMin - gridStartMin) * PX_PER_MIN;
  const height = Math.max(24, (endMin - startMin) * PX_PER_MIN);
  const widthPct = 100 / occurrence.totalCols;

  const isReservation = occurrence.source === "reservation";
  const displayTitle = occurrence.title || occurrence.classTitle || "Untitled Event";
  const conflict = occurrence.conflict;

  const tokens = getCalendarCategoryTokens(occurrence.source as any);

  const tooltip = conflict
    ? `${displayTitle} · ${occurrence.startTime}–${occurrence.endTime}\nConflicts with: ${formatConflictSummary(conflict)}`
    : `${displayTitle} · ${occurrence.startTime}–${occurrence.endTime}`;

  const size = getCardSizeTier(height);
  const paddingClass = size === "small" ? "px-2 py-0.5" : "px-2.5 py-1.5";
  const organizerOrInstructor = isReservation
    ? occurrence.organizerName || (occurrence.reservationType ? occurrence.reservationType.replace("_", " ") : "Private Event")
    : (occurrence.instructorName ?? "No instructor");

  return (
    <div
      role="button"
      tabIndex={0}
      className={
        "absolute overflow-hidden rounded-md text-left shadow-sm " +
        "cursor-pointer transition-all hover:brightness-105 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
        paddingClass + " " +
        tokens.bg + " " +
        (conflict ? "border-2 border-destructive border-l-4 border-l-destructive" : tokens.border) + " " +
        tokens.text
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
      <div className={"truncate text-xs font-semibold leading-tight pr-4 " + tokens.text}>
        {displayTitle}
      </div>
      {size === "medium" && (
        <div className="truncate text-[11px] font-medium leading-tight opacity-90 mt-0.5">
          {occurrence.startTime}–{occurrence.endTime}
        </div>
      )}
      {size === "large" && (
        <div className="truncate text-[11px] font-medium leading-tight opacity-90 mt-0.5">
          {organizerOrInstructor}
        </div>
      )}
    </div>
  );
}
