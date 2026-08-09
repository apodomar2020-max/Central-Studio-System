import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Layers, Clock3, UserCheck, Users2, CalendarCheck, History } from "lucide-react";
import type { ApplicationDetailTabPanelsProps } from "./types";
import { ATTENDANCE_STATUSES, DAY_NAMES, Field, GridRow, Section } from "./shared";

export function EnrollmentTab(props: ApplicationDetailTabPanelsProps) {
  const { app, level, group, canActivateApplication, statusMutation, statusNote, setStatusNote, data, activeSchedules, canCheckIn, attendanceSummary, attendanceHistoryData, editingAttendanceId, setEditingAttendanceId, editStatus, setEditStatus, editNote, setEditNote, patchAttendanceMutation, startEditAttendance, attScheduleId, setAttScheduleId, attDate, setAttDate, attStatus, setAttStatus, attNote, setAttNote, attendanceMutation, canApprove, levels, newLevelId, setNewLevelId, levelNote, setLevelNote, levelMutation, groups, newGroupId, setNewGroupId, groupNote, setGroupNote, groupMutation, levelAssigned, groupAssigned, isApplicationTerminal, canAssignLevel, canAssignGroup } = props;

  const safeLevels = levels ?? [];
  const safeGroups = groups ?? [];
  const safeSchedules = activeSchedules ?? [];
  const safeHistory = attendanceHistoryData?.history ?? [];

  const hasAssignedLevelSection = Boolean(level || app.assignedLevelId);
  const hasAttendanceSummarySection = app.assignedLevelId != null;
  const hasLevelSection = canApprove && !isApplicationTerminal && safeLevels.length > 0;
  const hasGroupSection = canApprove && !isApplicationTerminal;
  const hasMarkAttendanceSection = canCheckIn && data?.assignmentId != null && safeSchedules.length > 0;
  const hasAttendanceHistorySection = canCheckIn && data?.assignmentId != null;

  return (
<TabsContent value="enrollment" className="space-y-4">

  {/* Assigned Level summary + this month's attendance summary — the two
      "current state" readouts, side by side. Either may be absent
      independently (a fresh assignment has no billing-month data yet, and
      vice versa), so the grid simply leaves an empty cell rather than
      duplicating data to balance it. */}
  {(hasAssignedLevelSection || hasAttendanceSummarySection) && (
    <GridRow>
      {hasAssignedLevelSection && (
        <Section title="Assigned Level" icon={<Layers />}>
          <Field label="Level"       value={level?.name ?? `ID ${app.assignedLevelId}`} />
          <Field label="Group"       value={group?.name} />
          <Field label="Assigned at" value={app.assignedAt ? new Date(app.assignedAt).toLocaleString() : null} />
        </Section>
      )}

      {hasAttendanceSummarySection && (
        <Section title={`Attendance — ${attendanceSummary?.billingMonth ?? "this month"}`} icon={<Clock3 />}>
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
    </GridRow>
  )}

  {!isApplicationTerminal && canActivateApplication && (
    <Section title="Activation" icon={<UserCheck />}>
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

  {/* Change Level + Change Group — the two assignment forms, side by side.
      Hidden entirely once the application is terminal (rejected/cancelled/
      withdrawn); when non-terminal but not yet eligible by lifecycle (e.g.
      still "pending"), show the prerequisite reason instead of a button
      that would return 422. canAssignLevel/canAssignGroup mirror the
      backend's own allowlists, computed once in the parent so this and
      Overview never disagree. */}
  {(hasLevelSection || hasGroupSection) && (
    <GridRow>
      {hasLevelSection && (
        <Section title={levelAssigned ? "Change Level" : "Assign to Level"} icon={<Layers />}>
          {canAssignLevel ? (
            <>
              <Select value={newLevelId} onValueChange={setNewLevelId}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Select level…" />
                </SelectTrigger>
                <SelectContent>
                  {safeLevels.map((l: any) => (
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
                ) : levelAssigned ? "Change Level" : "Assign Level"}
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Accept the application before assigning a level.</p>
          )}
        </Section>
      )}

      {hasGroupSection && (
        !levelAssigned ? (
          <Section title="Assign to Group" icon={<Users2 />}>
            <p className="text-sm text-muted-foreground">Assign a level first.</p>
          </Section>
        ) : safeGroups.length > 0 ? (
          <Section title={groupAssigned ? "Change Group" : "Assign to Group"} icon={<Users2 />}>
            <Select value={newGroupId} onValueChange={setNewGroupId}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Select group…" />
              </SelectTrigger>
              <SelectContent>
                {safeGroups.map((g: any) => (
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
              disabled={!newGroupId || groupMutation.isPending || !canAssignGroup}
              onClick={() => groupMutation.mutate()}
              style={{ background: "#00B6D6", color: "#000" }}
              className="w-full"
            >
              {groupMutation.isPending ? (
                <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Assigning…</>
              ) : groupAssigned ? "Change Group" : "Assign Group"}
            </Button>
          </Section>
        ) : (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
            No active group in this level currently has a valid Ballet Class. Create the Class and weekly Schedule before assigning a group.
          </div>
        )
      )}
    </GridRow>
  )}

  {/* Mark Attendance + Attendance History — the two attendance-day-to-day
      surfaces, side by side. */}
  {(hasMarkAttendanceSection || hasAttendanceHistorySection) && (
    <GridRow>
      {hasMarkAttendanceSection && (
        <Section title="Mark Attendance" icon={<CalendarCheck />}>
          <Select value={attScheduleId} onValueChange={setAttScheduleId}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder="Select class schedule…" />
            </SelectTrigger>
            <SelectContent>
              {safeSchedules.map((s: any) => (
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
        </Section>
      )}

      {hasAttendanceHistorySection && (
        <Section title="Attendance History" icon={<History />}>
          {safeHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No attendance recorded yet.</p>
          ) : (
            <div className="space-y-2">
              {safeHistory.map((row: any) => (
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
                          onClick={() => patchAttendanceMutation.mutate({ id: row.id, status: editStatus, note: editNote })}
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
        </Section>
      )}
    </GridRow>
  )}

</TabsContent>
  );
}
