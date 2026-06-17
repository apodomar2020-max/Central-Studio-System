import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAttendance,
  useListPackageOrders,
  useCheckIn,
  useGetAttendanceStats,
  getListAttendanceQueryKey,
} from "@workspace/api-client-react";
import type { Attendance } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { QrCode, Search, CheckCircle2, CreditCard, User2, BarChart3, Clock, XCircle, Ban } from "lucide-react";
import { ScanCheckInDialog } from "@/components/scan-check-in-dialog";

const STUDIO_CYAN = "#00B6D7";
const AMBER = "#F59E0B";
const GREEN = "#22C55E";
const BG_CARD = "hsl(203 28% 10%)";
const BG_ROW = "hsl(203 30% 14%)";
const BORDER = "hsl(203 30% 20%)";
const BORDER_SUBTLE = "hsl(203 30% 12%)";
const MUTED = "#8A9AB0";
const MUTED_DARK = "#4E6070";

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  checked_in: { label: "Checked In", color: GREEN,        icon: CheckCircle2 },
  late:       { label: "Late",        color: AMBER,        icon: Clock },
  absent:     { label: "Absent",      color: "#EF4444",    icon: XCircle },
  cancelled:  { label: "Cancelled",   color: MUTED_DARK,   icon: Ban },
};

function StatusBadge({ status }: { status?: string | null }) {
  const cfg = STATUS_CONFIG[status ?? "checked_in"] ?? STATUS_CONFIG.checked_in;
  const Icon = cfg.icon;
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-medium"
      style={{ backgroundColor: cfg.color + "20", color: cfg.color }}
    >
      <Icon className="h-2.5 w-2.5" />
      {cfg.label}
    </span>
  );
}

type PackageOrder = {
  id: number;
  studentName: string;
  studentEmail: string;
  packageName: string;
  totalCredits: number;
  remainingCredits: number;
  status: string;
  expiresAt?: string | null;
};

