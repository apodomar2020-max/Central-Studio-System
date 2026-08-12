import { useMemo } from "react";
import { format } from "date-fns";
import type { CalendarOccurrence } from "@workspace/api-client-react";
import { formatHourLabel } from "./CalendarOccurrenceCard";
import { ScheduleBoardRow } from "./ScheduleBoardRow";
import { BOARD_PX_PER_MIN, computeBoardTimeRange } from "./scheduleBoardUtils";

const HOUR_HEADER_HEIGHT_PX = 32;
const DAY_LABEL_WIDTH_PX = 112;

export interface ScheduleBoardViewProps {
  datesToShow: Date[];
  occurrencesByDate: Map<string, CalendarOccurrence[]>;
  isLoading: boolean;
  isError: boolean;
  onOccurrenceClick: (occurrence: CalendarOccurrence) => void;
}

/**
 * Schedule Board — experimental studio-timetable view (Phase 6I). Rows are
 * days, columns are hours; an event's real duration is its width. Reads the
 * exact same calendar data as Week/Day/Resource (no new API call) — this is
 * a presentation-layer-only alternative, not a new data source.
 */
export function ScheduleBoardView({
  datesToShow,
  occurrencesByDate,
  isLoading,
  isError,
  onOccurrenceClick,
}: ScheduleBoardViewProps) {
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
    () => computeBoardTimeRange(allOccurrences),
    [allOccurrences],
  );

  const hourMarks = useMemo(() => {
    const marks: number[] = [];
    for (let m = startMinute; m <= endMinute; m += 60) marks.push(m);
    return marks;
  }, [startMinute, endMinute]);

  const timelineWidth = (endMinute - startMinute) * BOARD_PX_PER_MIN;

  if (isLoading) {
    return (
      <div className="admin2-calendar-board p-6 space-y-4">
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
      <div className="admin2-calendar-board py-16 text-center text-sm text-destructive">
        Could not load the schedule board. Please try again.
      </div>
    );
  }

  const totalMin = endMinute - startMinute;
  const totalHours = Math.max(1, Math.round(totalMin / 60));
  const minTrackWidthPx = Math.max(900, totalHours * 90);

  return (
    <div
      className="admin2-calendar-board w-full max-h-[calc(100vh-210px)]"
      data-testid="schedule-board-view"
    >
      <div className="w-full flex flex-col" style={{ minWidth: `${minTrackWidthPx}px` }}>
        <div className="sticky top-0 z-20 flex border-b bg-card shadow-sm w-full">
          <div
            className="sticky left-0 z-30 shrink-0 border-r bg-card"
            style={{ width: DAY_LABEL_WIDTH_PX, height: HOUR_HEADER_HEIGHT_PX }}
          />
          <div
            className="relative bg-card flex-1"
            style={{ height: HOUR_HEADER_HEIGHT_PX }}
          >
            {hourMarks.slice(0, totalHours).map((minute, idx) => {
              const leftPercent = (idx / totalHours) * 100;
              const widthPercent = (1 / totalHours) * 100;
              return (
                <div
                  key={minute}
                  className="absolute top-0 flex items-center border-l border-border/40 pl-1.5 text-[11px] font-medium text-muted-foreground h-full overflow-hidden whitespace-nowrap"
                  style={{
                    left: `${leftPercent}%`,
                    width: `${widthPercent}%`,
                  }}
                >
                  {formatHourLabel(minute)}
                </div>
              );
            })}
            <div className="absolute top-0 bottom-0 right-0 border-r border-border/40 pointer-events-none" />
          </div>
        </div>
        {datesToShow.map((date) => (
          <ScheduleBoardRow
            key={date.toISOString()}
            date={date}
            occurrences={occurrencesByDate.get(format(date, "yyyy-MM-dd")) ?? []}
            gridStartMin={startMinute}
            gridEndMin={endMinute}
            hourMarks={hourMarks}
            onOccurrenceClick={onOccurrenceClick}
          />
        ))}
      </div>
    </div>
  );
}
