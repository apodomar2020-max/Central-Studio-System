/**
 * Occurrence Details Sheet (Phase 4A.2) — the Calendar's read-only detail
 * panel for a single occurrence. Opened by clicking a calendar card; NOT a
 * create/edit form. The only path back into Schedule editing is the
 * "Edit Schedule" button, which reuses the exact same navigation helpers
 * Phase 3 wired up (`buildScheduleEditPath` / `buildBalletScheduleListPath`)
 * — this component never navigates on its own initiative.
 */
import { useLocation } from "wouter";
import { format, parseISO } from "date-fns";
import { Users } from "lucide-react";
import {
  useGetAdminCalendarOccurrenceRoster,
  getGetAdminCalendarOccurrenceRosterQueryKey,
  type CalendarOccurrence,
} from "@workspace/api-client-react";
import {
  Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { buildBalletScheduleListPath, buildScheduleEditPath } from "@/lib/scheduleCalendarNavigation";
import { getCalendarCategoryTokens } from "./calendarTokens";

function bookingStatusVariant(status: string): "default" | "secondary" | "destructive" {
  if (status === "cancelled" || status === "rejected") return "destructive";
  if (status === "confirmed" || status === "attended" || status === "completed") return "default";
  return "secondary";
}

function paymentStatusVariant(status: string): "default" | "secondary" | "destructive" {
  if (status === "failed") return "destructive";
  if (status === "paid" || status === "not_required") return "default";
  return "secondary";
}

function attendanceStatusVariant(status: string): "default" | "secondary" | "destructive" {
  if (status === "absent" || status === "cancelled") return "destructive";
  if (status === "checked_in" || status === "late") return "default";
  return "secondary";
}

function attendanceStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    checked_in: "Checked In",
    late: "Late",
    absent: "Absent",
    cancelled: "Cancelled",
  };
  return labels[status] ?? status;
}

export interface OccurrenceDetailsSheetProps {
  occurrence: CalendarOccurrence | null;
  onOpenChange: (open: boolean) => void;
}

