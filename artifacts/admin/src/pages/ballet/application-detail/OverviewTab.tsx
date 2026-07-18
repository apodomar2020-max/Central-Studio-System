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
import { ActivationReadiness, Field, formatDateTime, PaymentStatusBadge, Section, StatusBadge, SubscriptionBadge, SummaryCard } from "./shared";

export function OverviewTab(props: ApplicationDetailTabPanelsProps) {
  const { app, level, group, currentPayment, currentSubscription, appAcceptedOrAssigned, levelAssigned, groupAssigned, initialPaymentRecorded, pendingInitialPayment, paidInitialPayment, subscriptionReadinessState, paymentDataWarning, subscriptionExpiredWarning, nextRequiredAction, setActiveTab, canCreateInitialPayment, openInitialPaymentDialog, canConfirmInitialPayment, openConfirmPaymentDialog, canActivateApplication, statusMutation, statusNote, canViewPayments, navigate, appId } = props;
  return (
<TabsContent value="overview" className="space-y-4">
  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
    <SummaryCard label="Application Status" value={<StatusBadge status={app.status} />} sub={`Updated ${new Date(app.updatedAt).toLocaleDateString()}`} />
    <SummaryCard label="Assigned Level" value={level?.name ?? "Not assigned"} sub={group?.name ? `Group: ${group.name}` : "No group yet"} />
    <SummaryCard label="Payment Status" value={<PaymentStatusBadge status={currentPayment?.status} />} sub={currentPayment ? `${currentPayment.amountEgp} EGP` : "No payment recorded"} />
    <SummaryCard label="Subscription" value={<SubscriptionBadge payment={currentSubscription} />} sub={currentSubscription?.subscriptionExpiresAt ? `Expires ${currentSubscription.subscriptionExpiresAt}` : "No active period"} />
  </div>
  <Section title="Operational Snapshot">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Assessment date" value={app.assessmentDate} />
      <Field label="Assigned level" value={level?.name ?? (app.assignedLevelId ? `#${app.assignedLevelId}` : null)} />
      <Field label="Assigned group" value={group?.name} />
      <Field label="Current package" value={currentSubscription?.packageName ?? currentPayment?.packageName ?? app.preferredPackageName} />
      <Field label="Submitted" value={formatDateTime(app.createdAt)} />
      <Field label="Last update" value={formatDateTime(app.updatedAt)} />
    </div>
  </Section>
  <Section title="Activation Readiness">
    <ActivationReadiness
      applicationStatus={app.status}
      appAcceptedOrAssigned={appAcceptedOrAssigned}
      levelAssigned={levelAssigned}
      levelName={level?.name}
      groupAssigned={groupAssigned}
      groupName={group?.name}
      initialPaymentRecorded={initialPaymentRecorded}
      pendingInitialPayment={pendingInitialPayment}
      paidInitialPayment={paidInitialPayment}
      subscriptionReadinessState={subscriptionReadinessState}
      paymentDataWarning={paymentDataWarning}
      subscriptionExpiredWarning={subscriptionExpiredWarning}
      currentSubscription={currentSubscription}
    />
  </Section>
  <Section title="Next Required Action">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="text-base font-semibold text-foreground">{nextRequiredAction}</div>
        <p className="text-sm text-muted-foreground">Derived from the current application, assignment, payment, and subscription state.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {nextRequiredAction === "Review Application" && (
          <Button size="sm" variant="outline" onClick={() => setActiveTab("application")}>Go to Application</Button>
        )}
        {nextRequiredAction === "Assign Level" || nextRequiredAction === "Assign Group" ? (
          <Button size="sm" variant="outline" onClick={() => setActiveTab("enrollment")}>Go to Enrollment</Button>
        ) : null}
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
