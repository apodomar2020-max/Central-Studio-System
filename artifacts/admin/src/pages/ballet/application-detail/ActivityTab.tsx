import { ArrowRight, Clock, User, History, Wallet } from "lucide-react";
import { TabsContent } from "@/components/ui/tabs";
import type { ApplicationDetailTabPanelsProps } from "./types";
import { formatDateTime, Section, StatusBadge } from "./shared";

// Activity is deliberately NOT gridded — event history is chronological and
// reads best as a single full-width timeline (per Phase 2.2 direction: "do
// not force Activity into arbitrary small cards"). Only cosmetic
// consistency (section icons) was added here.
export function ActivityTab(props: ApplicationDetailTabPanelsProps) {
  const { events, payments } = props;
  return (
<TabsContent value="activity" className="space-y-4">
  <Section title="Event History" icon={<History />}>
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

  <Section title="Payment / Subscription Activity" icon={<Wallet />}>
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
