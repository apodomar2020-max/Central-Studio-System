import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useUpdatePackageOrder,
  updatePackageOrder,
  useDeletePackageOrder,
  useListCreditTransactions,
  getListPackageOrdersQueryKey,
  getListCreditTransactionsQueryKey,
} from "@workspace/api-client-react";
import { TablePagination } from "@/components/shared/table-pagination";
import type { AdjustCreditsBody, UpdatePackageOrderBody } from "@workspace/api-client-react";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import "./admin2-operations.css";
import {
  CheckCircle2, Clock, XCircle, Trash2, Edit2, CreditCard,
  User2, BookOpen, Plus, Minus, ChevronDown, ChevronUp, Coins, MoreHorizontal,
} from "lucide-react";

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  pendingPayment: { label: "Pending",    color: "#F59E0B", icon: Clock },
  active:         { label: "Active",     color: "#22C55E", icon: CheckCircle2 },
  cancelled:      { label: "Cancelled",  color: "#EF4444", icon: XCircle },
  fullyUsed:      { label: "Fully Used", color: "#6B7280", icon: CreditCard },
};

const TX_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  package_activated:    { label: "Package Activated",   color: "#22C55E" },
  attendance_deduction: { label: "Class Attended",       color: "#EF4444" },
  manual_adjustment:    { label: "Manual Adjustment",    color: "#3B82F6" },
  package_bonus:        { label: "Bonus Credits",        color: "#8B5CF6" },
  package_refund:       { label: "Refund",               color: "#22C55E" },
};

const CONFIRMED_PAYMENT_METHODS = ["cash", "card", "kashier", "bank_transfer", "unknown"] as const;
type ConfirmedPaymentMethod = (typeof CONFIRMED_PAYMENT_METHODS)[number];
const CONFIRMED_PAYMENT_METHOD_LABELS: Record<ConfirmedPaymentMethod, string> = {
  cash: "Cash",
  card: "Card",
  kashier: "Kashier",
  bank_transfer: "Bank Transfer",
  unknown: "Unknown",
};

// `confirmedPaymentMethod` is accepted by PATCH /package-orders/:id on the
// server (artifacts/api-server/src/routes/packageOrders.ts) when activating
// but the generated UpdatePackageOrderBody type hasn't been regenerated to
// include it yet — extend it locally rather than widening the whole request
// body to `any`.
type UpdatePackageOrderBodyWithPaymentMethod = UpdatePackageOrderBody & {
  confirmedPaymentMethod?: ConfirmedPaymentMethod;
};

type CreditSourceType = "bonus" | "manual_complimentary" | "manual_paid";
type ClassifiedAdjustCreditsBody = AdjustCreditsBody & {
  sourceType?: CreditSourceType;
  totalValueMinor?: number;
  idempotencyKey: string;
};

const STUDIO_CYAN = "#00B6D7";
const AMBER = "#F59E0B";
const BG_CARD = "hsl(var(--card))";
const BG_ROW = "hsl(var(--muted))";
const BORDER = "hsl(var(--border))";
const MUTED = "hsl(var(--muted-foreground))";
const MUTED_DARK = "hsl(var(--muted-foreground) / 0.68)";
const API_BASE = import.meta.env.VITE_API_URL as string | undefined ?? "";
const API_KEY = import.meta.env.VITE_API_KEY as string | undefined ?? "";

type PackageOrder = {
  id: number;
  studentName: string;
  studentEmail: string;
  studentPhone?: string | null;
  packageName: string;
  totalCredits: number;
  remainingCredits: number;
  status: string;
  notes?: string | null;
  activatedAt?: string | null;
  expiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
  participantType?: "self" | "child" | null;
  participantChildId?: number | null;
  participantName?: string | null;
  participantAgeAtPurchase?: number | null;
  purchaseEligibilityConfigurationState?: "configured" | "legacy_unconfigured" | null;
  ownershipState?: "assigned" | "legacy_unassigned";
};

type RefundLot = { sourceType?: string; creditsIssued: number; creditsRemaining: number; totalValueMinor: number | null; remainingValueMinor?: number; reason?: string };
type RefundEligibility = { eligible: boolean; refundableAmountMinor: number; refundableCredits: number; consumedValueMinor: number; expiredValueMinor: number; refundableLots: RefundLot[]; excludedLots: RefundLot[]; integrityWarnings: string[] };
type PackageRefund = { id: number; status: string; requestedAmountMinor: number; approvedAmountMinor?: number | null; refundedAmountMinor?: number | null };
type RefundOverview = { eligibility: RefundEligibility; refund: PackageRefund | null };

const REFUND_INTEGRITY_WARNING_LABELS: Record<string, string> = {
  package_order_not_found: "Package order could not be found.",
  package_order_not_active: "Only active or fully used packages can be refunded.",
  payment_record_missing: "No payment record is linked to this package.",
  payment_record_multiple: "Multiple payment records require Finance review.",
  payment_record_not_refundable: "The linked payment is not refundable.",
  payment_amount_unavailable: "The recorded payment amount is unavailable.",
  lot_balance_mismatch: "The package credit balance does not match its credit lots.",
  restored_lot_provenance_invalid: "A restored credit has incomplete purchase history.",
  no_refundable_value: "No refundable purchased credit value remains.",
  refundable_value_exceeds_payment_capacity: "Refundable credit value exceeds the remaining payment capacity.",
};

