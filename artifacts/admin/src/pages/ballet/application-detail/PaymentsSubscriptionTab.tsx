import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import { Wallet, CreditCard, RefreshCw, History, Receipt } from "lucide-react";
import type { ApplicationDetailTabPanelsProps } from "./types";
import { AssessmentFeeStatusBadge, Field, formatDateTime, formatPaymentMethod, GridRow, PaymentStatusBadge, Section, SubscriptionBadge } from "./shared";

export function PaymentsSubscriptionTab(props: ApplicationDetailTabPanelsProps) {
  const { app, currentPayment, currentSubscription, pendingInitialPayment, initialPayments, paymentDataWarning, subscriptionExpiredWarning, canCreateInitialPayment, openInitialPaymentDialog, canConfirmInitialPayment, openConfirmPaymentDialog, payments, canAdjustExpiry, canEditPayments, setAdjustExpiryOpen, canViewPayments, navigate, appId, isApplicationTerminal, assessmentFee, openRecordAssessmentFeeDialog } = props;
  const safeInitialPayments = initialPayments ?? [];
  const safePayments = payments ?? [];
  return (
<TabsContent value="payments" className="space-y-4">
  {/* Assessment Fee Section — completely distinct from Package / Subscription payments */}
  <Section title="Ballet Assessment Fee (Intake Fee)" icon={<Receipt />}>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Assessment Fee Status" value={<AssessmentFeeStatusBadge status={assessmentFee?.status} />} />
      <Field label="Configured Amount" value={assessmentFee?.amountEgp != null ? `${assessmentFee.amountEgp} EGP` : "Free / No Fee"} />
      <Field label="Payment Method" value={formatPaymentMethod(assessmentFee?.paymentMethod) ?? "—"} />
      <Field label="Recorded Date" value={formatDateTime(assessmentFee?.paidAt)} />
    </div>
    {openRecordAssessmentFeeDialog && !isApplicationTerminal && (
      <div className="pt-2">
        <Button variant="outline" size="sm" onClick={openRecordAssessmentFeeDialog}>
          Record / Update Assessment Fee
        </Button>
      </div>
    )}
  </Section>

  <GridRow>
    <Section title="Payment Actions" icon={<Wallet />}>
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
      {safeInitialPayments.some((payment: any) => payment.status === "refunded") && (
        <p className="text-xs text-muted-foreground">
          The initial payment on this application is refunded. This refactor does not introduce a replacement-payment workflow.
        </p>
      )}
    </Section>

    <Section title="Payment" icon={<CreditCard />}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Current status" value={<PaymentStatusBadge status={currentPayment?.status} />} />
        <Field label="Subscription" value={<SubscriptionBadge payment={currentSubscription} />} />
        <Field label="Amount" value={currentPayment ? (currentPayment.amountEgp == null ? "Restricted" : `${currentPayment.amountEgp} EGP`) : null} />
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
        <Field label="Last update" value={currentPayment?.updatedAt ? formatDateTime(currentPayment.updatedAt) : null} />
      </div>
      {currentSubscription?.subscriptionStatus === "expired" && (
        <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          Subscription renewal is required. Expired on {currentSubscription.subscriptionExpiresAt}.
        </p>
      )}
    </Section>
  </GridRow>

  <Section title="Subscription Management" icon={<RefreshCw />}>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
      {/* Hidden (not merely disabled) once terminal — matches the Payment
          Actions section above. Still disabled-with-reason for the
          non-terminal "no adjustable cycle" case below. */}
      {!isApplicationTerminal && canEditPayments && (
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

  {/* Payment Cycle History — full width; a record list benefits from the
      extra horizontal room for side-by-side comparison. */}
  <Section title="Payment Cycle History" icon={<History />}>
    {safePayments.length === 0 ? (
      <p className="text-sm text-muted-foreground italic">No payment cycles recorded.</p>
    ) : (
      <div className="space-y-2">
        {safePayments.map((payment: any) => (
          <div key={payment.id} className="rounded-md border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{payment.isRenewal ? "Renewal" : "Initial"} payment #{payment.id}</span>
              <PaymentStatusBadge status={payment.status} />
            </div>
            <div className="mt-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
              <span>{payment.packageName ?? (payment.packageId ? `Package #${payment.packageId}` : "No package")}</span>
              <span>{payment.amountEgp == null ? "Restricted" : `${typeof payment.amountEgp === 'number' ? payment.amountEgp.toLocaleString() : payment.amountEgp} EGP`}</span>
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
