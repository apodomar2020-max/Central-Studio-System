import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { addDays, format, startOfWeek } from "date-fns";
import { AlertTriangle, Calendar as CalendarIcon, ChevronDown, ChevronLeft, ChevronRight, Plus, Users } from "lucide-react";
import {
  useListAdminCalendar,
  useGetAdminCalendarResourceView,
  getGetAdminCalendarResourceViewQueryKey,
  useListScheduleLocationBranches,
  useListScheduleLocationRooms,
  getListScheduleLocationRoomsQueryKey,
  type CalendarOccurrence,
} from "@workspace/api-client-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { OccurrenceDetailsSheet } from "@/components/calendar/OccurrenceDetailsSheet";
import { CreateRoomReservationDialog } from "@/components/calendar/CreateRoomReservationDialog";
import { ReservationDetailsSheet } from "@/components/calendar/ReservationDetailsSheet";
import {
  buildScheduleCreatePath,
  pixelOffsetToTimeString,
} from "@/lib/scheduleCalendarNavigation";

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type CalendarViewMode = "week" | "day" | "resource";

const GRID_START_MIN = 12 * 60;
const GRID_END_MIN = 24 * 60;
const PX_PER_MIN = 1;

function toMinutes(time: string): number {
  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

function formatHourLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60) % 24;
  const period = hours >= 12 ? "PM" : "AM";
  const display = hours % 12 === 0 ? 12 : hours % 12;
  return `${display} ${period}`;
}

type PositionedOccurrence = CalendarOccurrence & { col: number; totalCols: number };

