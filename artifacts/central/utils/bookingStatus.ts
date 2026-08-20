export type LocalBookingStatus =
  | "pending"
  | "confirmed"
  | "rejected"
  | "cancelled"
  | "attended"
  | "completed"
  | "noShow"
  // F-08: the safe invariant for any status the client doesn't recognize
  // (e.g. the backend's "attendance_reversed" — see
  // api-server/src/lib/bookingStatus.ts) — never silently presented as
  // Confirmed. No business meaning is inferred for it; it is deliberately
  // neutral, matching BookingCard.tsx's existing unknown-status treatment.
  | "unknown";

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
  // F-08: an unrecognized status (e.g. "attendance_reversed" — a real,
  // reachable backend value; see attendanceReversalService.ts) must never
  // fall through to "confirmed". No canonical customer-facing label exists
  // for it anywhere in the system today, so no business meaning is
  // invented here — it maps to the neutral "unknown" state instead.
  return map[apiStatus] ?? "unknown";
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
