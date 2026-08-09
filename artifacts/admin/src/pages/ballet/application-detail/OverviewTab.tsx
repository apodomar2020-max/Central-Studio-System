import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import { AlertTriangle, Loader2, LayoutGrid, ListChecks, ArrowRightCircle, Receipt } from "lucide-react";
import type { ApplicationDetailTabPanelsProps } from "./types";
import { AssessmentFeeStatusBadge, Field, formatDateTime, formatPaymentMethod, PaymentStatusBadge, ReadinessItem, Section, StatusBadge, SubscriptionBadge, SummaryCard } from "./shared";

// Terminal-status banner copy (Phase 2). Kept local to Overview — the
// Danger Zone (CancellationRefundsTab) already has its own minimal terminal
// message and doesn't need to match this wording verbatim.
const TERMINAL_STATUS_COPY: Record<string, { title: string; body: string }> = {
  rejected: {
    title: "This application was rejected",
    body: "The application review ended in rejection. Progression actions (status review, level/group assignment, payments, activation) are no longer available. Application details, history, and payment records remain visible below.",
  },
  cancelled: {
    title: "This application was cancelled",
    body: "The application (or its enrollment) was cancelled. Progression actions are no longer available. Payment and refund records remain visible below for reconciliation.",
  },
  withdrawn: {
    title: "This application was withdrawn",
    body: "The enrollment was withdrawn. Progression actions are no longer available. History and payment records remain visible below.",
  },
};

