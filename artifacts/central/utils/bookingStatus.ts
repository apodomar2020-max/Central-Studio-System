export type LocalBookingStatus =
  | "pending"
  | "confirmed"
  | "rejected"
  | "cancelled"
  | "attended"
  | "completed"
  | "noShow";

export type LocalPaymentStatus =
  | "not_required"
  | "pending_payment"
  | "paid"
  | "refunded"
  | "failed";

export function mapApiStatusToLocal(apiStatus: string): LocalBookingStatus {
  const map: Record<string, LocalBookingStatus> = {
    pending: "pending",
    confirmed: "confirmed",
    pendingPayment: "pending",
    rejected: "rejected",
    cancelled: "cancelled",
    attended: "attended",
    completed: "completed",
    noShow: "noShow",
    no_show: "noShow",
  };
  return map[apiStatus] ?? "confirmed";
}

export function mapApiPaymentStatusToLocal(apiStatus: string | undefined): LocalPaymentStatus {
  switch (apiStatus) {
    case "pending_payment":
    case "paid":
    case "refunded":
    case "failed":
    case "not_required":
      return apiStatus;
    case "unpaid":
      return "pending_payment";
    default:
      return "not_required";
  }
}
