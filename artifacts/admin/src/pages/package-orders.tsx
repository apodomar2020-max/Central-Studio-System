import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListPackageOrders,
  useUpdatePackageOrder,
  useDeletePackageOrder,
  getListPackageOrdersQueryKey,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, Clock, XCircle, Trash2, Edit2, CreditCard, User2 } from "lucide-react";

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  pendingPayment: { label: "Pending", color: "#F59E0B", icon: Clock },
  active: { label: "Active", color: "#22C55E", icon: CheckCircle2 },
  cancelled: { label: "Cancelled", color: "#EF4444", icon: XCircle },
  fullyUsed: { label: "Fully Used", color: "#6B7280", icon: CreditCard },
};

const STUDIO_CYAN = "#00B6D7";
const AMBER = "#F59E0B";

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, color: "#8A9AB0", icon: CreditCard };
  const Icon = cfg.icon;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium"
      style={{ backgroundColor: cfg.color + "20", color: cfg.color }}
    >
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

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

export default function PackageOrders() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [editingOrder, setEditingOrder] = useState<PackageOrder | null>(null);
  const [editNotes, setEditNotes] = useState("");
  const [editExpiry, setEditExpiry] = useState("");

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
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPackageOrdersQueryKey() });
      },
    },
  });

  function handleActivate(order: PackageOrder) {
    if (!confirm(`Activate "${order.packageName}" for ${order.studentName}?`)) return;
    const expiry = new Date();
    expiry.setMonth(expiry.getMonth() + 3);
    updateOrder({
      id: order.id,
      data: {
        status: "active",
        activatedAt: new Date().toISOString(),
        expiresAt: expiry.toISOString(),
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
      data: {
        notes: editNotes || null,
        expiresAt: editExpiry ? new Date(editExpiry).toISOString() : null,
      },
    });
  }

  const statusFilters = ["all", "pendingPayment", "active", "fullyUsed", "cancelled"];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Package Orders</h1>
          <p className="mt-1 text-sm" style={{ color: "#8A9AB0" }}>
            Manage student package requests and activations
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold" style={{ color: AMBER }}>
            {(orders as PackageOrder[]).filter((o) => o.status === "pendingPayment").length} pending
          </span>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {statusFilters.map((f) => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
            style={
              statusFilter === f
                ? { backgroundColor: STUDIO_CYAN, color: "#000" }
                : { backgroundColor: "hsl(203 30% 14%)", color: "#8A9AB0" }
            }
          >
            {f === "all" ? "All" : STATUS_CONFIG[f]?.label ?? f}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(203 30% 16%)" }}>
        <table className="w-full text-sm">
          <thead style={{ background: "hsl(203 30% 10%)" }}>
            <tr>
              {["Student", "Package", "Credits", "Status", "Requested", "Actions"].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: "#4E6070" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} style={{ borderTop: "1px solid hsl(203 30% 12%)" }}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <Skeleton className="h-4 w-full" style={{ background: "hsl(203 30% 14%)" }} />
                      </td>
                    ))}
                  </tr>
                ))
              : (orders as PackageOrder[]).length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm" style={{ color: "#4E6070" }}>
                    No package orders found
                  </td>
                </tr>
              ) : (
                (orders as PackageOrder[]).map((order) => (
                  <tr key={order.id} className="transition-colors hover:bg-white/[0.02]" style={{ borderTop: "1px solid hsl(203 30% 12%)" }}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{order.studentName}</div>
                      <div className="text-xs mt-0.5" style={{ color: "#8A9AB0" }}>{order.studentEmail}</div>
                      {order.studentPhone && (
                        <div className="text-xs" style={{ color: "#4E6070" }}>{order.studentPhone}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{order.packageName}</div>
                      {order.expiresAt && (
                        <div className="text-xs mt-0.5" style={{ color: "#8A9AB0" }}>
                          Expires {new Date(order.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium" style={{ color: STUDIO_CYAN }}>
                        {order.remainingCredits}
                        <span className="text-xs font-normal ml-1" style={{ color: "#4E6070" }}>/ {order.totalCredits}</span>
                      </div>
                      <div className="w-24 h-1.5 rounded-full mt-1 overflow-hidden" style={{ background: "hsl(203 30% 14%)" }}>
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.round((order.remainingCredits / order.totalCredits) * 100)}%`,
                            background: STUDIO_CYAN,
                          }}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={order.status} />
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: "#8A9AB0" }}>
                      {new Date(order.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {order.status === "pendingPayment" && (
                          <button
                            onClick={() => handleActivate(order)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                            style={{ backgroundColor: "#22C55E20", color: "#22C55E" }}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Activate
                          </button>
                        )}
                        <button
                          onClick={() => handleEditOpen(order)}
                          className="p-1.5 rounded-lg transition-colors"
                          style={{ color: "#8A9AB0" }}
                          title="Edit notes/expiry"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        {order.status !== "cancelled" && (
                          <button
                            onClick={() => handleCancel(order)}
                            className="p-1.5 rounded-lg transition-colors"
                            style={{ color: "#F59E0B" }}
                            title="Cancel order"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(order.id)}
                          className="p-1.5 rounded-lg transition-colors"
                          style={{ color: "#EF444480" }}
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
          </tbody>
        </table>
      </div>

      {/* Edit modal */}
      {editingOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setEditingOrder(null)}>
          <div
            className="w-full max-w-md rounded-2xl p-6 space-y-5"
            style={{ background: "hsl(203 28% 10%)", border: "1px solid hsl(203 30% 16%)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: `${STUDIO_CYAN}20` }}>
                <User2 className="h-5 w-5" style={{ color: STUDIO_CYAN }} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">{editingOrder.studentName}</h2>
                <p className="text-sm" style={{ color: "#8A9AB0" }}>{editingOrder.packageName}</p>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: "#8A9AB0" }}>Notes</label>
                <textarea
                  className="w-full rounded-xl px-3 py-2.5 text-sm text-white resize-none"
                  style={{ background: "hsl(203 30% 14%)", border: "1px solid hsl(203 30% 20%)", outline: "none" }}
                  rows={3}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Add notes..."
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: "#8A9AB0" }}>Expiry Date</label>
                <input
                  type="date"
                  className="w-full rounded-xl px-3 py-2.5 text-sm text-white"
                  style={{ background: "hsl(203 30% 14%)", border: "1px solid hsl(203 30% 20%)", outline: "none", colorScheme: "dark" }}
                  value={editExpiry}
                  onChange={(e) => setEditExpiry(e.target.value)}
                />
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setEditingOrder(null)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
                style={{ background: "hsl(203 30% 16%)", color: "#8A9AB0" }}
              >
                Cancel
              </button>
              <button
                onClick={handleEditSave}
                disabled={isUpdating}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-colors"
                style={{ background: STUDIO_CYAN, color: "#000" }}
              >
                {isUpdating ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
