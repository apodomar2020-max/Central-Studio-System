import { useMemo } from "react";
import { format, isToday } from "date-fns";
import type { CalendarOccurrence } from "@workspace/api-client-react";
import {
  PX_PER_MIN,
  formatHourLabel,
  packDayColumns,
  calculateCalendarTimeRange,
} from "./CalendarOccurrenceCard";
import { CalendarSlot } from "./CalendarSlot";
import { CalendarNowIndicator } from "./CalendarNowIndicator";

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface CalendarGridProps {
  viewMode: "week" | "day";
  datesToShow: Date[];
  occurrencesByDate: Map<string, CalendarOccurrence[]>;
  isLoading: boolean;
  isError: boolean;
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

export function CalendarGrid({
  viewMode,
  datesToShow,
  occurrencesByDate,
  isLoading,
  isError,
  canCreateSchedule,
  canCreateReservation = false,
  onSlotClick,
  onOccurrenceClick,
}: CalendarGridProps) {
  const allOccurrences = useMemo(() => {
    const list: CalendarOccurrence[] = [];
    for (const date of datesToShow) {
      const dateKey = format(date, "yyyy-MM-dd");
      const dayList = occurrencesByDate.get(dateKey);
      if (dayList) list.push(...dayList);
    }
    return list;
  }, [datesToShow, occurrencesByDate]);

  const { startMinute, endMinute } = useMemo(
    () => calculateCalendarTimeRange(allOccurrences),
    [allOccurrences],
  );

  const hourMarks = useMemo(() => {
    const marks: number[] = [];
    for (let m = startMinute; m <= endMinute; m += 60) {
      marks.push(m);
    }
    return marks;
  }, [startMinute, endMinute]);

  const gridHeight = (endMinute - startMinute) * PX_PER_MIN;
  const gridColsClass = viewMode === "week" ? "grid-cols-[64px_repeat(7,1fr)]" : "grid-cols-[64px_1fr]";

  if (isLoading) {
    return (
      <div className="rounded-md border bg-card p-6 shadow-sm space-y-4">
        <div className="h-6 w-48 rounded bg-muted animate-pulse" />
        <div className="space-y-3 pt-4">
          <div className="h-10 w-full rounded bg-muted/60 animate-pulse" />
          <div className="h-64 w-full rounded bg-muted/30 animate-pulse" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-md border bg-card py-16 text-center text-sm text-destructive">
        Could not load the calendar. Please try again.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border bg-card shadow-sm">
      <div className={viewMode === "week" ? "min-w-[880px]" : "min-w-[420px]"}>
        <div className={`grid ${gridColsClass} border-b bg-muted/40`}>
          <div />
          {datesToShow.map((date) => {
            const today = isToday(date);
            return (
              <div
                key={date.toISOString()}
                className={
                  "border-l px-2 py-2 text-center transition-colors " +
                  (today ? "bg-primary/5 font-bold" : "")
                }
              >
                <div className="text-xs font-medium text-muted-foreground">
                  {DAY_SHORT[date.getDay()]}
                </div>
                <div
                  className={
                    "inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold " +
                    (today ? "bg-primary text-primary-foreground shadow-sm" : "text-foreground")
                  }
                >
                  {format(date, "d")}
                </div>
              </div>
            );
          })}
        </div>
        <div className={`grid ${gridColsClass}`}>
          <div className="relative overflow-hidden" style={{ height: gridHeight }}>
            {hourMarks.map((minute) => (
              <div
                key={minute}
                className="absolute right-2 -translate-y-1/2 text-[11px] font-medium text-muted-foreground"
                style={{ top: (minute - startMinute) * PX_PER_MIN }}
              >
                {formatHourLabel(minute)}
              </div>
            ))}
          </div>
          {datesToShow.map((date) => {
            const dateKey = format(date, "yyyy-MM-dd");
            const dayOccurrences = packDayColumns(occurrencesByDate.get(dateKey) ?? []);
            const today = isToday(date);
            return (
              <div key={dateKey} className="relative">
                {today && (
                  <CalendarNowIndicator
                    gridStartMin={startMinute}
                    gridEndMin={endMinute}
                  />
                )}
                <CalendarSlot
                  dateKey={dateKey}
                  gridHeight={gridHeight}
                  gridStartMin={startMinute}
                  gridEndMin={endMinute}
                  hourMarks={hourMarks}
                  dayOccurrences={dayOccurrences}
                  canCreateSchedule={canCreateSchedule}
                  canCreateReservation={canCreateReservation}
                  onSlotClick={onSlotClick}
                  onOccurrenceClick={onOccurrenceClick}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
