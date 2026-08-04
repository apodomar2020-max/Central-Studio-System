import { AlertTriangle } from "lucide-react";
import type { CalendarOccurrence } from "@workspace/api-client-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { formatConflictSummary } from "./CalendarOccurrenceCard";
import { getCalendarCategoryTokens } from "./calendarTokens";
import {
  BOARD_LANE_GAP_PX,
  BOARD_LANE_HEIGHT_PX,
  BOARD_ROW_PADDING_PX,
  BOARD_MIN_EVENT_WIDTH_PX,
  type BoardPositionedOccurrence,
} from "./scheduleBoardUtils";

export interface ScheduleBoardEventProps {
  occurrence: BoardPositionedOccurrence;
  onOpen: (occurrence: CalendarOccurrence) => void;
}

/**
 * A single horizontal timeline block — width represents real duration.
 *
 * Card content is title-only, always (Phase 6J) — every other detail
 * (instructor, location, time, type) moved to the hover preview below.
 * Hovering never opens/blocks the click-to-open-sheet behavior: HoverCard
 * is a separate floating layer, not an interaction gate on the trigger.
 */
export function ScheduleBoardEvent({ occurrence, onOpen }: ScheduleBoardEventProps) {
  const displayTitle = occurrence.title || occurrence.classTitle || "Untitled Event";
  const conflict = occurrence.conflict;
  const isReservation = occurrence.source === "reservation";
  const instructorName = isReservation
    ? occurrence.organizerName || (occurrence.reservationType ? occurrence.reservationType.replace("_", " ") : undefined)
    : occurrence.instructorName;
  const location = [occurrence.branchName, occurrence.roomName].filter(Boolean).join(" - ");

  const typeLabel =
    occurrence.source === "class"
      ? "Class"
      : occurrence.source === "ballet"
      ? "Ballet"
      : occurrence.source === "reservation"
      ? "Reservation"
      : getCalendarCategoryTokens(occurrence.source as any).label;

  const tokens = getCalendarCategoryTokens(occurrence.source as any);
  const top = BOARD_ROW_PADDING_PX + occurrence.laneIndex * (BOARD_LANE_HEIGHT_PX + BOARD_LANE_GAP_PX);

  const card = (
    <div
      role="button"
      tabIndex={0}
      className={
        "absolute overflow-hidden rounded-md text-left shadow-sm flex flex-col justify-center px-2.5 py-1 " +
        "cursor-pointer transition-all hover:brightness-105 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
        tokens.bg + " " +
        (conflict ? "border-2 border-destructive border-l-4 border-l-destructive" : tokens.border)
      }
      style={{
        top,
        height: BOARD_LANE_HEIGHT_PX,
        left: `${occurrence.leftPercent}%`,
        width: `${occurrence.widthPercent}%`,
      }}
      data-testid={`schedule-board-event-${occurrence.source}-${occurrence.scheduleId}-${occurrence.occurrenceDate}`}
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
          data-testid={`schedule-board-conflict-badge-${occurrence.source}-${occurrence.scheduleId}-${occurrence.occurrenceDate}`}
        >
          <AlertTriangle className="h-3 w-3" aria-label="Scheduling conflict" />
        </div>
      )}
      <div className={"truncate text-xs font-semibold leading-tight text-foreground " + (conflict ? "pr-4" : "")}>
        {displayTitle}
      </div>
    </div>
  );

  return (
    <HoverCard openDelay={150} closeDelay={0}>
      <HoverCardTrigger asChild>{card}</HoverCardTrigger>
      <HoverCardContent
        side="top"
        align="start"
        className="w-64 space-y-2 text-sm"
        data-testid={`schedule-board-preview-${occurrence.source}-${occurrence.scheduleId}-${occurrence.occurrenceDate}`}
      >
        <p className="font-semibold text-popover-foreground">{displayTitle}</p>
        <dl className="space-y-1.5 text-xs">
          {instructorName && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground font-medium">Instructor:</dt>
              <dd className="text-right font-medium text-popover-foreground">{instructorName}</dd>
            </div>
          )}
          {location && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground font-medium">Location:</dt>
              <dd className="text-right font-medium text-popover-foreground">{location}</dd>
            </div>
          )}
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground font-medium">Time:</dt>
            <dd className="text-right font-medium text-popover-foreground">
              {occurrence.startTime} - {occurrence.endTime}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground font-medium">Type:</dt>
            <dd className="text-right font-medium text-popover-foreground">{typeLabel}</dd>
          </div>
        </dl>
        {conflict && (
          <p className="border-t pt-2 text-xs font-medium text-destructive">
            Conflicts with {formatConflictSummary(conflict)}
          </p>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}