const CHECK_IN_STATUSES = ["checked_in", "late", "absent"] as const;
type CheckInStatus = typeof CHECK_IN_STATUSES[number];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AttendancePage() {
  const queryClient = useQueryClient();
  const [scanOpen, setScanOpen] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [searchEmail, setSearchEmail] = useState("");
  const [selectedPackageId, setSelectedPackageId] = useState<number | null>(null);
  const [classTitle, setClassTitle] = useState("");
  const [deductCredit, setDeductCredit] = useState(true);
  const [checkInStatus, setCheckInStatus] = useState<CheckInStatus>("checked_in");
  const [period, setPeriod] = useState<"daily" | "monthly" | "yearly">("monthly");
  const [successMsg, setSuccessMsg] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: allAttendance = [], isLoading: attendanceLoading } = useListAttendance(
    searchEmail ? { studentEmail: searchEmail } : undefined
  );
  const { data: packageOrders = [] } = useListPackageOrders(undefined);
  const { data: stats } = useGetAttendanceStats({ period });

  const { mutate: checkIn, isPending: isCheckingIn } = useCheckIn({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getListAttendanceQueryKey() });
        const statusLabel = STATUS_CONFIG[checkInStatus]?.label ?? checkInStatus;
        setSuccessMsg(`✓ ${data.studentName} marked as ${statusLabel}${deductCredit && selectedPackageId ? " — 1 credit deducted" : ""}`);
        setTimeout(() => setSuccessMsg(""), 5000);
        setSelectedPackageId(null);
        setClassTitle("");
        setCheckInStatus("checked_in");
      },
    },
  });

  const studentOrders = (packageOrders as PackageOrder[]).filter(
    (o) => o.studentEmail === searchEmail && o.status === "active" && o.remainingCredits > 0
  );

  const filteredAttendance = (allAttendance as Attendance[]).filter((r) =>
    statusFilter === "all" ? true : r.status === statusFilter
  );

  function handleSearch() {
    setSearchEmail(emailInput.trim().toLowerCase());
    setSelectedPackageId(null);
    setSuccessMsg("");
    setStatusFilter("all");
  }

  function handleCheckIn() {
    if (!searchEmail) return;
    const order = studentOrders.find((o) => o.id === selectedPackageId);
    const shouldDeduct = deductCredit && !!selectedPackageId && checkInStatus !== "absent";
    checkIn({
      data: {
        studentEmail: searchEmail,
        studentName: order?.studentName ?? searchEmail,
        packageOrderId: selectedPackageId,
        classTitle: classTitle || null,
        creditDeducted: shouldDeduct,
        status: checkInStatus,
        notes: null,
      },
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Attendance & Check-In</h1>
          <p className="mt-1 text-sm" style={{ color: MUTED }}>
            Check in students by QR scan or manual email lookup.
          </p>
        </div>
        <button
          onClick={() => setScanOpen(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold flex-shrink-0"
          style={{ background: STUDIO_CYAN, color: "#000" }}
        >
          <QrCode className="h-4 w-4" />
          Scan QR
        </button>
      </div>

      <ScanCheckInDialog open={scanOpen} onOpenChange={setScanOpen} />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Check-in panel ── */}
        <div className="space-y-4">
          <div className="rounded-xl p-5 space-y-4" style={{ background: BG_CARD, border: `1px solid ${BORDER}` }}>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: `${STUDIO_CYAN}20` }}>
                <QrCode className="h-4 w-4" style={{ color: STUDIO_CYAN }} />
              </div>
              <h2 className="text-sm font-semibold text-white">Student Check-In</h2>
            </div>

            {successMsg && (
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium"
                style={{ background: `${GREEN}15`, color: GREEN, border: `1px solid ${GREEN}30` }}>
                <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                {successMsg}
              </div>
            )}

            <div className="flex gap-2">
              <input
                type="email"
                placeholder="Enter student email..."
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="flex-1 rounded-xl px-3 py-2.5 text-sm text-white"
                style={{ background: BG_ROW, border: `1px solid ${BORDER}`, outline: "none" }}
              />
              <button
                onClick={handleSearch}
                className="px-3 py-2.5 rounded-xl"
                style={{ background: STUDIO_CYAN, color: "#000" }}
                title="Look up student"
              >
                <Search className="h-4 w-4" />
              </button>
            </div>

            {searchEmail && (
              <div className="space-y-3">
                {/* Status selector */}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: MUTED }}>Attendance Status</p>
                  <div className="flex gap-2">
                    {CHECK_IN_STATUSES.map((s) => {
                      const cfg = STATUS_CONFIG[s];
                      return (
                        <button
                          key={s}
                          onClick={() => setCheckInStatus(s)}
                          className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-xl text-xs font-semibold transition-all"
                          style={
                            checkInStatus === s
                              ? { background: `${cfg.color}20`, border: `1px solid ${cfg.color}50`, color: cfg.color }
                              : { background: BG_ROW, border: `1px solid ${BORDER_SUBTLE}`, color: MUTED }
                          }
                        >
                          <cfg.icon className="h-3 w-3" />
                          {cfg.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Active packages */}
                {studentOrders.length === 0 ? (
                  <div className="text-sm px-3 py-2.5 rounded-xl"
                    style={{ background: `${AMBER}10`, color: AMBER, border: `1px solid ${AMBER}25` }}>
                    No active packages for {searchEmail}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Active Packages</p>
                    {studentOrders.map((order) => (
                      <button
                        key={order.id}
                        onClick={() => setSelectedPackageId(selectedPackageId === order.id ? null : order.id)}
                        className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm text-left transition-all"
                        style={{
                          background: selectedPackageId === order.id ? `${STUDIO_CYAN}15` : BG_ROW,
                          border: `1px solid ${selectedPackageId === order.id ? STUDIO_CYAN + "50" : BORDER_SUBTLE}`,
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <CreditCard className="h-3.5 w-3.5" style={{ color: STUDIO_CYAN }} />
                          <span className="font-medium text-white">{order.packageName}</span>
                        </div>
                        <span className="text-xs font-semibold" style={{ color: STUDIO_CYAN }}>
                          {order.remainingCredits} left
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: MUTED }}>
                    Class Title (optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Hip Hop Adults"
                    value={classTitle}
                    onChange={(e) => setClassTitle(e.target.value)}
                    className="w-full rounded-xl px-3 py-2.5 text-sm text-white"
                    style={{ background: BG_ROW, border: `1px solid ${BORDER}`, outline: "none" }}
                  />
                </div>

                {selectedPackageId && checkInStatus !== "absent" && (
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={deductCredit}
                      onChange={(e) => setDeductCredit(e.target.checked)}
                      className="rounded"
                    />
                    <span className="text-sm" style={{ color: "#9CA3AF" }}>Deduct 1 credit from selected package</span>
                  </label>
                )}

                <button
                  onClick={handleCheckIn}
                  disabled={isCheckingIn}
                  className="w-full py-3 rounded-xl text-sm font-bold transition-colors disabled:opacity-60"
                  style={{ background: STUDIO_CYAN, color: "#000" }}
                >
                  {isCheckingIn
                    ? "Recording…"
                    : `Record ${STATUS_CONFIG[checkInStatus]?.label ?? "Check-In"}`}
                </button>
              </div>
            )}
          </div>

          {/* Stats panel */}
          <div className="rounded-xl p-5 space-y-4" style={{ background: BG_CARD, border: `1px solid ${BORDER}` }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: `${STUDIO_CYAN}20` }}>
                  <BarChart3 className="h-4 w-4" style={{ color: STUDIO_CYAN }} />
                </div>
                <h2 className="text-sm font-semibold text-white">Attendance Stats</h2>
              </div>
              <div className="flex gap-1">
                {(["daily", "monthly", "yearly"] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    className="px-2.5 py-1 rounded-lg text-xs font-medium capitalize transition-all"
                    style={period === p ? { background: STUDIO_CYAN, color: "#000" } : { background: BG_ROW, color: MUTED }}
                  >
                    {p === "daily" ? "7 Days" : p === "monthly" ? "6 Mo" : "3 Yr"}
                  </button>
                ))}
              </div>
            </div>
            {stats && (
              <>
                <div className="text-2xl font-bold" style={{ color: STUDIO_CYAN }}>
                  {stats.total}
                  <span className="text-sm font-normal ml-2" style={{ color: MUTED }}>total check-ins</span>
                </div>
                <div className="space-y-2">
                  {stats.data.map((d) => {
                    const max = Math.max(...stats.data.map((x) => x.count), 1);
                    return (
                      <div key={d.label} className="flex items-center gap-3">
                        <span className="text-xs w-16 flex-shrink-0" style={{ color: MUTED }}>{d.label}</span>
                        <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: BORDER_SUBTLE }}>
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${(d.count / max) * 100}%`, background: STUDIO_CYAN }}
                          />
                        </div>
                        <span className="text-xs font-semibold w-6 text-right text-white">{d.count}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── Recent attendance table ── */}
        <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
          <div className="px-4 py-3 flex items-center justify-between gap-2" style={{ background: "hsl(203 30% 10%)" }}>
            <div className="flex items-center gap-2">
              <User2 className="h-4 w-4" style={{ color: STUDIO_CYAN }} />
              <h2 className="text-sm font-semibold text-white">
                {searchEmail ? `Attendance — ${searchEmail}` : "Recent Check-Ins"}
              </h2>
            </div>
            {/* Status filter chips */}
            <div className="flex gap-1">
              {["all", "checked_in", "late", "absent"].map((f) => (
                <button
                  key={f}
                  onClick={() => setStatusFilter(f)}
                  className="px-2 py-0.5 rounded-md text-xs font-medium transition-all"
                  style={
                    statusFilter === f
                      ? { background: STUDIO_CYAN, color: "#000" }
                      : { background: BG_ROW, color: MUTED }
                  }
                >
                  {f === "all" ? "All" : STATUS_CONFIG[f]?.label ?? f}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-auto max-h-[520px]">
            <table className="w-full text-sm">
              <thead className="sticky top-0" style={{ background: "hsl(203 30% 9%)" }}>
                <tr>
                  {["Student", "Class", "Status", "Credit", "Date"].map((h) => (
                    <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED_DARK }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {attendanceLoading
                  ? Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i} style={{ borderTop: `1px solid ${BORDER_SUBTLE}` }}>
                        {Array.from({ length: 5 }).map((_, j) => (
                          <td key={j} className="px-4 py-3">
                            <Skeleton className="h-3.5 w-full" style={{ background: BG_ROW }} />
                          </td>
                        ))}
                      </tr>
                    ))
                  : filteredAttendance.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-sm" style={{ color: MUTED_DARK }}>
                        No attendance records yet
                      </td>
                    </tr>
                  ) : (
                    filteredAttendance.slice(0, 50).map((record) => (
                      <tr
                        key={record.id}
                        className="transition-colors hover:bg-white/[0.02]"
                        style={{ borderTop: `1px solid ${BORDER_SUBTLE}` }}
                      >
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-white text-xs">{record.studentName}</div>
                          <div className="text-xs" style={{ color: MUTED_DARK }}>{record.studentEmail}</div>
                        </td>
                        <td className="px-4 py-2.5 text-xs max-w-[120px] truncate" style={{ color: "#9CA3AF" }}>
                          {record.classTitle ?? "—"}
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusBadge status={record.status} />
                        </td>
                        <td className="px-4 py-2.5">
                          {record.creditDeducted ? (
                            <span className="text-xs font-medium" style={{ color: AMBER }}>−1</span>
                          ) : (
                            <span className="text-xs" style={{ color: MUTED_DARK }}>—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-xs whitespace-nowrap" style={{ color: MUTED }}>
                          {new Date(record.checkedInAt).toLocaleString("en-GB", {
                            day: "numeric", month: "short",
                            hour: "2-digit", minute: "2-digit",
                          })}
                        </td>
                      </tr>
                    ))
                  )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