const REFUND_EXCLUDED_LOT_REASON_LABELS: Record<string, string> = {
  no_remaining_credits: "The original credit lot has no remaining credits.",
  bonus: "Bonus credits have no refundable cash value.",
  non_purchased_source: "Non-purchased credits have no refundable cash value.",
  expired: "Expired credits are not refundable.",
  unknown_value: "The purchase value for these credits is unknown.",
  unsupported_value_basis: "The recorded credit value is not supported for refunds.",
  corrupt_provenance: "The credit purchase history is incomplete or inconsistent.",
};

function refundReasonLabel(code: string, labels: Record<string, string>): string {
  return labels[code] ?? code.replaceAll("_", " ");
}

function makeHeaders(token?: string | null): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(API_KEY ? { "x-api-key": API_KEY } : {}),
    ...(token ? { "x-admin-token": token } : {}),
  };
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, color: MUTED, icon: CreditCard };
  const Icon = cfg.icon;
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium"
      style={{ backgroundColor: cfg.color + "20", color: cfg.color }}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

function RefundDialog({ order, onClose }: { order: PackageOrder; onClose: () => void }) {
  const { token } = useAdminAuth();
  const [overview, setOverview] = useState<RefundOverview | null>(null);
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState<"cash" | "original_payment_method">("original_payment_method");
  const [reference, setReference] = useState("");
  const [failureReason, setFailureReason] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [pending, setPending] = useState(false);
  const requestKey = useRef(crypto.randomUUID());
  const completionKey = useRef(crypto.randomUUID());

  const load = async () => {
    const res = await fetch(`${API_BASE}/api/admin/package-orders/${order.id}/refund-eligibility`, { headers: makeHeaders(token) });
    if (!res.ok) throw new Error("Could not load refund eligibility");
    setOverview(await res.json() as RefundOverview);
  };
  useEffect(() => { void load().catch((e: Error) => setError(e.message)); }, [order.id]);

  async function action(path: string, body: object, successMessage: string) {
    setPending(true); setError(""); setSuccess("");
    try {
      const res = await fetch(`${API_BASE}/api/${path}`, { method: "POST", headers: makeHeaders(token), body: JSON.stringify(body) });
      const data = await res.json() as { refund?: PackageRefund; message?: string; error?: string };
      if (!res.ok) throw new Error(data.message ?? data.error ?? "Refund action failed");
      setOverview((current) => current ? { ...current, refund: data.refund ?? current.refund } : current);
      setSuccess(successMessage);
    } catch (e) { setError(e instanceof Error ? e.message : "Refund action failed"); }
    finally { setPending(false); }
  }
  if (!overview) return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
    <div className="w-full max-w-sm rounded-xl p-6 space-y-4" style={{ background: BG_CARD }} onClick={(e) => e.stopPropagation()}>
      <p role={error ? "alert" : "status"} className={error ? "text-sm text-red-500" : "text-sm"}>{error || "Loading refund eligibility…"}</p>
      {error && <button onClick={onClose} className="w-full rounded-lg px-3 py-2 text-sm font-semibold" style={{ background: BG_ROW }}>Close</button>}
    </div>
  </div>;
  const { eligibility, refund } = overview;
  const excludedCredits = (source: string) => eligibility.excludedLots.filter((lot) => lot.sourceType === source).reduce((sum, lot) => sum + lot.creditsRemaining, 0);
  const eligibilityFailureReasons = [...new Set([
    ...eligibility.integrityWarnings.map((warning) => refundReasonLabel(warning, REFUND_INTEGRITY_WARNING_LABELS)),
    ...eligibility.excludedLots.map((lot) => refundReasonLabel(lot.reason ?? "", REFUND_EXCLUDED_LOT_REASON_LABELS)).filter(Boolean),
  ])];
  const reasonMissing = !reason.trim();
  const requestDisabled = pending || !eligibility.eligible || reasonMissing;
  const requestDisabledExplanation = pending
    ? "Refund request is being submitted."
    : reasonMissing
      ? "Refund reason is required."
      : !eligibility.eligible
        ? "Refund eligibility requirements are not met."
        : undefined;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
    <div className="w-full max-w-lg rounded-2xl p-6 space-y-4" style={{ background: BG_CARD, border: `1px solid ${BORDER}` }} onClick={(e) => e.stopPropagation()}>
      <div><h2 className="text-lg font-bold">Package Refund</h2><p className="text-xs" style={{ color: MUTED }}>{order.studentName} · {order.packageName}</p></div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-lg p-3" style={{ background: BG_ROW }}>Refundable <strong>{(eligibility.refundableAmountMinor / 100).toFixed(2)} EGP</strong></div>
        <div className="rounded-lg p-3" style={{ background: BG_ROW }}>Purchased credits <strong>{eligibility.refundableCredits}</strong></div>
        <div className="rounded-lg p-3" style={{ background: BG_ROW }}>Consumed value <strong>{(eligibility.consumedValueMinor / 100).toFixed(2)} EGP</strong></div>
        <div className="rounded-lg p-3" style={{ background: BG_ROW }}>Expired value <strong>{(eligibility.expiredValueMinor / 100).toFixed(2)} EGP</strong></div>
      </div>
      <p className="text-xs" style={{ color: MUTED }}>Excluded credits: bonus {excludedCredits("bonus")} · complimentary {excludedCredits("manual_complimentary")} · unknown {eligibility.excludedLots.filter((lot) => lot.reason === "unknown_value").reduce((s, l) => s + l.creditsRemaining, 0)}</p>
      {!eligibility.eligible && <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-500">
        <p className="font-semibold">Refund cannot be requested:</p>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          {(eligibilityFailureReasons.length > 0 ? eligibilityFailureReasons : ["Refund eligibility requirements are not met."]).map((message) => <li key={message}>{message}</li>)}
        </ul>
      </div>}
      {refund && <div className="rounded-lg p-3 text-sm" style={{ background: `${STUDIO_CYAN}15` }}>Refund status: <strong>{refund.status}</strong></div>}
      {!refund && <><div><textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Refund reason" aria-invalid={reasonMissing} aria-describedby={reasonMissing ? "refund-reason-required" : undefined} className="w-full rounded-lg p-3 text-sm" style={{ background: BG_ROW }} />{reasonMissing && <p id="refund-reason-required" className="mt-1 text-xs text-amber-500">Refund reason is required.</p>}</div><select value={method} onChange={(e) => setMethod(e.target.value as typeof method)} className="w-full rounded-lg p-3 text-sm" style={{ background: BG_ROW }}><option value="original_payment_method">Original payment method</option><option value="cash">Cash</option></select></>}
      {(refund?.status === "approved" || refund?.status === "processing") && <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Payout transaction reference" className="w-full rounded-lg p-3 text-sm" style={{ background: BG_ROW }} />}
      {(refund?.status === "approved" || refund?.status === "processing") && <input value={failureReason} onChange={(e) => setFailureReason(e.target.value)} placeholder="Failure reason (if payout failed)" className="w-full rounded-lg p-3 text-sm" style={{ background: BG_ROW }} />}
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      {success && <p role="status" className="text-sm text-green-500">{success}</p>}
      <div className="flex flex-wrap gap-2 justify-end">
        <button onClick={onClose} className="px-3 py-2 rounded-lg" style={{ background: BG_ROW }}>Close</button>
        {!refund && <div className="flex flex-col items-end gap-1"><button disabled={requestDisabled} title={requestDisabledExplanation} onClick={() => action(`admin/package-orders/${order.id}/refunds`, { refundMethod: method, requestedReason: reason, idempotencyKey: requestKey.current }, "Refund request submitted for review.")} className="px-3 py-2 rounded-lg bg-cyan-600 text-white disabled:cursor-not-allowed disabled:opacity-50">{pending ? "Requesting…" : "Request refund"}</button>{requestDisabledExplanation && !pending && <p className="max-w-xs text-right text-xs" style={{ color: MUTED }}>{requestDisabledExplanation}</p>}</div>}
        {refund?.status === "underReview" && <><button disabled={pending} onClick={() => action(`admin/package-refunds/${refund.id}/reject`, {}, "Refund request rejected.")} className="px-3 py-2 rounded-lg bg-red-600 text-white disabled:cursor-not-allowed disabled:opacity-50">Reject</button><button disabled={pending} onClick={() => action(`admin/package-refunds/${refund.id}/approve`, {}, "Refund request approved.")} className="px-3 py-2 rounded-lg bg-green-600 text-white disabled:cursor-not-allowed disabled:opacity-50">Approve</button></>}
        {(refund?.status === "approved" || refund?.status === "processing") && <><button disabled={pending || !failureReason.trim()} onClick={() => action(`admin/package-refunds/${refund.id}/fail`, { failedReason: failureReason }, "Refund payout marked as failed.")} className="px-3 py-2 rounded-lg bg-red-600 text-white disabled:cursor-not-allowed disabled:opacity-50">Mark failed</button><button disabled={pending || !reference.trim()} onClick={() => action(`admin/package-refunds/${refund.id}/complete`, { completionIdempotencyKey: completionKey.current, transactionReference: reference }, "Refund payout completed.")} className="px-3 py-2 rounded-lg bg-green-600 text-white disabled:cursor-not-allowed disabled:opacity-50">Complete payout</button></>}
      </div>
    </div>
  </div>;
}

// ─── Adjust Credits Dialog ────────────────────────────────────────────────────

function AdjustCreditsDialog({
  order,
  onClose,
}: {
  order: PackageOrder;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { token } = useAdminAuth();
  const [sourceType, setSourceType] = useState<CreditSourceType>("manual_complimentary");
  const [rawDelta, setRawDelta] = useState("");
  const [rawPaidValue, setRawPaidValue] = useState("");
  const [notes, setNotes] = useState("");
  const lastAttempt = useRef<{ signature: string; key: string } | null>(null);

  const delta = parseInt(rawDelta, 10);
  const isValidDelta = !isNaN(delta) && delta !== 0;
  const newBalance = isValidDelta ? order.remainingCredits + delta : order.remainingCredits;
  const balanceSafe = newBalance >= 0;
  const paidValueEgp = Number(rawPaidValue);
  const paidValueValid = sourceType !== "manual_paid" || (Number.isFinite(paidValueEgp) && paidValueEgp > 0);

  const { mutate, isPending } = useMutation({
    mutationFn: async (data: ClassifiedAdjustCreditsBody) => {
      const res = await fetch(`${API_BASE}/api/admin/package-orders/${order.id}/credits`, {
        method: "POST",
        headers: makeHeaders(token),
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string; message?: string };
        throw new Error(body.message ?? body.error ?? "Credit adjustment failed");
      }

      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getListPackageOrdersQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListCreditTransactionsQueryKey({ packageOrderId: order.id }) });
      onClose();
    },
  });

  function handleSubmit() {
    if (!isValidDelta || !balanceSafe || (delta > 0 && !paidValueValid)) return;
    const type = delta > 0 && sourceType === "bonus" ? "package_bonus" : "manual_adjustment";
    const normalizedNotes = notes.trim() || undefined;
    const totalValueMinor = delta > 0 && sourceType === "manual_paid"
      ? Math.round(paidValueEgp * 100)
      : undefined;
    const signature = JSON.stringify({ type, delta, sourceType: delta > 0 ? sourceType : undefined, totalValueMinor, notes: normalizedNotes });
    const idempotencyKey = lastAttempt.current?.signature === signature
      ? lastAttempt.current.key
      : crypto.randomUUID();
    lastAttempt.current = { signature, key: idempotencyKey };
    mutate({
      type,
      delta,
      sourceType: delta > 0 ? sourceType : undefined,
      totalValueMinor,
      idempotencyKey,
      notes: normalizedNotes,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl p-6 space-y-5"
        style={{ background: BG_CARD, border: `1px solid ${BORDER}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: `${STUDIO_CYAN}20` }}>
            <Coins className="h-5 w-5" style={{ color: STUDIO_CYAN }} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">Adjust Credits</h2>
            <p className="text-xs" style={{ color: MUTED }}>{order.studentName} · {order.packageName}</p>
          </div>
        </div>

        {/* Current balance */}
        <div className="flex items-center gap-3 rounded-xl p-3" style={{ background: BG_ROW }}>
          <div className="text-center flex-1">
            <p className="text-2xl font-bold" style={{ color: STUDIO_CYAN }}>{order.remainingCredits}</p>
            <p className="text-xs" style={{ color: MUTED }}>Current</p>
          </div>
          <div style={{ color: MUTED }}>→</div>
          <div className="text-center flex-1">
            <p className="text-2xl font-bold" style={{ color: balanceSafe ? "#22C55E" : "#EF4444" }}>
              {isValidDelta ? newBalance : "?"}
            </p>
            <p className="text-xs" style={{ color: MUTED }}>After</p>
          </div>
          <div style={{ color: MUTED }}>/ {order.totalCredits} total</div>
        </div>

        <div className="space-y-4">
          {delta > 0 && (
          <div>
            <label className="block text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: MUTED }}>Credit Source</label>
            <div className="grid grid-cols-3 gap-2">
              {(["bonus", "manual_complimentary", "manual_paid"] as const).map((source) => (
                <button
                  key={source}
                  onClick={() => setSourceType(source)}
                  className="px-3 py-2 rounded-xl text-xs font-semibold transition-all"
                  style={
                    sourceType === source
                      ? { background: `${STUDIO_CYAN}20`, border: `1px solid ${STUDIO_CYAN}60`, color: STUDIO_CYAN }
                      : { background: BG_ROW, border: `1px solid ${BORDER}`, color: MUTED }
                  }
                >
                  {source === "bonus" ? "Bonus" : source === "manual_complimentary" ? "Complimentary" : "Paid Credit"}
                </button>
              ))}
            </div>
          </div>
          )}

          {delta > 0 && sourceType === "manual_paid" && (
            <div>
              <label className="block text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: MUTED }}>Total Paid Value (EGP)</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={rawPaidValue}
                onChange={(e) => setRawPaidValue(e.target.value)}
                placeholder="e.g. 250.00"
                className="w-full rounded-xl px-3 py-2 text-sm text-foreground"
                style={{ background: BG_ROW, border: `1px solid ${BORDER}`, outline: "none" }}
              />
            </div>
          )}

          {/* Delta input */}
          <div>
            <label className="block text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: MUTED }}>
              Credit Change (positive to add, negative to remove)
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setRawDelta((v) => String((parseInt(v, 10) || 0) - 1))}
                className="flex h-9 w-9 items-center justify-center rounded-xl flex-shrink-0"
                style={{ background: BG_ROW, border: `1px solid ${BORDER}` }}
              >
                <Minus className="h-3.5 w-3.5 text-foreground" />
              </button>
              <input
                type="number"
                value={rawDelta}
                onChange={(e) => setRawDelta(e.target.value)}
                placeholder="e.g. +5 or -2"
                className="flex-1 rounded-xl px-3 py-2 text-sm text-center text-foreground"
                style={{ background: BG_ROW, border: `1px solid ${BORDER}`, outline: "none" }}
              />
              <button
                onClick={() => setRawDelta((v) => String((parseInt(v, 10) || 0) + 1))}
                className="flex h-9 w-9 items-center justify-center rounded-xl flex-shrink-0"
                style={{ background: BG_ROW, border: `1px solid ${BORDER}` }}
              >
                <Plus className="h-3.5 w-3.5 text-foreground" />
              </button>
            </div>
            {isValidDelta && !balanceSafe && (
              <p className="text-xs mt-1.5" style={{ color: "#EF4444" }}>
                Cannot remove {Math.abs(delta)} credits — only {order.remainingCredits} remaining
              </p>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: MUTED }}>Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Reason for adjustment..."
              rows={2}
              className="w-full rounded-xl px-3 py-2.5 text-sm text-foreground resize-none"
              style={{ background: BG_ROW, border: `1px solid ${BORDER}`, outline: "none" }}
            />
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
            style={{ background: BG_ROW, color: MUTED }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isPending || !isValidDelta || !balanceSafe || (delta > 0 && !paidValueValid)}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-colors disabled:opacity-40"
            style={{ background: STUDIO_CYAN, color: "hsl(var(--primary-foreground))" }}
          >
            {isPending ? "Applying…" : "Apply"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Activate Package Dialog ──────────────────────────────────────────────────

function ActivatePackageDialog({
  order,
  onClose,
  onActivate,
  isPending,
  errorMessage,
  amountEgp,
  amountLoading,
}: {
  order: PackageOrder;
  onClose: () => void;
  onActivate: (confirmedPaymentMethod: ConfirmedPaymentMethod) => void;
  isPending: boolean;
  errorMessage: string;
  amountEgp: number | null;
  amountLoading: boolean;
}) {
  const [confirmedPaymentMethod, setConfirmedPaymentMethod] = useState<ConfirmedPaymentMethod | "">("");

  function handleSubmit() {
    if (!confirmedPaymentMethod || isPending) return;
    onActivate(confirmedPaymentMethod);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl p-6 space-y-5"
        style={{ background: BG_CARD, border: `1px solid ${BORDER}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: "#22C55E20" }}>
            <CheckCircle2 className="h-5 w-5" style={{ color: "#22C55E" }} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">Activate Package</h2>
            <p className="text-xs" style={{ color: MUTED }}>{order.studentName} · {order.packageName}</p>
          </div>
        </div>

        <div className="rounded-xl p-3 text-sm" style={{ background: BG_ROW }}>
          <span style={{ color: MUTED }}>Amount: </span>
          <span className="font-semibold text-foreground">
            {amountLoading ? "Loading…" : amountEgp == null ? "Amount unavailable" : `EGP ${amountEgp.toLocaleString()}`}
          </span>
        </div>

        <div>
          <label className="block text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: MUTED }}>
            Payment Method
          </label>
          <select
            value={confirmedPaymentMethod}
            onChange={(e) => setConfirmedPaymentMethod(e.target.value as ConfirmedPaymentMethod)}
            className="w-full rounded-xl px-3 py-2.5 text-sm text-foreground"
            style={{ background: BG_ROW, border: `1px solid ${BORDER}`, outline: "none" }}
            data-testid="select-confirmed-payment-method"
          >
            <option value="" disabled>Select payment method…</option>
            {CONFIRMED_PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>{CONFIRMED_PAYMENT_METHOD_LABELS[m]}</option>
            ))}
          </select>
        </div>

        {errorMessage && (
          <p className="text-xs" style={{ color: "#EF4444" }}>{errorMessage}</p>
        )}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
            style={{ background: BG_ROW, color: MUTED }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isPending || amountLoading || amountEgp == null || !confirmedPaymentMethod}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-colors disabled:opacity-40"
            style={{ background: "#22C55E", color: "hsl(var(--primary-foreground))" }}
          >
            {isPending ? "Activating…" : "Activate"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Ledger Panel ─────────────────────────────────────────────────────────────

function LedgerPanel({ orderId }: { orderId: number }) {
  const { data, isLoading } = useListCreditTransactions({ packageOrderId: orderId, limit: 50 });
  const transactions = (data as any)?.data ?? [];

  if (isLoading) {
    return (
      <tr style={{ borderTop: `1px solid ${BORDER}` }}>
        <td colSpan={7} className="px-6 py-3">
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-4 w-full" />)}
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr style={{ borderTop: `1px solid ${BORDER}` }}>
      <td colSpan={7} className="px-4 py-3">
        <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
          <div className="px-4 py-2.5 flex items-center gap-2" style={{ background: BG_ROW }}>
            <BookOpen className="h-3.5 w-3.5" style={{ color: STUDIO_CYAN }} />
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: STUDIO_CYAN }}>
              Credit Ledger
            </span>
            <span className="text-xs" style={{ color: MUTED }}>({transactions.length} entries)</span>
          </div>

          {transactions.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm" style={{ color: MUTED_DARK }}>No transactions yet</div>
          ) : (
            <table className="w-full text-xs">
              <thead style={{ background: BG_ROW }}>
                <tr>
                  {["Type", "Delta", "Balance", "Notes", "By", "Date"].map((h) => (
                    <th key={h} className="text-left px-3 py-2 uppercase tracking-wider font-semibold" style={{ color: MUTED_DARK }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx: any, i: number) => {
                  const txCfg = TX_TYPE_LABELS[tx.type] ?? { label: tx.type, color: MUTED };
                  return (
                    <tr key={tx.id} style={{ borderTop: i > 0 ? `1px solid ${BORDER}` : undefined }}>
                      <td className="px-3 py-2 font-medium" style={{ color: txCfg.color }}>{txCfg.label}</td>
                      <td className="px-3 py-2 font-bold" style={{ color: tx.delta > 0 ? "#22C55E" : "#EF4444" }}>
                        {tx.delta > 0 ? "+" : ""}{tx.delta}
                      </td>
                      <td className="px-3 py-2" style={{ color: MUTED }}>{tx.balanceAfter}</td>
                      <td className="px-3 py-2 max-w-[160px] truncate" style={{ color: MUTED }}>{tx.notes ?? "—"}</td>
                      <td className="px-3 py-2" style={{ color: MUTED_DARK }}>{tx.createdBy ?? "system"}</td>
                      <td className="px-3 py-2 whitespace-nowrap" style={{ color: MUTED_DARK }}>
                        {new Date(tx.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 25;

export default function PackageOrders() {
  const { can, token } = useAdminAuth();
  const canApprove = can("packageOrders", "approve");
  const canCancel = can("packageOrders", "cancel");
  const canManageRefunds = canCancel && can("finance", "refundsManage");
  // Finance Roles & Permissions integration: activating a package order is
  // the payment-confirmation moment for a package purchase — it requires
  // finance.paymentsConfirm in addition to the existing packageOrders.approve
  // permission. Backend enforces the same permission independently.
  const canConfirmPayments = can("finance", "paymentsConfirm");
  const canDelete = can("packageOrders", "delete");
  const canAdjustCredits = can("credits", "adjust");
  const canViewCreditHistory = can("credits", "history") || can("credits", "view");
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [editingOrder, setEditingOrder] = useState<PackageOrder | null>(null);
  const [editNotes, setEditNotes] = useState("");
  const [editExpiry, setEditExpiry] = useState("");
  const [adjustingOrder, setAdjustingOrder] = useState<PackageOrder | null>(null);
  const [activatingOrder, setActivatingOrder] = useState<PackageOrder | null>(null);
  const [activateError, setActivateError] = useState("");
  const [activationAmount, setActivationAmount] = useState<number | null>(null);
  const [activationAmountLoading, setActivationAmountLoading] = useState(false);
  const [expandedLedger, setExpandedLedger] = useState<number | null>(null);
  const [refundingOrder, setRefundingOrder] = useState<PackageOrder | null>(null);

  // Changing the status tab resets pagination.
  useEffect(() => {
    setPage(1);
  }, [statusFilter]);

  // Phase 4B: paginated list. Raw fetch (same pattern as the credits call
  // below) because pagination metadata travels in response headers, which the
  // generated hook cannot expose. The query key shares the generated key's
  // root ("/api/package-orders"), so every existing
  // invalidateQueries(getListPackageOrdersQueryKey()) still refreshes this
  // list. The response BODY is unchanged (plain array) — the Attendance
  // page's un-paginated useListPackageOrders(undefined) keeps working as-is.
  const listQuery = useQuery({
    queryKey: [...getListPackageOrdersQueryKey(), { statusFilter, page, pageSize: PAGE_SIZE, paginated: true }],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
        ...(statusFilter !== "all" ? { status: statusFilter } : {}),
      });
      const res = await fetch(`${API_BASE}/api/package-orders?${params}`, {
        headers: makeHeaders(token),
      });
      if (!res.ok) throw new Error("Failed to load package orders");
      const body = await res.json() as PackageOrder[];
      return {
        orders: body,
        total: Number(res.headers.get("X-Total-Count") ?? body.length),
        totalPages: Number(res.headers.get("X-Total-Pages") ?? 1),
      };
    },
  });
  const orders = listQuery.data?.orders ?? [];
  const total = listQuery.data?.total ?? 0;
  const totalPages = listQuery.data?.totalPages ?? 0;
  const isLoading = listQuery.isLoading;
  const isError = listQuery.isError;

  // Global pending count for the header badge (header-only query — the badge
  // previously counted the fully loaded list, which pagination would break).
  const { data: pendingCount = 0 } = useQuery({
    queryKey: [...getListPackageOrdersQueryKey(), { pendingCountOnly: true }],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/package-orders?status=pendingPayment&page=1&pageSize=1`, {
        headers: makeHeaders(token),
      });
      if (!res.ok) return 0;
      await res.json();
      return Number(res.headers.get("X-Total-Count") ?? 0);
    },
  });

  const { mutate: updateOrder, isPending: isUpdating } = useUpdatePackageOrder({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPackageOrdersQueryKey() });
        setEditingOrder(null);
      },
    },
  });

  const { mutate: deleteOrder } = useDeletePackageOrder({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListPackageOrdersQueryKey() }),
    },
  });

  const { mutate: activateOrder, isPending: isActivating } = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: UpdatePackageOrderBodyWithPaymentMethod }) =>
      updatePackageOrder(id, data as UpdatePackageOrderBody),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getListPackageOrdersQueryKey() });
      setActivatingOrder(null);
      setActivateError("");
    },
    onError: (err: unknown) => {
      const data = err !== null && typeof err === "object" && "data" in err ? (err as { data?: { message?: string; error?: string } }).data : null;
      setActivateError(data?.message ?? data?.error ?? "Could not activate this package — please try again.");
    },
  });

  function handleActivateOpen(order: PackageOrder) {
    setActivateError("");
    setActivatingOrder(order);
    setActivationAmount(null);
    setActivationAmountLoading(true);
    void fetch(`${API_BASE}/api/package-orders/${order.id}/payment-confirmation-amount`, {
      headers: makeHeaders(token),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load the authorized payment amount.");
        return response.json() as Promise<{ amountEgp: number | null }>;
      })
      .then((body) => setActivationAmount(body.amountEgp))
      .catch((error: unknown) => setActivateError(error instanceof Error ? error.message : "Could not load the authorized payment amount."))
      .finally(() => setActivationAmountLoading(false));
  }

  function handleActivateConfirm(confirmedPaymentMethod: ConfirmedPaymentMethod) {
    if (!activatingOrder) return;
    const expiry = new Date();
    expiry.setMonth(expiry.getMonth() + 3);
    setActivateError("");
    activateOrder({
      id: activatingOrder.id,
      data: {
        status: "active",
        activatedAt: new Date().toISOString(),
        expiresAt: expiry.toISOString(),
        confirmedPaymentMethod,
      },
    });
  }

  function handleCancel(order: PackageOrder) {
    if (!confirm(`Cancel this package order for ${order.studentName}?`)) return;
    updateOrder({ id: order.id, data: { status: "cancelled" } });
  }

  function handleDelete(id: number) {
    if (!confirm("Permanently delete this package order?")) return;
    deleteOrder({ id });
  }

  function handleEditOpen(order: PackageOrder) {
    setEditingOrder(order);
    setEditNotes(order.notes ?? "");
    setEditExpiry(order.expiresAt ? order.expiresAt.slice(0, 10) : "");
  }

  function handleEditSave() {
    if (!editingOrder) return;
    updateOrder({
      id: editingOrder.id,
      data: { notes: editNotes || null, expiresAt: editExpiry ? new Date(editExpiry).toISOString() : null },
    });
  }

  const statusFilters = ["all", "pendingPayment", "active", "fullyUsed", "cancelled"];

  return (
    <div className="admin2-ops-page admin2-package-orders">
      <div className="admin2-ops-local-summary flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Package Orders</h1>
          <p className="mt-1 text-sm" style={{ color: MUTED }}>Manage student package requests and activations</p>
        </div>
        <span className="shrink-0 whitespace-nowrap text-xs font-semibold" style={{ color: AMBER }}>
          {pendingCount} pending
        </span>
      </div>

      {/* Filter tabs */}
      <div className="admin2-command-bar admin2-filter-pills">
        {statusFilters.map((f) => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            aria-pressed={statusFilter === f}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${statusFilter === f ? "is-selected" : ""}`}
            style={statusFilter === f ? { backgroundColor: STUDIO_CYAN, color: "hsl(var(--primary-foreground))" } : { backgroundColor: BG_ROW, color: MUTED }}
          >
            {f === "all" ? "All" : STATUS_CONFIG[f]?.label ?? f}
          </button>
        ))}
      </div>

      {/* Table — overflow-x-auto (Phase 5B) so the 7-column table scrolls
          horizontally on mobile instead of breaking the viewport. */}
      <div className="admin2-queue-surface">
        <table className="w-full text-sm">
          <thead style={{ background: BG_ROW }}>
            <tr>
              {["Payer", "Participant", "Package", "Credits", "Status", "Requested", "Ledger", "Actions"].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED_DARK }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} style={{ borderTop: `1px solid ${BORDER}` }}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              : isError ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-sm text-destructive">
                    Package orders could not be loaded. Try again in a moment.
                  </td>
                </tr>
              ) : (orders as PackageOrder[]).length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-sm" style={{ color: MUTED_DARK }}>
                    No package orders found
                  </td>
                </tr>
              ) : (
                (orders as PackageOrder[]).flatMap((order) => {
                  const rows = [
                    <tr
                      key={`order-${order.id}`}
                      className="admin2-transaction-row"
                      style={{ borderTop: `1px solid ${BORDER}` }}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{order.studentName}</div>
                        <div className="text-xs mt-0.5" style={{ color: MUTED }}>{order.studentEmail}</div>
                        {order.studentPhone && <div className="text-xs" style={{ color: MUTED_DARK }}>{order.studentPhone}</div>}
                      </td>
                      <td className="px-4 py-3">
                        {order.participantType ? (
                          <>
                            <div className="font-medium text-foreground">
                              {order.participantName ?? "Participant"}
                            </div>
                            <div className="text-xs mt-0.5" style={{ color: MUTED }}>
                              {order.participantType === "child" ? "Child" : "Self"}
                              {order.participantAgeAtPurchase != null ? ` · age ${order.participantAgeAtPurchase}` : ""}
                            </div>
                          </>
                        ) : (
                          <span className="text-xs font-semibold" style={{ color: AMBER }}>
                            Legacy unassigned
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{order.packageName}</div>
                        {order.expiresAt && (
                          <div className="text-xs mt-0.5" style={{ color: MUTED }}>
                            Expires {new Date(order.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="admin2-credit-value" style={{ color: STUDIO_CYAN }}>
                          {order.remainingCredits}
                          <span className="text-xs font-normal ml-1" style={{ color: MUTED_DARK }}>/ {order.totalCredits}</span>
                        </div>
                        <div className="w-24 h-1.5 rounded-full mt-1 overflow-hidden" style={{ background: BG_ROW }}>
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${Math.round((order.remainingCredits / order.totalCredits) * 100)}%`, background: STUDIO_CYAN }}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={order.status} /></td>
                      <td className="px-4 py-3 text-xs" style={{ color: MUTED }}>
                        {new Date(order.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                      </td>
                      {/* Ledger toggle — informational (expand/collapse), not a mutation */}
                      <td className="px-4 py-3">
                        {canViewCreditHistory && (
                          <Button
                            variant="ghost"
                            size="iconSm"
                            onClick={() => setExpandedLedger((prev) => (prev === order.id ? null : order.id))}
                            aria-label={`${expandedLedger === order.id ? "Collapse" : "Expand"} ledger for ${order.studentName}`}
                            title="Credit ledger"
                          >
                            <BookOpen />
                            {expandedLedger === order.id ? <ChevronUp /> : <ChevronDown />}
                          </Button>
                        )}
                      </td>
                      {/* Actions — production hotfix: this used to be up to 5
                          simultaneous raw <button> elements with inline hex colors
                          (mixed icon-only/text, several different visual systems).
                          Only Edit + the clear primary (Activate, when applicable)
                          stay directly visible now; Credits/Cancel/Refund/Delete
                          move into one canonical Admin 2.0 dropdown menu. Every
                          handler is unchanged — handleCancel/handleDelete already
                          gate on window.confirm() before mutating, so destructive
                          safety is preserved as-is, not newly added. */}
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {canApprove && (
                            <Button
                              variant="ghost"
                              size="iconSm"
                              onClick={() => handleEditOpen(order)}
                              aria-label={`Edit ${order.studentName} package order`}
                              title="Edit notes/expiry"
                            >
                              <Edit2 />
                            </Button>
                          )}
                          {canApprove && canConfirmPayments && order.status === "pendingPayment" && (
                            <Button
                              variant="secondary"
                              size="compact"
                              onClick={() => handleActivateOpen(order)}
                              title="Activate package"
                            >
                              <CheckCircle2 /> Activate
                            </Button>
                          )}
                          {(canAdjustCredits || canCancel || canManageRefunds || canDelete) && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="iconSm" aria-label={`More actions for ${order.studentName} package order`}>
                                  <MoreHorizontal />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {canAdjustCredits && (order.status === "active" || order.status === "fullyUsed") && (
                                  <DropdownMenuItem onClick={() => setAdjustingOrder(order)}>
                                    <Coins /> Adjust Credits
                                  </DropdownMenuItem>
                                )}
                                {canManageRefunds && (order.status === "active" || order.status === "fullyUsed") && (
                                  <DropdownMenuItem onClick={() => setRefundingOrder(order)}>
                                    <CreditCard /> Refund
                                  </DropdownMenuItem>
                                )}
                                {((canAdjustCredits && (order.status === "active" || order.status === "fullyUsed")) || (canManageRefunds && (order.status === "active" || order.status === "fullyUsed"))) && (canCancel || canDelete) && <DropdownMenuSeparator />}
                                {canCancel && order.status !== "cancelled" && (
                                  <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => handleCancel(order)}>
                                    <XCircle /> Cancel Order
                                  </DropdownMenuItem>
                                )}
                                {canDelete && (
                                  <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => handleDelete(order.id)}>
                                    <Trash2 /> Delete
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      </td>
                    </tr>,
                  ];

                  if (canViewCreditHistory && expandedLedger === order.id) {
                    rows.push(<LedgerPanel key={`ledger-${order.id}`} orderId={order.id} />);
                  }

                  return rows;
                })
              )}
          </tbody>
        </table>
      </div>

      {/* Pagination (Phase 4B) */}
      {total > 0 && (
        <TablePagination
          page={page}
          totalPages={totalPages}
          total={total}
          pageSize={PAGE_SIZE}
          isLoading={isLoading}
          itemLabel="orders"
          onPageChange={setPage}
        />
      )}

      {/* Edit modal */}
      {canApprove && editingOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setEditingOrder(null)}>
          <div
            className="max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl p-6 space-y-5"
            style={{ background: BG_CARD, border: `1px solid ${BORDER}` }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: `${STUDIO_CYAN}20` }}>
                <User2 className="h-5 w-5" style={{ color: STUDIO_CYAN }} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-foreground">{editingOrder.studentName}</h2>
                <p className="text-sm" style={{ color: MUTED }}>{editingOrder.packageName}</p>
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: MUTED }}>Notes</label>
                <textarea
                  className="w-full rounded-xl px-3 py-2.5 text-sm text-foreground resize-none"
                  style={{ background: BG_ROW, border: `1px solid ${BORDER}`, outline: "none" }}
                  rows={3}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Add notes..."
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: MUTED }}>Expiry Date</label>
                <input
                  type="date"
                  className="w-full rounded-xl px-3 py-2.5 text-sm text-foreground"
                  style={{ background: BG_ROW, border: `1px solid ${BORDER}`, outline: "none" }}
                  value={editExpiry}
                  onChange={(e) => setEditExpiry(e.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setEditingOrder(null)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
                style={{ background: BG_ROW, color: MUTED }}
              >
                Cancel
              </button>
              <button
                onClick={handleEditSave}
                disabled={isUpdating}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold"
                style={{ background: STUDIO_CYAN, color: "hsl(var(--primary-foreground))" }}
              >
                {isUpdating ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Adjust Credits dialog */}
      {canAdjustCredits && adjustingOrder && (
        <AdjustCreditsDialog order={adjustingOrder} onClose={() => setAdjustingOrder(null)} />
      )}
      {canManageRefunds && refundingOrder && <RefundDialog order={refundingOrder} onClose={() => setRefundingOrder(null)} />}

      {/* Activate Package dialog */}
      {canApprove && activatingOrder && (
        <ActivatePackageDialog
          order={activatingOrder}
          onClose={() => { setActivatingOrder(null); setActivateError(""); }}
          onActivate={handleActivateConfirm}
          isPending={isActivating}
          errorMessage={activateError}
          amountEgp={activationAmount}
          amountLoading={activationAmountLoading}
        />
      )}
    </div>
  );
}