export function OverviewTab(props: ApplicationDetailTabPanelsProps) {
  const { app, level, group, currentPayment, currentSubscription, appAcceptedOrAssigned, levelAssigned, groupAssigned, initialPaymentRecorded, pendingInitialPayment, paidInitialPayment, subscriptionReadinessState, paymentDataWarning, subscriptionExpiredWarning, nextRequiredAction, setActiveTab, canCreateInitialPayment, openInitialPaymentDialog, canConfirmInitialPayment, openConfirmPaymentDialog, canActivateApplication, statusMutation, statusNote, canViewPayments, navigate, appId, isApplicationTerminal, applicationStatus, canAssignLevel, canAssignGroup, openAssignLevelDialog, openAssignGroupDialog, openStatusDecisionDialog, canAdjustExpiry, setAdjustExpiryOpen, reviewStatuses, assessmentFee, openRecordAssessmentFeeDialog } = props;
  const terminalCopy = TERMINAL_STATUS_COPY[app.status as string];
  const assessmentFeeAmount = assessmentFee?.status === "waived"
    ? "Waived / No charge"
    : assessmentFee?.amountEgp != null && assessmentFee.amountEgp > 0
      ? `${assessmentFee.amountEgp.toLocaleString()} EGP`
      : "Amount not recorded";
  return (
<TabsContent value="overview" className="space-y-4">
  {isApplicationTerminal && (
    <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3.5">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
      <div className="min-w-0 space-y-0.5">
        <div className="text-sm font-semibold text-red-300">{terminalCopy?.title ?? "This application is closed"}</div>
        <p className="text-sm text-red-200/80">
          {terminalCopy?.body ?? "Progression actions are no longer available. Application, payment, and cancellation history below remain fully visible."}
        </p>
      </div>
    </div>
  )}

  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
    <SummaryCard label="Application Status" value={<StatusBadge status={app.status} />} sub={`Updated ${new Date(app.updatedAt).toLocaleDateString()}`} />
    <SummaryCard label="Assigned Level" value={level?.name ?? "Not assigned"} sub={group?.name ? `Group: ${group.name}` : "No group yet"} />
    <SummaryCard label="Payment Status" value={<PaymentStatusBadge status={currentPayment?.status} />} sub={currentPayment ? (currentPayment.amountEgp == null ? "Restricted" : `${currentPayment.amountEgp} EGP`) : "No payment recorded"} />
    <SummaryCard label="Subscription" value={<SubscriptionBadge payment={currentSubscription} />} sub={currentSubscription?.subscriptionExpiresAt ? `Expires ${currentSubscription.subscriptionExpiresAt}` : "No active period"} />
  </div>

  <Section title="Operational Snapshot" icon={<LayoutGrid />}>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Assessment date" value={app.assessmentDate} />
      <Field label="Assessment Fee" value={<AssessmentFeeStatusBadge status={assessmentFee?.status} />} />
      <Field label="Assigned level" value={level?.name ?? (app.assignedLevelId ? `#${app.assignedLevelId}` : null)} />
      <Field label="Assigned group" value={group?.name} />
      <Field label="Current package" value={currentSubscription?.packageName ?? currentPayment?.packageName ?? app.preferredPackageName} />
      <Field label="Submitted" value={formatDateTime(app.createdAt)} />
      <Field label="Last update" value={formatDateTime(app.updatedAt)} />
    </div>
  </Section>

  <Section title="Assessment Fee" icon={<Receipt />}>
    <div>
      <p className="text-sm font-medium text-foreground">One-time Ballet assessment intake fee</p>
      <p className="text-xs text-muted-foreground">Tracked separately from package and subscription payments.</p>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Fee Status" value={<AssessmentFeeStatusBadge status={assessmentFee?.status} />} />
      <Field label="Amount" value={assessmentFeeAmount} />
      <Field label="Payment Method" value={formatPaymentMethod(assessmentFee?.paymentMethod) ?? "Not recorded"} />
      <Field label="Recorded Date" value={formatDateTime(assessmentFee?.paidAt)} />
    </div>
    {openRecordAssessmentFeeDialog && !isApplicationTerminal && (
      <div className="pt-1">
        <Button variant="outline" size="sm" onClick={openRecordAssessmentFeeDialog}>
          Record / Update Assessment Fee
        </Button>
      </div>
    )}
  </Section>

  {/* Six operational areas (Phase 2) — same readiness data the old
      read-only checklist showed, now each with the action that resolves it
      when one is currently valid, or an explanatory prerequisite otherwise.
      Every action below reuses the EXACT mutation/dialog already owned by
      ApplicationDetailPage — no second implementation, no second audit
      path. Terminal applications get no action content at all (the banner
      above already explains why). */}
  <Section title="Operational Actions" icon={<ListChecks />}>
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
      <ReadinessItem
        label="Application Status"
        state={appAcceptedOrAssigned ? "complete" : "missing"}
        detail={<StatusBadge status={applicationStatus} />}
        action={
          isApplicationTerminal ? undefined
          : canActivateApplication ? (
            <Button
              size="sm"
              onClick={() => statusMutation.mutate({ status: "active", note: statusNote || undefined })}
              disabled={statusMutation.isPending}
            >
              {statusMutation.isPending ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Activating…</> : "Activate Application"}
            </Button>
          ) : reviewStatuses.length > 0 ? (
            <Button size="sm" variant="outline" onClick={openStatusDecisionDialog}>Review Application</Button>
          ) : undefined
        }
      />
      <ReadinessItem
        label="Level Assignment"
        state={levelAssigned ? "complete" : "missing"}
        detail={level?.name ?? (app.assignedLevelId ? `#${app.assignedLevelId}` : "Not assigned yet")}
        action={
          isApplicationTerminal ? undefined
          : canAssignLevel ? (
            <Button size="sm" variant="outline" onClick={openAssignLevelDialog}>{levelAssigned ? "Change Level" : "Assign Level"}</Button>
          ) : (
            <p className="text-xs text-muted-foreground">Accept the application before assigning a level.</p>
          )
        }
      />
      <ReadinessItem
        label="Group Assignment"
        state={groupAssigned ? "complete" : "missing"}
        detail={group?.name ?? "Not assigned yet"}
        action={
          isApplicationTerminal ? undefined
          : !levelAssigned ? (
            <p className="text-xs text-muted-foreground">Assign a level first.</p>
          ) : canAssignGroup ? (
            <Button size="sm" variant="outline" onClick={openAssignGroupDialog}>{groupAssigned ? "Change Group" : "Assign Group"}</Button>
          ) : (
            <p className="text-xs text-muted-foreground">No active group available for this level yet.</p>
          )
        }
      />
      <ReadinessItem
        label="Initial Payment"
        state={initialPaymentRecorded ? "complete" : "missing"}
        detail={pendingInitialPayment ? `Pending payment #${pendingInitialPayment.id}` : paidInitialPayment ? `Paid payment #${paidInitialPayment.id}` : "Not created yet"}
        action={
          isApplicationTerminal || initialPaymentRecorded ? undefined
          : canCreateInitialPayment ? (
            <Button size="sm" variant="outline" onClick={openInitialPaymentDialog}>Create Initial Payment</Button>
          ) : (
            <p className="text-xs text-muted-foreground">Accept the application (and assign a level) before creating a payment.</p>
          )
        }
      />
      <ReadinessItem
        label="Payment Confirmation"
        state={paidInitialPayment ? "complete" : pendingInitialPayment ? "pending" : "missing"}
        detail={paidInitialPayment?.paidAt ? `Paid ${new Date(paidInitialPayment.paidAt).toLocaleString()}` : pendingInitialPayment ? "Confirm after Pay at Studio collection." : "No pending payment"}
        action={
          isApplicationTerminal ? undefined
          : canConfirmInitialPayment && pendingInitialPayment ? (
            <Button size="sm" variant="outline" onClick={() => openConfirmPaymentDialog(pendingInitialPayment)}>Confirm Payment</Button>
          ) : paymentDataWarning ? (
            <p className="text-xs text-amber-300">{paymentDataWarning}</p>
          ) : undefined
        }
      />
      <ReadinessItem
        label="Subscription"
        state={subscriptionReadinessState}
        detail={paymentDataWarning ?? subscriptionExpiredWarning ?? (currentSubscription?.subscriptionExpiresAt ? `Expires ${currentSubscription.subscriptionExpiresAt}` : "Confirm payment to establish dates.")}
        action={
          isApplicationTerminal ? undefined
          : canAdjustExpiry ? (
            <Button size="sm" variant="outline" onClick={() => setAdjustExpiryOpen(true)}>Adjust Expiry</Button>
          ) : subscriptionExpiredWarning && canViewPayments ? (
            <Button size="sm" variant="outline" onClick={() => navigate(`/ballet/payments?applicationId=${appId}`)}>Open Payment History</Button>
          ) : undefined
        }
      />
    </div>
  </Section>

  <Section title="Next Required Action" icon={<ArrowRightCircle />}>
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="text-base font-semibold text-foreground">{nextRequiredAction}</div>
        <p className="text-sm text-muted-foreground">Derived from the current application, assignment, payment, and subscription state.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {nextRequiredAction === "Review Application" && (
          <Button size="sm" variant="outline" onClick={openStatusDecisionDialog}>Review Application</Button>
        )}
        {(nextRequiredAction === "Assign Level" || nextRequiredAction === "Assign Group") && (
          <Button
            size="sm"
            variant="outline"
            onClick={nextRequiredAction === "Assign Level" ? openAssignLevelDialog : openAssignGroupDialog}
          >
            {nextRequiredAction === "Assign Level" ? "Assign Level" : "Assign Group"}
          </Button>
        )}
        {nextRequiredAction === "Create Initial Payment" && canCreateInitialPayment && (
          <Button size="sm" variant="outline" onClick={openInitialPaymentDialog}>Create Initial Payment</Button>
        )}
        {nextRequiredAction === "Confirm Payment" && pendingInitialPayment && canConfirmInitialPayment && (
          <Button size="sm" variant="outline" onClick={() => openConfirmPaymentDialog(pendingInitialPayment)}>Confirm Payment</Button>
        )}
        {nextRequiredAction === "Payment data requires review" && paymentDataWarning && (
          <p className="max-w-xl rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
            {paymentDataWarning}
          </p>
        )}
        {nextRequiredAction === "Subscription expired — renewal required" && (
          <>
            <p className="max-w-xl rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {subscriptionExpiredWarning}
            </p>
            {canViewPayments && (
              <Button size="sm" variant="outline" onClick={() => navigate(`/ballet/payments?applicationId=${appId}`)}>
                Open Payment History
              </Button>
            )}
          </>
        )}
        {nextRequiredAction === "Activate Application" && canActivateApplication && (
          <Button size="sm" onClick={() => statusMutation.mutate({ status: "active", note: statusNote || undefined })} disabled={statusMutation.isPending}>
            {statusMutation.isPending ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Activating…</> : "Activate Application"}
          </Button>
        )}
      </div>
    </div>
  </Section>
</TabsContent>
  );
}
