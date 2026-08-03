import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { addDays, format, parseISO, startOfWeek } from "date-fns";
import {
  useListAdminCalendar,
  useGetAdminCalendarResourceView,
  getGetAdminCalendarResourceViewQueryKey,
  useListScheduleLocationBranches,
  useListScheduleLocationRooms,
  getListScheduleLocationRoomsQueryKey,
  type CalendarOccurrence,
} from "@workspace/api-client-react";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { CalendarHeader, type CalendarViewMode } from "@/components/calendar/CalendarHeader";
import { CalendarGrid } from "@/components/calendar/CalendarGrid";
import { CalendarResourceView } from "@/components/calendar/CalendarResourceView";
import { OccurrenceDetailsSheet } from "@/components/calendar/OccurrenceDetailsSheet";
import { CreateRoomReservationDialog } from "@/components/calendar/CreateRoomReservationDialog";
import { ReservationDetailsSheet } from "@/components/calendar/ReservationDetailsSheet";
import {
  SlotQuickActionPopover,
  type SlotQuickActionContext,
} from "@/components/calendar/SlotQuickActionPopover";
import {
  parseCalendarUrlState,
  buildCalendarUrl,
  savePreferredCalendarState,
  getPreferredCalendarState,
  type CalendarUrlState,
} from "@/components/calendar/calendarState";
import { GRID_START_MIN, GRID_END_MIN } from "@/components/calendar/CalendarOccurrenceCard";
import {
  buildScheduleCreatePath,
  pixelOffsetToTimeString,
} from "@/lib/scheduleCalendarNavigation";

