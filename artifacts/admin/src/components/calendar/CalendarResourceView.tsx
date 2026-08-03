import { useMemo } from "react";
import type { CalendarOccurrence } from "@workspace/api-client-react";
import {
  PX_PER_MIN,
  formatHourLabel,
  packDayColumns,
  calculateCalendarTimeRange,
  CalendarOccurrenceCard,
} from "./CalendarOccurrenceCard";
import { CalendarNowIndicator } from "./CalendarNowIndicator";

export interface CalendarResourceViewProps {
  isLoading: boolean;
  isError: boolean;
  rooms?: Array<{
    roomId: number;
    roomName: string;
    branchName?: string;
    occurrences: CalendarOccurrence[];
  }>;
  onOccurrenceClick: (occurrence: CalendarOccurrence) => void;
}

export function CalendarResourceView({
  isLoading,
  isError,
  rooms = [],
  onOccurrenceClick,
}: CalendarResourceViewProps) {
  const allOccurrences = useMemo(() => {
    return rooms.flatMap((r) => (r.occurrences ?? []) as CalendarOccurrence[]);
  }, [rooms]);

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
        Could not load resource view. Please try again.
      </div>
    );
  }

  const roomCount = rooms.length > 0 ? rooms.length : 1;

  return (
    <div className="overflow-x-auto rounded-md border bg-card shadow-sm" data-testid="calendar-resource-view-grid">
      <div style={{ minWidth: `${Math.max(420, 64 + roomCount * 180)}px` }}>
        <div
          className="sticky top-0 z-10 grid border-b bg-muted/90 backdrop-blur-sm"
          style={{ gridTemplateColumns: `64px repeat(${roomCount}, 1fr)` }}
        >
          <div />
          {rooms.map((room) => (
            <div
              key={room.roomId}
              className="border-l px-2 py-2 text-center"
              data-testid={`calendar-resource-room-header-${room.roomId}`}
            >
              <div className="text-[11px] font-medium text-muted-foreground truncate">
                {room.branchName ?? "Room"}
              </div>
              <div className="text-sm font-semibold text-foreground truncate">{room.roomName}</div>
            </div>
          ))}
        </div>
        <div
          className="grid"
          style={{ gridTemplateColumns: `64px repeat(${roomCount}, 1fr)` }}
        >
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
          {rooms.map((room) => {
            const roomOccurrences = packDayColumns(
              room.occurrences as unknown as CalendarOccurrence[],
            );
            return (
              <div
                key={room.roomId}
                className="relative overflow-hidden border-l"
                style={{ height: gridHeight }}
                data-testid={`calendar-resource-room-column-${room.roomId}`}
              >
                <CalendarNowIndicator
                  gridStartMin={startMinute}
                  gridEndMin={endMinute}
                />
                {hourMarks.map((minute) => (
                  <div
                    key={minute}
                    className="absolute left-0 right-0 border-t border-border/60"
                    style={{ top: (minute - startMinute) * PX_PER_MIN }}
                  />
                ))}
                {roomOccurrences.map((occurrence) => (
                  <CalendarOccurrenceCard
                    key={`${occurrence.source}-${occurrence.scheduleId}-${occurrence.occurrenceDate}`}
                    occurrence={occurrence}
                    onOpen={onOccurrenceClick}
                    gridStartMin={startMinute}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