export function OccurrenceDetailsSheet({ occurrence, onOpenChange }: OccurrenceDetailsSheetProps) {
  const [, navigate] = useLocation();
  const { can } = useAdminAuth();
  const canViewRoster = can("bookings", "view") && can("attendance", "view");

  const isClassOrBallet = occurrence?.source === "class" || occurrence?.source === "ballet";
  const rosterSource = occurrence?.source === "ballet" ? "ballet" : "class";
  const rosterParams = {
    source: rosterSource,
    scheduleId: occurrence?.scheduleId ?? 0,
    occurrenceDate: occurrence?.occurrenceDate ?? "",
  } as const;
  const rosterQuery = useGetAdminCalendarOccurrenceRoster(rosterParams, {
    query: {
      enabled: occurrence != null && isClassOrBallet && canViewRoster,
      queryKey: getGetAdminCalendarOccurrenceRosterQueryKey(rosterParams),
    },
  });

  if (!occurrence) {
    return <Sheet open={false} onOpenChange={onOpenChange} />;
  }

  const isBallet = occurrence.source === "ballet";
  const tokens = getCalendarCategoryTokens(occurrence.source as any);
  const location = [occurrence.branchName, occurrence.roomName].filter(Boolean).join(" · ") || "No location set";
  const dateLabel = format(parseISO(occurrence.occurrenceDate), "EEEE, MMM d, yyyy");
  const bookingCount = occurrence.bookingCount ?? 0;
  const capacityPct = occurrence.capacity ? Math.min(100, Math.round((bookingCount / occurrence.capacity) * 100)) : 0;

  const handleEditClick = () => {
    navigate(isBallet ? buildBalletScheduleListPath() : buildScheduleEditPath(occurrence.scheduleId));
  };

  return (
    <Sheet open={occurrence != null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl">
        <SheetHeader className="border-b px-5 py-4 text-left">
          <div className="flex items-center gap-2 pr-6">
            <SheetTitle>{occurrence.classTitle}</SheetTitle>
            <Badge variant="outline" className={`${tokens.badgeBg} ${tokens.badgeBorder} ${tokens.badgeText}`}>
              {isBallet ? "Ballet" : "Studio Class"}
            </Badge>
          </div>
          <SheetDescription>
            {dateLabel} · {occurrence.startTime}–{occurrence.endTime}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-5 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border p-3 bg-card shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Location</p>
              <p className="mt-1 text-sm font-medium text-foreground">{location}</p>
            </div>
            <div className="rounded-lg border p-3 bg-card shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Instructor</p>
              <p className="mt-1 text-sm font-medium text-foreground">{occurrence.instructorName ?? "No instructor"}</p>
            </div>
          </div>

          <div className="rounded-lg border p-3 bg-card shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Capacity</p>
            {occurrence.capacity == null ? (
              <p className="mt-1 text-sm text-foreground">No capacity limit</p>
            ) : (
              <div className="mt-1 space-y-1.5">
                <div className="flex items-center gap-1.5 text-sm text-foreground">
                  <Users className="h-3.5 w-3.5" />
                  {occurrence.bookingCount} / {occurrence.capacity} booked
                </div>
                <Progress value={capacityPct} />
              </div>
            )}
          </div>

          {rosterQuery.data?.summary && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Operational Overview</p>
              <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <div className="rounded-md bg-muted/50 p-2.5 border shadow-sm">
                  <p className="text-muted-foreground">Checked In</p>
                  <p className="mt-0.5 text-base font-semibold text-foreground" data-testid="summary-metric-checked-in">
                    {rosterQuery.data.summary.checkedInCount}
                  </p>
                </div>
                <div className="rounded-md bg-muted/50 p-2.5 border shadow-sm">
                  <p className="text-muted-foreground">Pending Check-in</p>
                  <p className="mt-0.5 text-base font-semibold text-foreground" data-testid="summary-metric-pending">
                    {rosterQuery.data.summary.pendingCheckInCount}
                  </p>
                </div>
                <div className="rounded-md bg-muted/50 p-2.5 border shadow-sm">
                  <p className="text-muted-foreground">Absent</p>
                  <p className="mt-0.5 text-base font-semibold text-foreground" data-testid="summary-metric-absent">
                    {rosterQuery.data.summary.absentCount}
                  </p>
                </div>
                <div className="rounded-md bg-muted/50 p-2.5 border shadow-sm">
                  <p className="text-muted-foreground">Unpaid</p>
                  <p className="mt-0.5 text-base font-semibold text-foreground" data-testid="summary-metric-unpaid">
                    {rosterQuery.data.summary.unpaidCount}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Bookings</p>
            {!canViewRoster ? (
              <p className="text-sm text-muted-foreground">You do not have permission to view booking details.</p>
            ) : rosterQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading bookings...</p>
            ) : rosterQuery.isError ? (
              <p className="text-sm text-destructive">Could not load bookings. Please try again.</p>
            ) : !rosterQuery.data?.roster.length ? (
              <p className="text-sm text-muted-foreground">No bookings yet</p>
            ) : (
              <div className="space-y-2">
                {rosterQuery.data.roster.map((booking) => (
                  <div key={booking.bookingId} className="rounded-md border px-3 py-2 bg-card shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{booking.participantName}</p>
                        {booking.participantName !== booking.studentName && (
                          <p className="truncate text-xs text-muted-foreground">Account: {booking.studentName}</p>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-wrap justify-end gap-1">
                        <Badge variant={bookingStatusVariant(booking.bookingStatus)}>{booking.bookingStatus}</Badge>
                        <Badge variant={paymentStatusVariant(booking.paymentStatus)}>{booking.paymentStatus}</Badge>
                      </div>
                    </div>
                    <div className="mt-1.5">
                      {booking.attendanceStatus == null ? (
                        <span className="text-xs text-muted-foreground">Not checked in</span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          <Badge variant={attendanceStatusVariant(booking.attendanceStatus)}>
                            {attendanceStatusLabel(booking.attendanceStatus)}
                          </Badge>
                          {booking.checkedInAt && (
                            <span className="text-muted-foreground">{format(parseISO(booking.checkedInAt), "MMM d, h:mm a")}</span>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <SheetFooter className="mt-auto flex flex-col gap-2 border-t px-5 py-4 sm:flex-row sm:justify-end">
          {can("attendance", "view") && (
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              data-testid="button-occurrence-sheet-open-attendance"
              onClick={() => navigate(`/attendance?scheduleId=${occurrence.scheduleId}&date=${occurrence.occurrenceDate}`)}
            >
              Open Attendance
            </Button>
          )}
          {can("bookings", "view") && (
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              data-testid="button-occurrence-sheet-view-bookings"
              onClick={() => navigate(`/bookings?scheduleId=${occurrence.scheduleId}&date=${occurrence.occurrenceDate}`)}
            >
              View Bookings
            </Button>
          )}
          <Button className="w-full sm:w-auto" data-testid="button-occurrence-sheet-edit" onClick={handleEditClick}>
            Edit Schedule
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
