export type { ApplicationDetailTabPanelsProps } from "./types";
export { Field, PaymentStatusBadge, StatusBadge, SubscriptionBadge } from "./shared";
import type { ApplicationDetailTabPanelsProps } from "./types";
import { OverviewTab } from "./OverviewTab";
import { ApplicationTab } from "./ApplicationTab";
import { EnrollmentTab } from "./EnrollmentTab";
import { PaymentsSubscriptionTab } from "./PaymentsSubscriptionTab";
import { CancellationRefundsTab } from "./CancellationRefundsTab";
import { ActivityTab } from "./ActivityTab";

export function ApplicationDetailTabPanels(props: ApplicationDetailTabPanelsProps) {
  return (
    <>
      <OverviewTab {...props} />
      <ApplicationTab {...props} />
      <EnrollmentTab {...props} />
      <PaymentsSubscriptionTab {...props} />
      <CancellationRefundsTab {...props} />
      <ActivityTab {...props} />
    </>
  );
}
