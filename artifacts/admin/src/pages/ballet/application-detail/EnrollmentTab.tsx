import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRight, AlertTriangle, Clock, Loader2, User } from "lucide-react";
import {
  BALLET_CANCELLATION_INITIATOR_LABELS,
  type BalletCancellationInitiatorType,
} from "@workspace/api-zod";
import type { ApplicationDetailTabPanelsProps } from "./types";
import { ATTENDANCE_STATUSES, DAY_NAMES, Field, formatDateTime, formatPaymentMethod, PaymentStatusBadge, Section, StatusBadge, SubscriptionBadge } from "./shared";

export function EnrollmentTab(props: ApplicationDetailTabPanelsProps) {
  const { app, level, group, currentPayment, currentSubscription, appAcceptedOrAssigned, levelAssigned, groupAssigned, initialPaymentRecorded, pendingInitialPayment, paidInitialPayment, initialPayments, subscriptionReadinessState, paymentDataWarning, nextRequiredAction, setActiveTab, canCreateInitialPayment, openInitialPaymentDialog, canConfirmInitialPayment, openConfirmPaymentDialog, canActivateApplication, statusMutation, statusNote, assessmentSchedule, reviewStatuses, newStatus, setNewStatus, setStatusNote, payments, canAdjustExpiry, canEditPayments, setAdjustExpiryOpen, canViewPayments, navigate, appId, data, activeSchedules, canCheckIn, attendanceSummary, attendanceHistoryData, editingAttendanceId, setEditingAttendanceId, editStatus, setEditStatus, editDuration, setEditDuration, editNote, setEditNote, patchAttendanceMutation, startEditAttendance, attScheduleId, setAttScheduleId, attDate, setAttDate, attStatus, setAttStatus, attDuration, setAttDuration, attNote, setAttNote, attendanceMutation, canApprove, levels, newLevelId, setNewLevelId, levelNote, setLevelNote, levelMutation, groups, newGroupId, setNewGroupId, groupNote, setGroupNote, groupMutation, canCancel, dangerAction, openCancellationRequest, setDangerDialog, setCancelTiming, cancellationRequests, refunds, events } = props;
  return (
<TabsContent value="enrollment" className="space-y-4">

  {/* Assigned level (if any) */}
  {(level || app.assignedLevelId) && (
    <Section title="Assigned Level">
      <Field label="Level"       value={level?.name ?? `ID ${app.assignedLevelId}`} />
      <Field label="Group"       value={group?.name} />
      <Field label="Assigned at" value={app.assignedAt ? new Date(app.assignedAt).toLocaleString() : null} />
    </Section>
  )}

  {/* Attendance hours — this month (C4). Only meaningful once a level
      is assigned; the backend returns null otherwise. */}
  {app.assignedLevelId != null && (
    <Section title={`Attendance — ${attendanceSummary?.billingMonth ?? "this month"}`}>
      {attendanceSummary && attendanceSummary.hasActiveSubscription ? (
        <>
          <Field label="Monthly hours"  value={`${attendanceSummary.monthlyHours}h`} />
          <Field label="Attended"        value={`${attendanceSummary.attendedHours}h`} />
          <Field label="Absent"          value={`${attendanceSummary.absentHours}h`} />
          <Field label="Consumed"        value={`${attendanceSummary.consumedHours}h`} />
          <Field label="Remaining"       value={`${attendanceSummary.remainingHours}h`} />
        </>
      ) : attendanceSummary ? (
        <>
          <p className="text-sm text-muted-foreground italic">
            No active monthly subscription for {attendanceSummary.billingMonth}.
          </p>
          {/* Attendance facts still shown even without a subscription. */}
          <Field label="Attended" value={`${attendanceSummary.attendedHours}h`} />
          <Field label="Absent"   value={`${attendanceSummary.absentHours}h`} />
        </>
      ) : (
        <p className="text-sm text-muted-foreground italic">No attendance data.</p>
      )}
    </Section>
  )}

  {canActivateApplication && (
    <Section title="Activation">
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Activation remains explicit and uses the existing backend gate: level, group, and an active paid subscription period must already be valid.
        </p>
        <Textarea
          className="text-sm min-h-[56px] resize-none"
          placeholder="Activation note (optional)"
          value={statusNote}
          onChange={(e) => setStatusNote(e.target.value)}
        />
        <Button
          size="sm"
          disabled={statusMutation.isPending}
          onClick={() => statusMutation.mutate({ status: "active", note: statusNote || undefined })}
          style={{ background: "#00B6D6", color: "#000" }}
        >
          {statusMutation.isPending ? (
            <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Activating…</>
          ) : "Activate Application"}
        </Button>
      </div>
    </Section>
  )}

  {/* Level assignment */}
  {canApprove && levels.length > 0 && (
    <div className="rounded-lg border bg-card p-5 space-y-4">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Assign to Level
      </h3>
      <Select value={newLevelId} onValueChange={setNewLevelId}>
        <SelectTrigger className="h-8 text-sm">
          <SelectValue placeholder="Select level…" />
        </SelectTrigger>
        <SelectContent>
          {levels.map((l: any) => (
            <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Textarea
        className="text-sm min-h-[64px] resize-none"
        placeholder="Note (optional)"
        value={levelNote}
        onChange={(e) => setLevelNote(e.target.value)}
      />
      <Button
        size="sm"
        disabled={!newLevelId || levelMutation.isPending}
        onClick={() => levelMutation.mutate()}
        style={{ background: "#00B6D6", color: "#000" }}
        className="w-full"
      >
        {levelMutation.isPending ? (
          <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Assigning…</>
        ) : "Assign Level"}
      </Button>
    </div>
  )}

  {/* Group assignment — only once a level is assigned; supports
      reassignment the same way the level section does. */}
  {canApprove && app.assignedLevelId != null && groups.length > 0 && (
    <div className="rounded-lg border bg-card p-5 space-y-4">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Assign to Group
      </h3>
      <Select value={newGroupId} onValueChange={setNewGroupId}>
        <SelectTrigger className="h-8 text-sm">
          <SelectValue placeholder="Select group…" />
        </SelectTrigger>
        <SelectContent>
          {groups.map((g: any) => (
            <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Textarea
        className="text-sm min-h-[64px] resize-none"
        placeholder="Note (optional)"
        value={groupNote}
        onChange={(e) => setGroupNote(e.target.value)}
      />
      <Button
        size="sm"
        disabled={!newGroupId || groupMutation.isPending}
        onClick={() => groupMutation.mutate()}
        style={{ background: "#00B6D6", color: "#000" }}
        className="w-full"
      >
        {groupMutation.isPending ? (
          <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Assigning…</>
        ) : "Assign Group"}
      </Button>
    </div>
  )}
  {canApprove && app.assignedLevelId != null && groups.length === 0 && (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
      No active group in this level currently has a valid Ballet Class. Create the Class and weekly Schedule before assigning a group.
    </div>
  )}

  {/* Mark attendance (C3) — minimal admin-recorded path. Shown only when
      this student has an active level assignment with a group that has
      schedules, and the admin holds attendance:checkIn. The schedule
      picker is scoped to the group's own schedules (what the endpoint
      will accept). */}
  {canCheckIn && data.assignmentId != null && activeSchedules.length > 0 && (
    <div className="rounded-lg border bg-card p-5 space-y-4">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Mark Attendance
      </h3>
      <Select value={attScheduleId} onValueChange={setAttScheduleId}>
        <SelectTrigger className="h-8 text-sm">
          <SelectValue placeholder="Select class schedule…" />
        </SelectTrigger>
        <SelectContent>
          {activeSchedules.map((s: any) => (
            <SelectItem key={s.id} value={String(s.id)}>
              {DAY_NAMES[s.dayOfWeek] ?? "?"} {s.startTime}–{s.endTime}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <input
        type="date"
        className="w-full h-8 rounded-md border bg-background px-2 text-sm"
        value={attDate}
        onChange={(e) => setAttDate(e.target.value)}
      />
      <Select value={attStatus} onValueChange={setAttStatus}>
        <SelectTrigger className="h-8 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ATTENDANCE_STATUSES.map((s: any) => (
            <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {/* D1: optional — defaults server-side to the schedule's own duration. */}
      <input
        type="number"
        min={0}
        className="w-full h-8 rounded-md border bg-background px-2 text-sm"
        placeholder="Duration in minutes (optional — defaults to schedule length)"
        value={attDuration}
        onChange={(e) => setAttDuration(e.target.value)}
      />
      <Textarea
        className="text-sm min-h-[56px] resize-none"
        placeholder="Note (optional)"
        value={attNote}
        onChange={(e) => setAttNote(e.target.value)}
      />
      <Button
        size="sm"
        disabled={!attScheduleId || !attDate || attendanceMutation.isPending}
        onClick={() => attendanceMutation.mutate()}
        style={{ background: "#00B6D6", color: "#000" }}
        className="w-full"
      >
        {attendanceMutation.isPending ? (
          <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Recording…</>
        ) : "Record Attendance"}
      </Button>
    </div>
  )}

  {/* Attendance history + correction (D1) — shown alongside Mark
      Attendance whenever this student has an active level assignment. */}
  {canCheckIn && data.assignmentId != null && (
    <div className="rounded-lg border bg-card p-5 space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Attendance History
      </h3>
      {!attendanceHistoryData || attendanceHistoryData.history.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No attendance recorded yet.</p>
      ) : (
        <div className="space-y-2">
          {attendanceHistoryData.history.map((row: any) => (
            <div key={row.id} className="rounded-md border p-3 text-sm space-y-2">
              {editingAttendanceId === row.id ? (
                <>
                  <Select value={editStatus} onValueChange={setEditStatus}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ATTENDANCE_STATUSES.map((s: any) => (
                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <input
                    type="number"
                    min={0}
                    className="w-full h-8 rounded-md border bg-background px-2 text-sm"
                    placeholder="Duration in minutes"
                    value={editDuration}
                    onChange={(e) => setEditDuration(e.target.value)}
                  />
                  <Textarea
                    className="text-sm min-h-[48px] resize-none"
                    placeholder="Note (optional)"
                    value={editNote}
                    onChange={(e) => setEditNote(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={patchAttendanceMutation.isPending}
                      onClick={() => patchAttendanceMutation.mutate({ id: row.id, status: editStatus, durationMinutes: editDuration, note: editNote })}
                      style={{ background: "#00B6D6", color: "#000" }}
                    >
                      {patchAttendanceMutation.isPending ? (
                        <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Saving…</>
                      ) : "Save Correction"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingAttendanceId(null)}>
                      Cancel
                    </Button>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{row.classDate ?? "—"}</span>
                      <Badge variant="outline" className="text-xs">
                        {ATTENDANCE_STATUSES.find((s) => s.value === row.status)?.label ?? row.status}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {row.durationMinutes != null ? `${row.durationMinutes} min` : "no duration"}
                      </span>
                    </div>
                    {row.notes && <p className="mt-1 text-xs text-muted-foreground">{row.notes}</p>}
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => startEditAttendance(row)}>
                    Correct
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )}

</TabsContent>
  );
}