function packDayColumns(dayOccurrences: CalendarOccurrence[]): PositionedOccurrence[] {
  const sorted = [...dayOccurrences].sort((a, b) =>
    toMinutes(a.startTime) - toMinutes(b.startTime) || toMinutes(a.endTime) - toMinutes(b.endTime),
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

function formatConflictSummary(conflict: NonNullable<PositionedOccurrence["conflict"]>): string {
  const location = [conflict.branchName, conflict.roomName].filter(Boolean).join(" · ") || "No location set";
  const title = conflict.classTitle || "Occupied";
  return `${title} · ${conflict.startTime}–${conflict.endTime} · ${location}`;
}

function OccurrenceCard({ occurrence, onOpen }: { occurrence: PositionedOccurrence; onOpen: (occurrence: PositionedOccurrence) => void }) {
  const startMin = toMinutes(occurrence.startTime);
  const endMin = Math.max(toMinutes(occurrence.endTime), startMin + 15);
  const top = (startMin - GRID_START_MIN) * PX_PER_MIN;
  const height = Math.max(24, (endMin - startMin) * PX_PER_MIN);
  const widthPct = 100 / occurrence.totalCols;
  const isBallet = occurrence.source === "ballet";
  const isReservation = occurrence.source === "reservation";
  const displayTitle = occurrence.title || occurrence.classTitle || "Untitled Event";
  const location = [occurrence.branchName, occurrence.roomName].filter(Boolean).join(" · ") || "No location set";
  const conflict = occurrence.conflict;

  let categoryBg = "bg-emerald-500/15";
  let categoryBorder = "border-emerald-400/40";
  if (isBallet) {
    categoryBg = "bg-[#8A5CFF26]";
    categoryBorder = "border-[#8A5CFF66]";
  } else if (isReservation) {
    categoryBg = "bg-amber-500/15";
    categoryBorder = "border-amber-500/40 text-amber-950 dark:text-amber-100";
  }

  const tooltip = conflict
    ? `${displayTitle} · ${occurrence.startTime}–${occurrence.endTime}\nConflicts with: ${formatConflictSummary(conflict)}`
    : `${displayTitle} · ${occurrence.startTime}–${occurrence.endTime}`;

  return (
    <div
      role="button"
      tabIndex={0}
      className={
        "absolute overflow-hidden rounded-md border px-2 py-1 text-left shadow-sm text-foreground " +
        "cursor-pointer transition-[filter] hover:brightness-125 hover:shadow-md " +
        categoryBg + " " +
        (conflict ? "border-2 border-destructive" : categoryBorder)
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
          className="absolute right-0.5 top-0.5 rounded-sm bg-destructive p-0.5 text-destructive-foreground"
          data-testid={`calendar-conflict-badge-${occurrence.source}-${occurrence.scheduleId}-${occurrence.occurrenceDate}`}
        >
          <AlertTriangle className="h-2.5 w-2.5" aria-label="Scheduling conflict" />
        </div>
      )}
      <div className="truncate text-xs font-semibold leading-tight pr-4">{displayTitle}</div>
      {height > 32 && (
        <div className="truncate text-[11px] leading-tight opacity-90">
          {isReservation
            ? (occurrence.organizerName || (occurrence.reservationType ? occurrence.reservationType.replace("_", " ") : "Private Event"))
            : (occurrence.instructorName ?? "No instructor")}
        </div>
      )}
      {height > 46 && <div className="truncate text-[11px] leading-tight opacity-75">{location}</div>}
      {!isReservation && height > 60 && (
        <div className="mt-0.5 flex items-center gap-1 text-[11px] leading-tight opacity-90">
          <Users className="h-3 w-3" />
          {occurrence.bookingCount}
        </div>
      )}
      {conflict && height > 75 && (
        <div className="mt-0.5 flex items-start gap-1 truncate text-[10px] font-medium leading-tight text-destructive">
          <AlertTriangle className="mt-px h-2.5 w-2.5 shrink-0" />
          <span className="truncate">Conflicts with {formatConflictSummary(conflict)}</span>
        </div>
      )}
    </div>
  );
}

export default function CalendarPage() {
  const [, navigate] = useLocation();
  const { can } = useAdminAuth();
  const canCreateSchedule = can("schedules", "create");
  const canCreateReservation = can("room_reservations", "create");

  const [viewMode, setViewMode] = useState<CalendarViewMode>("week");
  const [focusedDate, setFocusedDate] = useState(() => new Date());
  const [branchId, setBranchId] = useState<number | null>(null);
  const [roomId, setRoomId] = useState<number | null>(null);
  const [selectedOccurrence, setSelectedOccurrence] = useState<CalendarOccurrence | null>(null);
  const [selectedReservationId, setSelectedReservationId] = useState<number | null>(null);
  const [createReservationOpen, setCreateReservationOpen] = useState(false);

  const weekStart = useMemo(() => startOfWeek(focusedDate, { weekStartsOn: 0 }), [focusedDate]);
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const datesToShow = viewMode === "week" ? weekDates : [focusedDate];

  const from = format(datesToShow[0], "yyyy-MM-dd");
  const to = format(datesToShow[datesToShow.length - 1], "yyyy-MM-dd");

  const branchesQuery = useListScheduleLocationBranches();
  const roomsQuery = useListScheduleLocationRooms(branchId ?? 0, {
    query: { enabled: branchId != null, queryKey: getListScheduleLocationRoomsQueryKey(branchId ?? 0) },
  });

  const calendarQuery = useListAdminCalendar({
    from,
    to,
    ...(branchId != null ? { branchId } : {}),
    ...(roomId != null ? { roomId } : {}),
  });
  const occurrences = calendarQuery.data ?? [];

  const resourceParams = useMemo(
    () => ({
      date: format(focusedDate, "yyyy-MM-dd"),
      ...(branchId != null ? { branchId } : {}),
      ...(roomId != null ? { roomId } : {}),
    }),
    [focusedDate, branchId, roomId],
  );

  const resourceViewQuery = useGetAdminCalendarResourceView(
    resourceParams,
    {
      query: {
        enabled: viewMode === "resource",
        queryKey: getGetAdminCalendarResourceViewQueryKey(resourceParams),
      },
    },
  );

  const hourMarks = useMemo(() => {
    const marks: number[] = [];
    for (let m = GRID_START_MIN; m <= GRID_END_MIN; m += 60) marks.push(m);
    return marks;
  }, []);
  const gridHeight = (GRID_END_MIN - GRID_START_MIN) * PX_PER_MIN;

  const occurrencesByDate = useMemo(() => {
    const map = new Map<string, CalendarOccurrence[]>();
    for (const occurrence of occurrences) {
      const list = map.get(occurrence.occurrenceDate) ?? [];
      list.push(occurrence);
      map.set(occurrence.occurrenceDate, list);
    }
    return map;
  }, [occurrences]);

  const goPrev = () => setFocusedDate((d) => addDays(d, viewMode === "week" ? -7 : -1));
  const goNext = () => setFocusedDate((d) => addDays(d, viewMode === "week" ? 7 : 1));
  const goToday = () => setFocusedDate(new Date());

  const rangeLabel = viewMode === "week"
    ? `${format(weekDates[0], "MMM d")} – ${format(weekDates[6], "MMM d, yyyy")}`
    : format(focusedDate, "EEEE, MMM d, yyyy");

  const gridColsClass = viewMode === "week" ? "grid-cols-[64px_repeat(7,1fr)]" : "grid-cols-[64px_1fr]";

  const handleOccurrenceCardClick = (occurrence: CalendarOccurrence) => {
    if (occurrence.source === "reservation") {
      setSelectedReservationId(occurrence.scheduleId);
    } else {
      setSelectedOccurrence(occurrence);
    }
  };

  const openCreateForDate = (dateKey: string, startTime?: string) => {
    navigate(buildScheduleCreatePath({ date: dateKey, startTime, branchId, roomId }));
  };

  const handleEmptySlotClick = (event: React.MouseEvent<HTMLDivElement>, dateKey: string) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const offsetMinutes = event.clientY - rect.top;
    openCreateForDate(dateKey, pixelOffsetToTimeString(offsetMinutes, GRID_START_MIN, GRID_END_MIN));
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Calendar" description="Studio schedule at a glance" mode="studio" />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border p-0.5">
            <Button
              variant={viewMode === "week" ? "default" : "ghost"}
              size="sm"
              className="h-7 px-3"
              data-testid="button-calendar-view-week"
              onClick={() => setViewMode("week")}
            >
              Week
            </Button>
            <Button
              variant={viewMode === "day" ? "default" : "ghost"}
              size="sm"
              className="h-7 px-3"
              data-testid="button-calendar-view-day"
              onClick={() => setViewMode("day")}
            >
              Day
            </Button>
            <Button
              variant={viewMode === "resource" ? "default" : "ghost"}
              size="sm"
              className="h-7 px-3"
              data-testid="button-calendar-view-resource"
              onClick={() => setViewMode("resource")}
            >
              Resource
            </Button>
          </div>
          <Button variant="outline" size="icon" data-testid="button-calendar-prev" onClick={goPrev}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" data-testid="button-calendar-today" onClick={goToday}>
            Today
          </Button>
          <Button variant="outline" size="icon" data-testid="button-calendar-next" onClick={goNext}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="ml-2 text-sm font-medium text-foreground">{rangeLabel}</span>

          {(canCreateSchedule || canCreateReservation) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" className="gap-1.5 ml-2" data-testid="button-calendar-add-dropdown">
                  <Plus className="h-4 w-4" />
                  Add
                  <ChevronDown className="h-3.5 w-3.5 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[180px]">
                {canCreateSchedule && (
                  <DropdownMenuItem
                    data-testid="dropdown-item-add-class"
                    onClick={() =>
                      navigate(
                        buildScheduleCreatePath({
                          date: viewMode === "day" || viewMode === "resource" ? format(focusedDate, "yyyy-MM-dd") : null,
                          branchId,
                          roomId,
                        })
                      )
                    }
                  >
                    <CalendarIcon className="mr-2 h-4 w-4 text-emerald-500" />
                    Add Class
                  </DropdownMenuItem>
                )}
                {canCreateReservation && (
                  <DropdownMenuItem
                    data-testid="dropdown-item-add-private-event"
                    onClick={() => setCreateReservationOpen(true)}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4 text-amber-500" />
                    Add Private Event
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Select
            value={branchId != null ? String(branchId) : "all"}
            onValueChange={(value) => {
              setBranchId(value === "all" ? null : Number(value));
              setRoomId(null);
            }}
          >
            <SelectTrigger className="w-[160px]" data-testid="select-calendar-branch">
              <SelectValue placeholder="All branches" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All branches</SelectItem>
              {branchesQuery.data?.map((branch) => (
                <SelectItem key={branch.id} value={String(branch.id)}>{branch.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={roomId != null ? String(roomId) : "all"}
            onValueChange={(value) => setRoomId(value === "all" ? null : Number(value))}
            disabled={branchId == null}
          >
            <SelectTrigger className="w-[160px]" data-testid="select-calendar-room">
              <SelectValue placeholder="All rooms" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All rooms</SelectItem>
              {roomsQuery.data?.map((room) => (
                <SelectItem key={room.id} value={String(room.id)}>{room.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500/40 border border-emerald-400/50" />Studio class</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: "#8A5CFF40", borderColor: "#8A5CFF66", borderWidth: 1 }} />Ballet</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-amber-500/40 border border-amber-400/50" />Private event</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm border-2 border-destructive" />Conflict</span>
      </div>

      {viewMode === "resource" ? (
        resourceViewQuery.isLoading ? (
          <div className="rounded-md border py-16 text-center text-sm text-muted-foreground">Loading resource view…</div>
        ) : resourceViewQuery.isError ? (
          <div className="rounded-md border py-16 text-center text-sm text-destructive">Could not load resource view. Please try again.</div>
        ) : (
          <div className="overflow-x-auto rounded-md border" data-testid="calendar-resource-view-grid">
            <div style={{ minWidth: `${Math.max(420, 64 + (resourceViewQuery.data?.rooms.length ?? 1) * 180)}px` }}>
              <div
                className="grid border-b bg-muted/40"
                style={{ gridTemplateColumns: `64px repeat(${resourceViewQuery.data?.rooms.length ?? 1}, 1fr)` }}
              >
                <div />
                {resourceViewQuery.data?.rooms.map((room) => (
                  <div key={room.roomId} className="border-l px-2 py-2 text-center" data-testid={`calendar-resource-room-header-${room.roomId}`}>
                    <div className="text-xs font-medium text-muted-foreground">Room</div>
                    <div className="text-sm font-semibold text-foreground truncate">{room.roomName}</div>
                  </div>
                ))}
              </div>
              <div
                className="grid"
                style={{ gridTemplateColumns: `64px repeat(${resourceViewQuery.data?.rooms.length ?? 1}, 1fr)` }}
              >
                <div className="relative overflow-hidden" style={{ height: gridHeight }}>
                  {hourMarks.map((minute) => (
                    <div
                      key={minute}
                      className="absolute right-2 -translate-y-1/2 text-[11px] text-muted-foreground"
                      style={{ top: (minute - GRID_START_MIN) * PX_PER_MIN }}
                    >
                      {formatHourLabel(minute)}
                    </div>
                  ))}
                </div>
                {resourceViewQuery.data?.rooms.map((room) => {
                  const roomOccurrences = packDayColumns(room.occurrences as unknown as CalendarOccurrence[]);
                  return (
                    <div
                      key={room.roomId}
                      className="relative overflow-hidden border-l"
                      style={{ height: gridHeight }}
                      data-testid={`calendar-resource-room-column-${room.roomId}`}
                    >
                      {hourMarks.map((minute) => (
                        <div key={minute} className="absolute left-0 right-0 border-t border-border/60" style={{ top: (minute - GRID_START_MIN) * PX_PER_MIN }} />
                      ))}
                      {roomOccurrences.map((occurrence) => (
                        <OccurrenceCard
                          key={`${occurrence.source}-${occurrence.scheduleId}-${occurrence.occurrenceDate}`}
                          occurrence={occurrence}
                          onOpen={handleOccurrenceCardClick}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )
      ) : calendarQuery.isLoading ? (
        <div className="rounded-md border py-16 text-center text-sm text-muted-foreground">Loading calendar…</div>
      ) : calendarQuery.isError ? (
        <div className="rounded-md border py-16 text-center text-sm text-destructive">Could not load the calendar. Please try again.</div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <div className={viewMode === "week" ? "min-w-[880px]" : "min-w-[420px]"}>
            <div className={`grid ${gridColsClass} border-b bg-muted/40`}>
              <div />
              {datesToShow.map((date) => (
                <div key={date.toISOString()} className="border-l px-2 py-2 text-center">
                  <div className="text-xs font-medium text-muted-foreground">{DAY_SHORT[date.getDay()]}</div>
                  <div className="text-sm font-semibold text-foreground">{format(date, "d")}</div>
                </div>
              ))}
            </div>
            <div className={`grid ${gridColsClass}`}>
              <div className="relative overflow-hidden" style={{ height: gridHeight }}>
                {hourMarks.map((minute) => (
                  <div
                    key={minute}
                    className="absolute right-2 -translate-y-1/2 text-[11px] text-muted-foreground"
                    style={{ top: (minute - GRID_START_MIN) * PX_PER_MIN }}
                  >
                    {formatHourLabel(minute)}
                  </div>
                ))}
              </div>
              {datesToShow.map((date) => {
                const dateKey = format(date, "yyyy-MM-dd");
                const dayOccurrences = packDayColumns(occurrencesByDate.get(dateKey) ?? []);
                return (
                  <div
                    key={dateKey}
                    className={"relative overflow-hidden border-l" + (canCreateSchedule ? " cursor-pointer hover:bg-muted/20" : "")}
                    style={{ height: gridHeight }}
                    data-testid={`calendar-day-column-${dateKey}`}
                    onClick={canCreateSchedule ? (event) => handleEmptySlotClick(event, dateKey) : undefined}
                    title={canCreateSchedule ? "Click to add a schedule at this time" : undefined}
                  >
                    {hourMarks.map((minute) => (
                      <div key={minute} className="absolute left-0 right-0 border-t border-border/60" style={{ top: (minute - GRID_START_MIN) * PX_PER_MIN }} />
                    ))}
                    {dayOccurrences.map((occurrence) => (
                      <OccurrenceCard
                        key={`${occurrence.source}-${occurrence.scheduleId}-${occurrence.occurrenceDate}`}
                        occurrence={occurrence}
                        onOpen={handleOccurrenceCardClick}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Class / Ballet Occurrence Sheet */}
      <OccurrenceDetailsSheet
        occurrence={selectedOccurrence}
        onOpenChange={(open) => {
          if (!open) setSelectedOccurrence(null);
        }}
      />

      {/* Private Room Reservation Details Sheet */}
      <ReservationDetailsSheet
        reservationId={selectedReservationId}
        open={selectedReservationId != null}
        onOpenChange={(open) => {
          if (!open) setSelectedReservationId(null);
        }}
      />

      {/* Add Private Event Dialog */}
      <CreateRoomReservationDialog
        open={createReservationOpen}
        onOpenChange={setCreateReservationOpen}
        defaultValues={{
          branchId,
          roomId,
          date: viewMode === "day" || viewMode === "resource" ? format(focusedDate, "yyyy-MM-dd") : null,
        }}
      />
    </div>
  );
}
