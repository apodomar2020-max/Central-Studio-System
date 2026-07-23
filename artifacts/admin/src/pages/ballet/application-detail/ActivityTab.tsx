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

export function ActivityTab(props: ApplicationDetailTabPanelsProps) {
  const { app, level, group, currentPayment, currentSubscription, appAcceptedOrAssigned, levelAssigned, groupAssigned, initialPaymentRecorded, pendingInitialPayment, paidInitialPayment, initialPayments, subscriptionReadinessState, paymentDataWarning, nextRequiredAction, setActiveTab, canCreateInitialPayment, openInitialPaymentDialog, canConfirmInitialPayment, openConfirmPaymentDialog, canActivateApplication, statusMutation, statusNote, assessmentSchedule, reviewStatuses, newStatus, setNewStatus, setStatusNote, payments, canAdjustExpiry, canEditPayments, setAdjustExpiryOpen, canViewPayments, navigate, appId, data, activeSchedules, canCheckIn, attendanceSummary, attendanceHistoryData, editingAttendanceId, setEditingAttendanceId, editStatus, setEditStatus, editNote, setEditNote, patchAttendanceMutation, startEditAttendance, attScheduleId, setAttScheduleId, attDate, setAttDate, attStatus, setAttStatus, attNote, setAttNote, attendanceMutation, canApprove, levels, newLevelId, setNewLevelId, levelNote, setLevelNote, levelMutation, groups, newGroupId, setNewGroupId, groupNote, setGroupNote, groupMutation, canCancel, dangerAction, openCancellationRequest, setDangerDialog, setCancelTiming, cancellationRequests, refunds, events } = props;
  return (
<TabsContent value="activity" className="space-y-4">
  <Section title="Event History">
    {events.length === 0 ? (
      <p className="text-sm text-muted-foreground italic">No events yet.</p>
    ) : (
      <div className="relative space-y-4">
        <div className="absolute left-3 top-2 bottom-2 w-px bg-border" aria-hidden />
        {events.map((ev: any) => (
          <div key={ev.id} className="flex gap-3 pl-7 relative">
            <div
              className="absolute left-1.5 top-1.5 h-3 w-3 rounded-full border-2 border-background"
              style={{ background: "#00B6D6" }}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                {ev.fromStatus ? (
                  <>
                    <StatusBadge status={ev.fromStatus} />
                    <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                  </>
                ) : null}
                <StatusBadge status={ev.toStatus} />
              </div>
              {ev.note && (
                <p className="mt-1 text-xs text-muted-foreground">{ev.note}</p>
              )}
              <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground/60">
                <Clock className="h-2.5 w-2.5" />
                {new Date(ev.createdAt).toLocaleString()}
                {ev.changedByFullName && (
                  <>
                    <User className="h-2.5 w-2.5" />
                    {ev.changedByFullName}
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    )}
  </Section>

  <Section title="Payment / Subscription Activity">
    {payments.length === 0 ? (
      <p className="text-sm text-muted-foreground italic">No payment lifecycle events returned by this detail API.</p>
    ) : (
      <div className="space-y-2">
        {payments.map((payment: any) => (
          <div key={`activity-payment-${payment.id}`} className="rounded-md border p-3 text-sm">
            <div className="font-medium">{payment.isRenewal ? "Renewal" : "Initial"} payment #{payment.id}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              {payment.status} · {payment.subscriptionDisplayStatus} · updated {formatDateTime(payment.updatedAt)}
            </p>
            {payment.extensionHistory?.length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                Latest expiry adjustment: {payment.extensionHistory[payment.extensionHistory.length - 1]?.previousExpiresAt} → {payment.extensionHistory[payment.extensionHistory.length - 1]?.newExpiresAt}
              </p>
            )}
          </div>
        ))}
      </div>
    )}
  </Section>
</TabsContent>
  );
}
