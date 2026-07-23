import { Button } from "@/components/ui/button";
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

export function ApplicationTab(props: ApplicationDetailTabPanelsProps) {
  const { app, level, group, currentPayment, currentSubscription, appAcceptedOrAssigned, levelAssigned, groupAssigned, initialPaymentRecorded, pendingInitialPayment, paidInitialPayment, initialPayments, subscriptionReadinessState, paymentDataWarning, nextRequiredAction, setActiveTab, canCreateInitialPayment, openInitialPaymentDialog, canConfirmInitialPayment, openConfirmPaymentDialog, canActivateApplication, statusMutation, statusNote, assessmentSchedule, reviewStatuses, newStatus, setNewStatus, setStatusNote, payments, canAdjustExpiry, canEditPayments, setAdjustExpiryOpen, canViewPayments, navigate, appId, data, activeSchedules, canCheckIn, attendanceSummary, attendanceHistoryData, editingAttendanceId, setEditingAttendanceId, editStatus, setEditStatus, editNote, setEditNote, patchAttendanceMutation, startEditAttendance, attScheduleId, setAttScheduleId, attDate, setAttDate, attStatus, setAttStatus, attNote, setAttNote, attendanceMutation, canApprove, levels, newLevelId, setNewLevelId, levelNote, setLevelNote, levelMutation, groups, newGroupId, setNewGroupId, groupNote, setGroupNote, groupMutation, canCancel, dangerAction, openCancellationRequest, setDangerDialog, setCancelTiming, cancellationRequests, refunds, events } = props;
  return (
<TabsContent value="application" className="space-y-4">

  {/* Parent info */}
  <Section title="Parent / Guardian">
    <Field label="Name"  value={app.parentName} />
    <Field label="Phone" value={app.parentPhone} />
    <Field label="Email" value={app.parentEmail} />
    {app.parentStudentId && (
      <Field label="Student ID" value={`#${app.parentStudentId}`} />
    )}
  </Section>

  {/* Emergency contact */}
  {(app.emergencyContactName || app.emergencyContactPhone) && (
    <Section title="Emergency Contact">
      <Field label="Name"  value={app.emergencyContactName} />
      <Field label="Phone" value={app.emergencyContactPhone} />
    </Section>
  )}

  {/* Child info */}
  <Section title="Child Information">
    <Field label="Name"     value={app.childName} />
    <Field label="Birthday" value={app.childBirthday} />
    <Field label="Age"      value={app.childAge !== null ? `${app.childAge} years` : null} />
    <Field label="Gender"   value={app.childGender} />
    {app.childId !== null && (
      <Field label="Linked Child Profile" value={`#${app.childId}`} />
    )}
  </Section>

  {/* Experience */}
  <Section title="Dance Experience">
    <Field
      label="Previous experience"
      value={app.previousExperience ? "Yes" : "No"}
    />
    {app.experienceDetails && (
      <Field label="Details" value={app.experienceDetails} />
    )}
  </Section>

  {/* Medical */}
  {app.medicalNotes && (
    <Section title="Medical Notes">
      <p className="text-sm text-foreground whitespace-pre-wrap">{app.medicalNotes}</p>
    </Section>
  )}

  {/* Notes from parent */}
  {app.notes && (
    <Section title="Additional Notes (from parent)">
      <p className="text-sm text-foreground whitespace-pre-wrap">{app.notes}</p>
    </Section>
  )}

  {/* Assessment */}
  <Section title="Assessment">
    {assessmentSchedule ? (
      <>
        <Field label="Class" value={assessmentSchedule.classTitle} />
        <Field label="Level" value={assessmentSchedule.levelName} />
        <Field label="Schedule" value={`${DAY_NAMES[assessmentSchedule.dayOfWeek] ?? assessmentSchedule.dayOfWeek} ${assessmentSchedule.startTime} – ${assessmentSchedule.endTime}`} />
        <Field label="Selected date" value={app.assessmentDate} />
        {assessmentSchedule.instructorName && (
          <Field label="Instructor" value={assessmentSchedule.instructorName} />
        )}
      </>
    ) : (
      <p className="text-sm text-muted-foreground italic">
        No assessment schedule selected
      </p>
    )}
  </Section>

  {reviewStatuses.length > 0 && (
    <Section title="Application Status Update">
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <StatusBadge status={app.status} />
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">new status</span>
        </div>
        <Select value={newStatus} onValueChange={setNewStatus}>
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder="Select review status…" />
          </SelectTrigger>
          <SelectContent>
            {reviewStatuses.filter((s: any) => s.value !== app.status).map((s: any) => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Textarea
          className="text-sm min-h-[64px] resize-none"
          placeholder="Note (optional)"
          value={statusNote}
          onChange={(e) => setStatusNote(e.target.value)}
        />
        <Button
          size="sm"
          disabled={!newStatus || statusMutation.isPending}
          onClick={() => statusMutation.mutate(undefined)}
          style={{ background: "#00B6D6", color: "#000" }}
        >
          {statusMutation.isPending ? (
            <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Saving…</>
          ) : "Update Status"}
        </Button>
      </div>
    </Section>
  )}

  <Section title="Preferred Payment Intake">
    <div className="grid gap-3 sm:grid-cols-2">
      <Field
        label="Preferred package"
        value={
          app.preferredPackageName
            ? `${app.preferredPackageName}${app.preferredPackageId ? ` (#${app.preferredPackageId})` : ""}`
            : "No preferred package selected (legacy application)"
        }
      />
      <Field label="Preferred payment method" value={formatPaymentMethod(app.preferredPaymentMethod)} />
    </div>
  </Section>

  <Section title="Metadata">
    <Field label="Application ID" value={`#${app.id}`} />
    <Field label="Submitted" value={new Date(app.createdAt).toLocaleString()} />
    <Field label="Last updated" value={new Date(app.updatedAt).toLocaleString()} />
  </Section>
</TabsContent>
  );
}
