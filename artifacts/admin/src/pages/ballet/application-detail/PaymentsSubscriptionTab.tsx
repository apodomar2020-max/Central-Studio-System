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

export function PaymentsSubscriptionTab(props: ApplicationDetailTabPanelsProps) {
  const { app, currentPayment, currentSubscription, pendingInitialPayment, initialPayments, paymentDataWarning, subscriptionExpiredWarning, canCreateInitialPayment, openInitialPaymentDialog, canConfirmInitialPayment, openConfirmPaymentDialog, payments, canAdjustExpiry, canEditPayments, setAdjustExpiryOpen, canViewPayments, navigate, appId } = props;
  return (
<TabsContent value="payments" className="space-y-4">
  <Section title="Payment Actions">
    <div className="flex flex-wrap gap-2">
      {canCreateInitialPayment && (
        <Button variant="outline" size="sm" onClick={openInitialPaymentDialog}>
          Create Initial Payment
        </Button>
      )}
      {canConfirmInitialPayment && pendingInitialPayment && (
        <Button variant="outline" size="sm" onClick={() => openConfirmPaymentDialog(pendingInitialPayment)}>
          Confirm Payment
        </Button>
      )}
      {canAdjustExpiry && (
        <Button variant="outline" size="sm" onClick={() => setAdjustExpiryOpen(true)}>
          Adjust Expiry
        </Button>
      )}
      {canViewPayments && (
        <Button variant="outline" size="sm" onClick={() => navigate(`/ballet/payments?applicationId=${appId}`)}>
          Open Full Payment History
        </Button>
      )}
    </div>
    {!canCreateInitialPayment && !canConfirmInitialPayment && !canAdjustExpiry && (
      <p className="text-sm text-muted-foreground">
        No direct payment action is currently available from this application state. Renewal creation remains in Ballet Payments.
      </p>
    )}
    {paymentDataWarning && (
      <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
        {paymentDataWarning}
      </p>
    )}
    {subscriptionExpiredWarning && (
      <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
        {subscriptionExpiredWarning}
      </p>
    )}
    {initialPayments.some((payment: any) => payment.status === "refunded") && (
      <p className="text-xs text-muted-foreground">
        The initial payment on this application is refunded. This refactor does not introduce a replacement-payment workflow.
      </p>
    )}
  </Section>

  <Section title="Payment">
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Current status" value={<PaymentStatusBadge status={currentPayment?.status} />} />
      <Field label="Subscription" value={<SubscriptionBadge payment={currentSubscription} />} />
      <Field label="Amount" value={currentPayment ? `${currentPayment.amountEgp} EGP` : null} />
      <Field
        label="Preferred package"
        value={
          app.preferredPackageName
            ? `${app.preferredPackageName}${app.preferredPackageId ? ` (#${app.preferredPackageId})` : ""}`
            : "No preferred package selected (legacy application)"
        }
      />
      <Field label="Package" value={currentPayment?.packageName ?? (currentPayment?.packageId ? `#${currentPayment.packageId}` : null)} />
      <Field label="Billing month" value={currentPayment?.billingMonth} />
      <Field label="Preferred method" value={formatPaymentMethod(app.preferredPaymentMethod)} />
      <Field label="Recorded method" value={formatPaymentMethod(currentPayment?.paymentMethod)} />
      <Field label="Start date" value={currentSubscription?.subscriptionStartDate} />
      <Field label="Original expiry" value={currentSubscription?.originalExpiresAt} />
      <Field label="Current expiry" value={currentSubscription?.subscriptionExpiresAt} />
      <Field label="Days remaining" value={currentSubscription?.daysRemaining != null ? `${currentSubscription.daysRemaining}` : null} />
      <Field label="Renewal" value={currentSubscription?.isRenewal ? `Renewed from #${currentSubscription.renewedFromId}` : "Initial subscription"} />
      <Field label="Last update" value={currentPayment?.updatedAt ? new Date(currentPayment.updatedAt).toLocaleString() : null} />
    </div>
    {currentSubscription?.subscriptionStatus === "expired" && (
      <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
        Subscription renewal is required. Expired on {currentSubscription.subscriptionExpiresAt}.
      </p>
    )}
  </Section>

  <Section title="Subscription Management">
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Current cycle" value={currentSubscription ? `Payment #${currentSubscription.id}` : null} />
      <Field label="Package" value={currentSubscription?.packageName ?? (currentSubscription?.packageId ? `#${currentSubscription.packageId}` : null)} />
      <Field label="Payment state" value={<PaymentStatusBadge status={currentSubscription?.status} />} />
      <Field label="Subscription state" value={<SubscriptionBadge payment={currentSubscription} />} />
      <Field label="Expiry date" value={currentSubscription?.subscriptionExpiresAt} />
      <Field
        label="Latest adjustment"
        value={currentSubscription?.extensionHistory?.length
          ? `${currentSubscription.extensionHistory[currentSubscription.extensionHistory.length - 1]?.previousExpiresAt} → ${currentSubscription.extensionHistory[currentSubscription.extensionHistory.length - 1]?.newExpiresAt}`
          : null}
      />
    </div>
    <div className="flex flex-wrap gap-2 pt-1">
      {canEditPayments && (
        <Button
          variant="outline"
          size="sm"
          disabled={!canAdjustExpiry}
          onClick={() => setAdjustExpiryOpen(true)}
        >
          Adjust Expiry
        </Button>
      )}
      {canViewPayments && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate(`/ballet/payments?applicationId=${appId}`)}
        >
          Open Payment History
        </Button>
      )}
    </div>
    {!canAdjustExpiry && currentSubscription?.subscriptionStatus === "expired" && (
      <p className="text-xs text-muted-foreground">
        Expired cycles are not adjusted here. Create a pending renewal from Ballet Payments, then confirm payment when collected.
      </p>
    )}
  </Section>

  <Section title="Payment Cycle History">
    {payments.length === 0 ? (
      <p className="text-sm text-muted-foreground italic">No payment cycles recorded.</p>
    ) : (
      <div className="space-y-2">
        {payments.map((payment: any) => (
          <div key={payment.id} className="rounded-md border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{payment.isRenewal ? "Renewal" : "Initial"} payment #{payment.id}</span>
              <PaymentStatusBadge status={payment.status} />
            </div>
            <div className="mt-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
              <span>{payment.packageName ?? (payment.packageId ? `Package #${payment.packageId}` : "No package")}</span>
              <span>{payment.amountEgp.toLocaleString()} EGP</span>
              <span>{formatPaymentMethod(payment.paymentMethod) ?? "No method"}</span>
              <span>{payment.subscriptionDisplayStatus}</span>
              <span>Paid: {formatDateTime(payment.paidAt)}</span>
              <span>Start: {payment.subscriptionStartDate ?? "—"}</span>
              <span>Expiry: {payment.subscriptionExpiresAt ?? "—"}</span>
              <span>{payment.renewedFromId ? `Renewed from #${payment.renewedFromId}` : "Source cycle —"}</span>
            </div>
          </div>
        ))}
      </div>
    )}
  </Section>
</TabsContent>
  );
}
