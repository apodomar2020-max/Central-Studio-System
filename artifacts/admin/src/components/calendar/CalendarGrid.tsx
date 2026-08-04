import type { CalendarOccurrence } from "@workspace/api-client-react";
import { ScheduleBoardView } from "./ScheduleBoardView";

export interface CalendarGridProps {
  viewMode: "week" | "day";
  datesToShow: Date[];
  occurrencesByDate: Map<string, CalendarOccurrence[]>;
  isLoading: boolean;
  isError: boolean;
  canCreateSchedule?: boolean;
  canCreateReservation?: boolean;
  onSlotClick?: (
    event: React.MouseEvent<HTMLDivElement>,
    dateKey: string,
    gridStartMin?: number,
    gridEndMin?: number,
  ) => void;
  onOccurrenceClick: (occurrence: CalendarOccurrence) => void;
}

export function CalendarGrid({
  datesToShow,
  occurrencesByDate,
  isLoading,
  isError,
  onOccurrenceClick,
}: CalendarGridProps) {
  return (
    <ScheduleBoardView
      datesToShow={datesToShow}
      occurrencesByDate={occurrencesByDate}
      isLoading={isLoading}
      isError={isError}
      onOccurrenceClick={onOccurrenceClick}
    />
  );
}
