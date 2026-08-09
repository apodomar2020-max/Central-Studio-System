import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const ATTENDANCE_STATUSES = [
  { value: "checked_in", label: "Checked In" },
  { value: "late", label: "Late" },
  { value: "absent", label: "Absent" },
  { value: "cancelled", label: "Cancelled" },
];

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  accepted: { label: "Accepted", className: "bg-green-500/15 text-green-400 border-green-500/30" },
  rejected: { label: "Rejected", className: "bg-red-500/15 text-red-400 border-red-500/30" },
  needsFollowUp: { label: "Needs Follow-up", className: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" },
  assignedToLevel: { label: "Assigned to Level", className: "bg-purple-500/15 text-purple-400 border-purple-500/30" },
  active: { label: "Active", className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  cancelled: { label: "Cancelled", className: "bg-slate-500/15 text-slate-400 border-slate-500/30" },
  withdrawn: { label: "Withdrawn", className: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30" },
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  bankTransfer: "Legacy Bank Transfer",
  kashier: "Online Payment",
  inPerson: "Pay at Studio",
};

const PAYMENT_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" },
  paid: { label: "Paid", className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  rejected: { label: "Rejected", className: "bg-red-500/15 text-red-400 border-red-500/30" },
  refunded: { label: "Refunded", className: "bg-slate-500/15 text-slate-400 border-slate-500/30" },
};

export function formatPaymentMethod(method?: string | null) {
  return method ? PAYMENT_METHOD_LABELS[method] ?? method : null;
}

export function formatDateTime(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}

export function PaymentStatusBadge({ status }: { status?: string | null }) {
  if (!status) return <span className="italic text-muted-foreground">—</span>;
  const cfg = PAYMENT_STATUS_CONFIG[status] ?? { label: status, className: "bg-gray-500/15 text-gray-400 border-gray-500/30" };
  return <Badge variant="outline" className={cfg.className}>{cfg.label}</Badge>;
}

export function SubscriptionBadge({ payment }: { payment?: any | null }) {
  if (!payment) return <Badge variant="outline" className="bg-yellow-500/15 text-yellow-400 border-yellow-500/30">Pending Payment</Badge>;
  const className =
    payment.subscriptionStatus === "expired" ? "bg-red-500/15 text-red-400 border-red-500/30"
    : payment.subscriptionStatus === "renewed" ? "bg-cyan-500/15 text-cyan-400 border-cyan-500/30"
    : payment.subscriptionStatus === "active" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
    : "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
  return <Badge variant="outline" className={className}>{payment.subscriptionDisplayStatus}</Badge>;
}

export function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, className: "bg-gray-500/15 text-gray-400 border-gray-500/30" };
  return <Badge variant="outline" className={cfg.className}>{cfg.label}</Badge>;
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

export function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm text-foreground">{value ?? <span className="italic text-muted-foreground">—</span>}</div>
    </div>
  );
}

export function SummaryCard({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1 text-lg font-semibold text-white">{value ?? "—"}</div>
        {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

// Exported (Phase 2) so Overview can render each of the six readiness areas
// as an actionable card — same visual language as the original read-only
// version, plus an optional action slot (a Button when the action is
// currently valid, or explanatory text when a prerequisite is missing).
export function ReadinessItem({ label, state, detail, action }: { label: string; state: "complete" | "pending" | "missing" | "expired" | "warning"; detail?: ReactNode; action?: ReactNode }) {
  const cfg = {
    complete: { text: "Complete", className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
    pending: { text: "Pending", className: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" },
    missing: { text: "Missing", className: "bg-red-500/15 text-red-400 border-red-500/30" },
    expired: { text: "Expired", className: "bg-red-500/15 text-red-400 border-red-500/30" },
    warning: { text: "Review", className: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  }[state];
  return (
    <div className="flex flex-col gap-2 rounded-md border bg-muted/10 px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">{label}</div>
          {detail && <div className="mt-0.5 text-xs text-muted-foreground">{detail}</div>}
        </div>
        <Badge variant="outline" className={cfg.className}>{cfg.text}</Badge>
      </div>
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
