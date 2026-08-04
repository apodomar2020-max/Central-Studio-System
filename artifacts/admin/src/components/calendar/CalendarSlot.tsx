import React from "react";
import type { CalendarOccurrence } from "@workspace/api-client-react";
import {
  CalendarOccurrenceCard,
  GRID_START_MIN,
  GRID_END_MIN,
  PX_PER_MIN,
  type PositionedOccurrence,
} from "./CalendarOccurrenceCard";

export interface CalendarSlotProps {
  dateKey: string;
  gridHeight: number;
  gridStartMin?: number;
  gridEndMin?: number;
  hourMarks: number[];
  dayOccurrences: PositionedOccurrence[];
  canCreateSchedule: boolean;
  canCreateReservation?: boolean;
  onSlotClick: (
    event: React.MouseEvent<HTMLDivElement>,
    dateKey: string,
    gridStartMin?: number,
    gridEndMin?: number,
  ) => void;
  onOccurrenceClick: (occurrence: CalendarOccurrence) => void;
}

export function CalendarSlot({
  dateKey,
  gridHeight,
  gridStartMin = GRID_START_MIN,
  gridEndMin = GRID_END_MIN,
  hourMarks,
  dayOccurrences,
  canCreateSchedule,
  canCreateReservation = false,
  onSlotClick,
  onOccurrenceClick,
}: CalendarSlotProps) {
  const isClickable = canCreateSchedule || canCreateReservation;

  return (
    <div
      key={dateKey}
      className={
        "relative overflow-hidden border-l transition-colors " +
        (isClickable ? " cursor-pointer hover:bg-primary/[0.02]" : "")
      }
      style={{ height: gridHeight }}
      data-testid={`calendar-day-column-${dateKey}`}
      onClick={
        isClickable
          ? (event) => onSlotClick(event, dateKey, gridStartMin, gridEndMin)
          : undefined
      }
      title={isClickable ? "Click empty slot to add class or private event" : undefined}
    >
      {/* Whole-hour grid lines — subtle, no labels here (labels live in the gutter column) */}
      {hourMarks.map((minute) => (
        <React.Fragment key={minute}>
          <div
            className="absolute left-0 right-0 border-t border-border/45 pointer-events-none"
            style={{ top: (minute - gridStartMin) * PX_PER_MIN }}
          />
          {/* Half-hour guide lines — lighter than the hour lines, unlabeled */}
          {minute + 30 <= gridEndMin && (
            <div
              className="absolute left-0 right-0 border-t border-dashed border-border/20 pointer-events-none"
              style={{ top: (minute + 30 - gridStartMin) * PX_PER_MIN }}
            />
          )}
        </React.Fragment>
      ))}

      {dayOccurrences.map((occurrence) => (
        <CalendarOccurrenceCard
          key={`${occurrence.source}-${occurrence.scheduleId}-${occurrence.occurrenceDate}`}
          occurrence={occurrence}
          onOpen={onOccurrenceClick}
          gridStartMin={gridStartMin}
        />
      ))}
    </div>
  );
}
