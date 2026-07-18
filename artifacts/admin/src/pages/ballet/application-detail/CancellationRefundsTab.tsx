import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

export function CancellationRefundsTab(props: ApplicationDetailTabPanelsProps) {
  const { app, level, group, currentPayment, currentSubscription, appAcceptedOrAssigned, levelAssigned, groupAssigned, initialPaymentRecorded, pendingInitialPayment, paidInitialPayment, initialPayments, subscriptionReadinessState, paymentDataWarning, nextRequiredAction, setActiveTab, canCreateInitialPayment, openInitialPaymentDialog, canConfirmInitialPayment, openConfirmPaymentDialog, canActivateApplication, statusMutation, statusNote, assessmentSchedule, reviewStatuses, newStatus, setNewStatus, setStatusNote, payments, canAdjustExpiry, canEditPayments, setAdjustExpiryOpen, canViewPayments, navigate, appId, data, activeSchedules, canCheckIn, attendanceSummary, attendanceHistoryData, editingAttendanceId, setEditingAttendanceId, editStatus, setEditStatus, editDuration, setEditDuration, editNote, setEditNote, patchAttendanceMutation, startEditAttendance, attScheduleId, setAttScheduleId, attDate, setAttDate, attStatus, setAttStatus, attDuration, setAttDuration, attNote, setAttNote, attendanceMutation, canApprove, levels, newLevelId, setNewLevelId, levelNote, setLevelNote, levelMutation, groups, newGroupId, setNewGroupId, groupNote, setGroupNote, groupMutation, canCancel, dangerAction, openCancellationRequest, setDangerDialog, setCancelTiming, cancellationRequests, refunds, events } = props;
  return (
<TabsContent value="cancellation" className="space-y-4">
  {canCancel && (
    <Card className="border-red-500/40">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm text-red-400">
          <AlertTriangle className="h-4 w-4" /> Danger Zone
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {dangerAction.kind === "cancelApplication" && (
          <>
            <p className="text-sm text-muted-foreground">
              Cancel this pre-activation application. Any assigned level becomes <em>withdrawn</em> (never deleted); attendance and history are preserved.
            </p>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => { setDangerDialog("cancelApplication"); }}
            >
              Cancel Application
            </Button>
          </>
        )}
        {dangerAction.kind === "cancelProgram" && (
          <>
            <p className="text-sm text-muted-foreground">
              Cancel this active enrollment. This creates a cancellation request in the shared workflow (never edits the enrollment rows directly) and writes an audit log.
            </p>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => { setCancelTiming("immediate"); setDangerDialog("cancelProgram"); }}
            >
              Cancel Program
            </Button>
          </>
        )}
        {dangerAction.kind === "viewCancellationRequest" && (
          <>
            <p className="text-sm text-muted-foreground">
              An open cancellation request already exists for this enrollment ({openCancellationRequest?.status}). Manage it from the Cancellation Requests workflow.
            </p>
            <Button variant="outline" size="sm" onClick={() => navigate("/ballet/cancellation-requests")}>
              Manage Cancellation Request
            </Button>
          </>
        )}
        {dangerAction.kind === "none" && (
          <p className="text-sm text-muted-foreground italic">
            No cancellation action is available for an application in status “{app.status}”.
          </p>
        )}
      </CardContent>
    </Card>
  )}

  <Section title="Cancellation & Refunds">
    {cancellationRequests.length === 0 && refunds.length === 0 ? (
      <p className="text-sm text-muted-foreground italic">No cancellation or refund workflow records.</p>
    ) : (
      <div className="space-y-3">
        {cancellationRequests.map((request: any) => (
          <div key={`cancel-${request.id}`} className="rounded-md border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">Cancellation #{request.id}</span>
              <Badge variant="outline">{request.status}</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Requested {request.requestedTiming}
              {request.approvedTiming ? ` · approved ${request.approvedTiming}` : ""}
              {request.approvedEffectiveDate ? ` · effective ${request.approvedEffectiveDate}` : ""}
              {request.requestRefund ? " · refund requested" : ""}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Initiated by: {request.initiatedByType === "admin"
                ? (request.initiatedByAdminName ?? "Admin")
                : (BALLET_CANCELLATION_INITIATOR_LABELS[(request.initiatedByType as BalletCancellationInitiatorType) ?? "parent"] ?? "Parent")}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">{request.reason}</p>
          </div>
        ))}
        {refunds.map((refund: any) => (
          <div key={`refund-${refund.id}`} className="rounded-md border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">Refund #{refund.id} · Payment #{refund.paymentId}</span>
              <Badge variant="outline">{refund.status}</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {refund.refundMethod === "cash" ? "Cash refund" : refund.refundMethod}
              {refund.approvedAmountEgp ? ` · approved ${refund.approvedAmountEgp} EGP` : ""}
              {refund.refundedAmountEgp ? ` · refunded ${refund.refundedAmountEgp} EGP` : ""}
              {refund.transactionReference ? ` · ref ${refund.transactionReference}` : ""}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">{refund.requestedReason}</p>
          </div>
        ))}
      </div>
    )}
  </Section>
</TabsContent>
  );
}