export default function CalendarPage() {
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const { can } = useAdminAuth();
  const canCreateSchedule = can("schedules", "create");
  const canCreateReservation = can("room_reservations", "create");

  const urlState = useMemo(() => parseCalendarUrlState(searchString), [searchString]);

  // Restore fallback preferences from localStorage if accessed with clean /calendar URL
  useEffect(() => {
    if (!searchString) {
      const preferred = getPreferredCalendarState();
      if (preferred && (preferred.view || preferred.branchId != null || preferred.roomId != null)) {
        const initialUrl = buildCalendarUrl(preferred, urlState);
        navigate(initialUrl, { replace: true });
      }
    }
  }, []);

  const viewMode = urlState.view;
  const focusedDate = useMemo(() => parseISO(urlState.date), [urlState.date]);
  const branchId = urlState.branchId;
  const roomId = urlState.roomId;

  const [selectedOccurrence, setSelectedOccurrence] = useState<CalendarOccurrence | null>(null);
  const [selectedReservationId, setSelectedReservationId] = useState<number | null>(null);
  const [createReservationOpen, setCreateReservationOpen] = useState(false);

  const [reservationDefaults, setReservationDefaults] = useState<{
    branchId?: number | null;
    roomId?: number | null;
    date?: string | null;
    startTime?: string | null;
  } | null>(null);

  const [quickActionState, setQuickActionState] = useState<{
    open: boolean;
    anchorPosition: { x: number; y: number } | null;
    slotContext: SlotQuickActionContext | null;
  }>({
    open: false,
    anchorPosition: null,
    slotContext: null,
  });

  const updateUrlState = (updates: Partial<CalendarUrlState>) => {
    const nextUrl = buildCalendarUrl(updates, urlState);
    savePreferredCalendarState(updates);
    navigate(nextUrl, { replace: true });
  };

  const setViewMode = (mode: CalendarViewMode) => updateUrlState({ view: mode });
  const setFocusedDate = (date: Date) => updateUrlState({ date: format(date, "yyyy-MM-dd") });
  const handleBranchChange = (newBranchId: number | null) =>
    updateUrlState({ branchId: newBranchId, roomId: null });
  const setRoomId = (newRoomId: number | null) => updateUrlState({ roomId: newRoomId });

  const weekStart = useMemo(() => startOfWeek(focusedDate, { weekStartsOn: 0 }), [focusedDate]);
  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
    [weekStart],
  );
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

  const resourceViewQuery = useGetAdminCalendarResourceView(resourceParams, {
    query: {
      enabled: viewMode === "resource",
      queryKey: getGetAdminCalendarResourceViewQueryKey(resourceParams),
    },
  });

  const occurrencesByDate = useMemo(() => {
    const map = new Map<string, CalendarOccurrence[]>();
    for (const occurrence of occurrences) {
      const list = map.get(occurrence.occurrenceDate) ?? [];
      list.push(occurrence);
      map.set(occurrence.occurrenceDate, list);
    }
    return map;
  }, [occurrences]);

  const goPrev = () => setFocusedDate(addDays(focusedDate, viewMode === "week" ? -7 : -1));
  const goNext = () => setFocusedDate(addDays(focusedDate, viewMode === "week" ? 7 : 1));
  const goToday = () => setFocusedDate(new Date());

  const rangeLabel =
    viewMode === "week"
      ? `${format(weekDates[0], "MMM d")} – ${format(weekDates[6], "MMM d, yyyy")}`
      : format(focusedDate, "EEEE, MMM d, yyyy");

  const handleOccurrenceCardClick = (occurrence: CalendarOccurrence) => {
    if (occurrence.source === "reservation") {
      setSelectedReservationId(occurrence.scheduleId);
    } else {
      setSelectedOccurrence(occurrence);
    }
  };

  const handleEmptySlotClick = (
    event: React.MouseEvent<HTMLDivElement>,
    dateKey: string,
    gridStartMin = GRID_START_MIN,
    gridEndMin = GRID_END_MIN,
  ) => {
    if (!canCreateSchedule && !canCreateReservation) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const offsetMinutes = event.clientY - rect.top;
    const startTime = pixelOffsetToTimeString(offsetMinutes, gridStartMin, gridEndMin);

    setQuickActionState({
      open: true,
      anchorPosition: { x: event.clientX, y: event.clientY },
      slotContext: {
        date: dateKey,
        startTime,
        branchId,
        roomId,
      },
    });
  };

  const handleQuickActionAddClass = (context: SlotQuickActionContext) => {
    navigate(
      buildScheduleCreatePath({
        date: context.date,
        startTime: context.startTime,
        branchId: context.branchId,
        roomId: context.roomId,
      }),
    );
  };

  const handleQuickActionAddPrivateEvent = (context: SlotQuickActionContext) => {
    setReservationDefaults({
      branchId: context.branchId ?? branchId,
      roomId: context.roomId ?? roomId,
      date: context.date,
      startTime: context.startTime,
    });
    setCreateReservationOpen(true);
  };

  const handleAddClassClick = () => {
    navigate(
      buildScheduleCreatePath({
        date: viewMode === "day" || viewMode === "resource" ? format(focusedDate, "yyyy-MM-dd") : null,
        branchId,
        roomId,
      }),
    );
  };

  return (
    <div className="space-y-6">
      <CalendarHeader
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        rangeLabel={rangeLabel}
        onPrev={goPrev}
        onNext={goNext}
        onToday={goToday}
        canCreateSchedule={canCreateSchedule}
        canCreateReservation={canCreateReservation}
        onAddClassClick={handleAddClassClick}
        onAddPrivateEventClick={() => {
          setReservationDefaults(null);
          setCreateReservationOpen(true);
        }}
        branchId={branchId}
        onBranchChange={handleBranchChange}
        branches={branchesQuery.data}
        roomId={roomId}
        onRoomChange={setRoomId}
        rooms={roomsQuery.data}
      />

      {viewMode === "resource" ? (
        <CalendarResourceView
          isLoading={resourceViewQuery.isLoading}
          isError={resourceViewQuery.isError}
          rooms={resourceViewQuery.data?.rooms as any}
          onOccurrenceClick={handleOccurrenceCardClick}
        />
      ) : (
        <CalendarGrid
          viewMode={viewMode}
          datesToShow={datesToShow}
          occurrencesByDate={occurrencesByDate}
          isLoading={calendarQuery.isLoading}
          isError={calendarQuery.isError}
          canCreateSchedule={canCreateSchedule}
          canCreateReservation={canCreateReservation}
          onSlotClick={handleEmptySlotClick}
          onOccurrenceClick={handleOccurrenceCardClick}
        />
      )}

      {/* Empty Slot Quick Action Popover */}
      <SlotQuickActionPopover
        open={quickActionState.open}
        onOpenChange={(open) =>
          setQuickActionState((prev) => ({ ...prev, open }))
        }
        anchorPosition={quickActionState.anchorPosition}
        slotContext={quickActionState.slotContext}
        canCreateSchedule={canCreateSchedule}
        canCreateReservation={canCreateReservation}
        onAddClass={handleQuickActionAddClass}
        onAddPrivateEvent={handleQuickActionAddPrivateEvent}
      />

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
        onOpenChange={(open) => {
          setCreateReservationOpen(open);
          if (!open) setReservationDefaults(null);
        }}
        defaultValues={
          reservationDefaults ?? {
            branchId,
            roomId,
            date: viewMode === "day" || viewMode === "resource" ? format(focusedDate, "yyyy-MM-dd") : null,
          }
        }
      />
    </div>
  );
}
