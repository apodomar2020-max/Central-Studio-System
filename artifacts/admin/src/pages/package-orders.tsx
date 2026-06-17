import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListPackageOrders,
  useUpdatePackageOrder,
  useDeletePackageOrder,
  useAdjustCredits,
  useListCreditTransactions,
  getListPackageOrdersQueryKey,
  getListCreditTransactionsQueryKey,
} from "@workspace/api-client-react";
import type { AdjustCreditsBody } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CheckCircle2, Clock, XCircle, Trash2, Edit2, CreditCard,
  User2, BookOpen, Plus, Minus, ChevronDown, ChevronUp, Coins,
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

const STUDIO_CYAN = "#00B6D7";
const AMBER = "#F59E0B";
const BG_CARD = "hsl(203 28% 10%)";
const BG_ROW = "hsl(203 30% 12%)";
const BORDER = "hsl(203 30% 16%)";
const MUTED = "#8A9AB0";
const MUTED_DARK = "#4E6070";

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
};

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

// ─── Adjust Credits Dialog ────────────────────────────────────────────────────

function AdjustCreditsDialog({
  order,
  onClose,
}: {
  order: PackageOrder;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [type, setType] = useState<AdjustCreditsBody["type"]>("manual_adjustment");
  const [rawDelta, setRawDelta] = useState("");
  const [notes, setNotes] = useState("");

  const delta = parseInt(rawDelta, 10);
  const isValidDelta = !isNaN(delta) && delta !== 0;
  const newBalance = isValidDelta ? order.remainingCredits + delta : order.remainingCredits;
  const balanceSafe = newBalance >= 0;

  const { mutate, isPending } = useAdjustCredits({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPackageOrdersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListCreditTransactionsQueryKey({ packageOrderId: order.id }) });
        onClose();
      },
    },
  });

  function handleSubmit() {
    if (!isValidDelta || !balanceSafe) return;
    mutate({ id: order.id, data: { type, delta, notes: notes.trim() || undefined } });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl p-6 space-y-5"
        style={{ background: BG_CARD, border: `1px solid ${BORDER}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: `${STUDIO_CYAN}20` }}>
            <Coins className="h-5 w-5" style={{ color: STUDIO_CYAN }} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Adjust Credits</h2>
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
          {/* Type selector */}
          <div>
            <label className="block text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: MUTED }}>Type</label>
            <div className="grid grid-cols-2 gap-2">
              {(["manual_adjustment", "package_bonus"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className="px-3 py-2 rounded-xl text-xs font-semibold transition-all"
                  style={
                    type === t
                      ? { background: `${STUDIO_CYAN}20`, border: `1px solid ${STUDIO_CYAN}60`, color: STUDIO_CYAN }
                      : { background: BG_ROW, border: `1px solid ${BORDER}`, color: MUTED }
                  }
                >
                  {t === "manual_adjustment" ? "Manual Adjustment" : "Bonus Credits"}
                </button>
              ))}
            </div>
          </div>

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
                <Minus className="h-3.5 w-3.5 text-white" />
              </button>
              <input
                type="number"
                value={rawDelta}
                onChange={(e) => setRawDelta(e.target.value)}
                placeholder="e.g. +5 or -2"
                className="flex-1 rounded-xl px-3 py-2 text-sm text-center text-white"
                style={{ background: BG_ROW, border: `1px solid ${BORDER}`, outline: "none" }}
              />
              <button
                onClick={() => setRawDelta((v) => String((parseInt(v, 10) || 0) + 1))}
                className="flex h-9 w-9 items-center justify-center rounded-xl flex-shrink-0"
                style={{ background: BG_ROW, border: `1px solid ${BORDER}` }}
              >
                <Plus className="h-3.5 w-3.5 text-white" />
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
              className="w-full rounded-xl px-3 py-2.5 text-sm text-white resize-none"
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
            disabled={isPending || !isValidDelta || !balanceSafe}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-colors disabled:opacity-40"
            style={{ background: STUDIO_CYAN, color: "#000" }}
          >
            {isPending ? "Applying…" : "Apply"}
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
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-4 w-full" style={{ background: BG_ROW }} />)}
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
              <thead style={{ background: "hsl(203 30% 9%)" }}>
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

export default function PackageOrders() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [editingOrder, setEditingOrder] = useState<PackageOrder | null>(null);
  const [editNotes, setEditNotes] = useState("");
  const [editExpiry, setEditExpiry] = useState("");
  const [adjustingOrder, setAdjustingOrder] = useState<PackageOrder | null>(null);
  const [expandedLedger, setExpandedLedger] = useState<number | null>(null);

  const { data: orders = [], isLoading } = useListPackageOrders(
    statusFilter !== "all" ? { status: statusFilter } : undefined
  );

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

  function handleActivate(order: PackageOrder) {
    if (!confirm(`Activate "${order.packageName}" for ${order.studentName}?`)) return;
    const expiry = new Date();
    expiry.setMonth(expiry.getMonth() + 3);
    updateOrder({
      id: order.id,
      data: { status: "active", activatedAt: new Date().toISOString(), expiresAt: expiry.toISOString() },
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
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Package Orders</h1>
          <p className="mt-1 text-sm" style={{ color: MUTED }}>Manage student package requests and activations</p>
        </div>
        <span className="text-xs font-semibold" style={{ color: AMBER }}>
          {(orders as PackageOrder[]).filter((o) => o.status === "pendingPayment").length} pending
        </span>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {statusFilters.map((f) => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
            style={statusFilter === f ? { backgroundColor: STUDIO_CYAN, color: "#000" } : { backgroundColor: BG_ROW, color: MUTED }}
          >
            {f === "all" ? "All" : STATUS_CONFIG[f]?.label ?? f}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
        <table className="w-full text-sm">
          <thead style={{ background: "hsl(203 30% 10%)" }}>
            <tr>
              {["Student", "Package", "Credits", "Status", "Requested", "Ledger", "Actions"].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED_DARK }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} style={{ borderTop: `1px solid hsl(203 30% 12%)` }}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <Skeleton className="h-4 w-full" style={{ background: BG_ROW }} />
                      </td>
                    ))}
                  </tr>
                ))
              : (orders as PackageOrder[]).length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm" style={{ color: MUTED_DARK }}>
                    No package orders found
                  </td>
                </tr>
              ) : (
                (orders as PackageOrder[]).flatMap((order) => {
                  const rows = [
                    <tr
                      key={`order-${order.id}`}
                      className="transition-colors hover:bg-white/[0.02]"
                      style={{ borderTop: `1px solid hsl(203 30% 12%)` }}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-white">{order.studentName}</div>
                        <div className="text-xs mt-0.5" style={{ color: MUTED }}>{order.studentEmail}</div>
                        {order.studentPhone && <div className="text-xs" style={{ color: MUTED_DARK }}>{order.studentPhone}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-white">{order.packageName}</div>
                        {order.expiresAt && (
                          <div className="text-xs mt-0.5" style={{ color: MUTED }}>
                            Expires {new Date(order.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium" style={{ color: STUDIO_CYAN }}>
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
                      {/* Ledger toggle */}
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setExpandedLedger((prev) => (prev === order.id ? null : order.id))}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-colors"
                          style={{ background: `${STUDIO_CYAN}15`, color: STUDIO_CYAN }}
                        >
                          <BookOpen className="h-3 w-3" />
                          {expandedLedger === order.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        </button>
                      </td>
                      {/* Actions */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 flex-wrap">
                          {order.status === "pendingPayment" && (
                            <button
                              onClick={() => handleActivate(order)}
                              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-semibold"
                              style={{ backgroundColor: "#22C55E20", color: "#22C55E" }}
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              Activate
                            </button>
                          )}
                          {(order.status === "active" || order.status === "fullyUsed") && (
                            <button
                              onClick={() => setAdjustingOrder(order)}
                              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-semibold"
                              style={{ backgroundColor: `${STUDIO_CYAN}20`, color: STUDIO_CYAN }}
                              title="Adjust credits"
                            >
                              <Coins className="h-3 w-3" />
                              Credits
                            </button>
                          )}
                          <button
                            onClick={() => handleEditOpen(order)}
                            className="p-1.5 rounded-lg"
                            style={{ color: MUTED }}
                            title="Edit notes/expiry"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          {order.status !== "cancelled" && (
                            <button
                              onClick={() => handleCancel(order)}
                              className="p-1.5 rounded-lg"
                              style={{ color: AMBER }}
                              title="Cancel order"
                            >
                              <XCircle className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => handleDelete(order.id)}
                            className="p-1.5 rounded-lg"
                            style={{ color: "#EF444480" }}
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>,
                  ];

                  if (expandedLedger === order.id) {
                    rows.push(<LedgerPanel key={`ledger-${order.id}`} orderId={order.id} />);
                  }

                  return rows;
                })
              )}
          </tbody>
        </table>
      </div>

      {/* Edit modal */}
      {editingOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setEditingOrder(null)}>
          <div
            className="w-full max-w-md rounded-2xl p-6 space-y-5"
            style={{ background: BG_CARD, border: `1px solid ${BORDER}` }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: `${STUDIO_CYAN}20` }}>
                <User2 className="h-5 w-5" style={{ color: STUDIO_CYAN }} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">{editingOrder.studentName}</h2>
                <p className="text-sm" style={{ color: MUTED }}>{editingOrder.packageName}</p>
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: MUTED }}>Notes</label>
                <textarea
                  className="w-full rounded-xl px-3 py-2.5 text-sm text-white resize-none"
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
                  className="w-full rounded-xl px-3 py-2.5 text-sm text-white"
                  style={{ background: BG_ROW, border: `1px solid ${BORDER}`, outline: "none", colorScheme: "dark" }}
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
                style={{ background: STUDIO_CYAN, color: "#000" }}
              >
                {isUpdating ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Adjust Credits dialog */}
      {adjustingOrder && (
        <AdjustCreditsDialog order={adjustingOrder} onClose={() => setAdjustingOrder(null)} />
      )}
    </div>
  );
}
