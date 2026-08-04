import { format, isToday } from "date-fns";
import type { CalendarOccurrence } from "@workspace/api-client-react";
import { ScheduleBoardEvent } from "./ScheduleBoardEvent";
import { ScheduleBoardNowIndicator } from "./ScheduleBoardNowIndicator";
import { BOARD_PX_PER_MIN, boardRowHeight, packBoardRow } from "./scheduleBoardUtils";

export interface ScheduleBoardRowProps {
  date: Date;
  occurrences: CalendarOccurrence[];
  gridStartMin: number;
  gridEndMin: number;
  hourMarks: number[];
  onOccurrenceClick: (occurrence: CalendarOccurrence) => void;
}

/** One day's row — a day label plus its horizontal timeline strip. */
export function ScheduleBoardRow({
  date,
  occurrences,
  gridStartMin,
  gridEndMin,
  hourMarks,
  onOccurrenceClick,
}: ScheduleBoardRowProps) {
  const { events, laneCount } = packBoardRow(occurrences, gridStartMin, gridEndMin);
  const rowHeight = boardRowHeight(laneCount);
  const today = isToday(date);
  const dateKey = format(date, "yyyy-MM-dd");

  const totalMin = gridEndMin - gridStartMin;
  const totalHours = Math.max(1, Math.round(totalMin / 60));

  return (
    <div
      className={"flex border-b last:border-b-0 w-full " + (today ? "bg-primary/5" : "")}
      data-testid={`schedule-board-row-${dateKey}`}
    >
      <div className="sticky left-0 z-10 flex w-28 shrink-0 flex-col items-start justify-center border-r bg-card px-3 py-2">
        <div className="text-xs font-medium text-muted-foreground">{format(date, "EEEE")}</div>
        <div className={"text-sm font-semibold " + (today ? "text-primary" : "text-foreground")}>
          {format(date, "MMM d")}
        </div>
      </div>
      <div className="relative flex-1" style={{ height: rowHeight }}>
        {hourMarks.slice(0, totalHours).map((minute, idx) => {
          const leftPercent = (idx / totalHours) * 100;
          return (
            <div
              key={minute}
              className="absolute top-0 bottom-0 border-l border-border/40 pointer-events-none"
              style={{ left: `${leftPercent}%` }}
            />
          );
        })}
        <div className="absolute top-0 bottom-0 right-0 border-r border-border/40 pointer-events-none" />
        {today && <ScheduleBoardNowIndicator gridStartMin={gridStartMin} gridEndMin={gridEndMin} />}
        {events.map((occurrence) => (
          <ScheduleBoardEvent
            key={`${occurrence.source}-${occurrence.scheduleId}-${occurrence.occurrenceDate}`}
            occurrence={occurrence}
            onOpen={onOccurrenceClick}
          />
        ))}
      </div>
    </div>
  );
}
