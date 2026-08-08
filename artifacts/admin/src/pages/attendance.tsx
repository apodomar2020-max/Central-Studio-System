import { useEffect, useState } from "react";
import { useSearch } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useListPackageOrders,
  useCheckIn,
  useGetAttendanceStats,
  getListAttendanceQueryKey,
} from "@workspace/api-client-react";
import type { Attendance } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  QrCode,
  Search,
  CheckCircle2,
  CreditCard,
  User2,
  BarChart3,
  Clock,
  XCircle,
  Ban,
  TrendingUp,
  Users,
  CalendarDays,
} from "lucide-react";
import { UnifiedAttendanceDialog } from "@/components/unified-attendance-dialog";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { TablePagination } from "@/components/shared/table-pagination";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
const API_KEY = (import.meta.env.VITE_API_KEY as string | undefined) ?? "";

function makeHeaders(token?: string | null): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(API_KEY ? { "x-api-key": API_KEY } : {}),
    ...(token ? { "x-admin-token": token } : {}),
  };
}

const STUDIO_CYAN = "#00B6D7";
const AMBER = "#F59E0B";
const GREEN = "#22C55E";
const RED = "#EF4444";
const BG_CARD = "hsl(var(--card))";
const BG_ROW = "hsl(var(--muted) / 0.5)";
const BORDER = "hsl(var(--border))";
const BORDER_SUBTLE = "hsl(var(--border) / 0.6)";
const MUTED = "hsl(var(--muted-foreground))";
const MUTED_DARK = "hsl(var(--muted-foreground) / 0.68)";

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; icon: React.ElementType }
> = {
  checked_in: { label: "Checked In", color: GREEN, icon: CheckCircle2 },
  late: { label: "Late", color: AMBER, icon: Clock },
  absent: { label: "Absent", color: RED, icon: XCircle },
  cancelled: { label: "Cancelled", color: MUTED_DARK, icon: Ban },
};

function StatusBadge({ status }: { status?: string | null }) {
  const cfg = STATUS_CONFIG[status ?? "checked_in"] ?? STATUS_CONFIG.checked_in;
  const Icon = cfg.icon;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border"
      style={{
        backgroundColor: `${cfg.color}15`,
        borderColor: `${cfg.color}30`,
        color: cfg.color,
      }}
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
  packageName: string;
  totalCredits: number;
  remainingCredits: number;
  status: string;
  expiresAt?: string | null;
};

const CHECK_IN_STATUSES = ["checked_in", "late", "absent"] as const;
type CheckInStatus = (typeof CHECK_IN_STATUSES)[number];

const ATTENDANCE_PAGE_SIZE = 25;

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AttendancePage() {
  const { can, token } = useAdminAuth();
  const canScan = can("qr", "scan");
  const canManualCheckIn = can("attendance", "checkIn");
  const canPackageDeduct = can("qr", "packageDeduct");
  const canConfirmPayments = can("finance", "paymentsConfirm");
  const queryClient = useQueryClient();
  const [gatewayOpen, setGatewayOpen] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [searchEmail, setSearchEmail] = useState("");
  const [selectedPackageId, setSelectedPackageId] = useState<number | null>(null);
  const [classTitle, setClassTitle] = useState("");
  const [walkInSettlement, setWalkInSettlement] = useState<
    "package_credit" | "pay_at_studio" | "not_paid" | null
  >(null);
  const [checkInStatus, setCheckInStatus] = useState<CheckInStatus>("checked_in");
  const [period, setPeriod] = useState<"daily" | "monthly" | "yearly">("monthly");
  const [successMsg, setSuccessMsg] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const urlSearch = useSearch();

  const [scheduleIdFilter, setScheduleIdFilter] = useState<number | null>(null);
  const [dateFilter, setDateFilter] = useState<string | null>(null);

  // Deep-link support: /attendance?studentEmail=x@y.com or /attendance?scheduleId=X&date=YYYY-MM-DD
  useEffect(() => {
    const params = new URLSearchParams(urlSearch);
    const email = params.get("studentEmail");
    if (email) {
      setEmailInput(email);
      setSearchEmail(email.trim().toLowerCase());
    }
    const schedId = params.get("scheduleId");
    if (schedId && /^\d+$/.test(schedId)) setScheduleIdFilter(Number(schedId));

    const dt = params.get("date");
    if (dt && /^\d{4}-\d{2}-\d{2}$/.test(dt)) setDateFilter(dt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [attendancePage, setAttendancePage] = useState(1);

  // Any filter that affects the list resets pagination to page 1.
  useEffect(() => {
    setAttendancePage(1);
  }, [searchEmail, statusFilter, scheduleIdFilter, dateFilter]);

  const attendanceQuery = useQuery({
    queryKey: [
      ...getListAttendanceQueryKey(),
      {
        searchEmail,
        statusFilter,
        scheduleIdFilter,
        dateFilter,
        page: attendancePage,
        pageSize: ATTENDANCE_PAGE_SIZE,
        paginated: true,
      },
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(attendancePage),
        pageSize: String(ATTENDANCE_PAGE_SIZE),
        ...(searchEmail ? { studentEmail: searchEmail } : {}),
        ...(statusFilter !== "all" ? { status: statusFilter } : {}),
        ...(scheduleIdFilter != null ? { scheduleId: String(scheduleIdFilter) } : {}),
        ...(dateFilter ? { date: dateFilter } : {}),
      });
      const res = await fetch(`${API_BASE}/api/attendance?${params}`, {
        headers: makeHeaders(token),
      });
      if (!res.ok) throw new Error("Failed to load attendance");
      const records = (await res.json()) as Attendance[];
      return {
        records,
        total: Number(res.headers.get("X-Total-Count") ?? records.length),
        totalPages: Number(res.headers.get("X-Total-Pages") ?? 1),
      };
    },
  });
  const allAttendance = attendanceQuery.data?.records ?? [];
  const attendanceTotal = attendanceQuery.data?.total ?? 0;
  const attendanceTotalPages = attendanceQuery.data?.totalPages ?? 0;
  const attendanceLoading = attendanceQuery.isLoading;
  const { data: packageOrders = [] } = useListPackageOrders(undefined);
  const { data: stats } = useGetAttendanceStats({ period });

  const { mutate: checkIn, isPending: isCheckingIn } = useCheckIn({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getListAttendanceQueryKey() });
        const statusLabel = STATUS_CONFIG[checkInStatus]?.label ?? checkInStatus;
        setSuccessMsg(
          `✓ ${data.studentName} marked as ${statusLabel}${
            walkInSettlement === "package_credit" ? " — 1 credit deducted" : ""
          }`,
        );
        setTimeout(() => setSuccessMsg(""), 5000);
        setSelectedPackageId(null);
        setClassTitle("");
        setCheckInStatus("checked_in");
        setWalkInSettlement(null);
      },
    },
  });

  const studentOrders = (packageOrders as PackageOrder[]).filter(
    (o) => o.studentEmail === searchEmail && o.status === "active" && o.remainingCredits > 0,
  );

  const filteredAttendance = (allAttendance as Attendance[]).filter((r) =>
    statusFilter === "all" ? true : r.status === statusFilter,
  );

  function handleSearch() {
    setSearchEmail(emailInput.trim().toLowerCase());
    setSelectedPackageId(null);
    setSuccessMsg("");
    setStatusFilter("all");
  }

  function handleCheckIn() {
    if (!canManualCheckIn || !searchEmail) return;
    const order = studentOrders.find((o) => o.id === selectedPackageId);
    if (checkInStatus !== "absent" && !walkInSettlement) return;
    if (checkInStatus !== "absent" && walkInSettlement === "package_credit" && !selectedPackageId)
      return;
    if (checkInStatus !== "absent" && walkInSettlement === "not_paid") {
      setSuccessMsg("Walk-in cancelled — marked Not Paid. No records were created.");
      setTimeout(() => setSuccessMsg(""), 5000);
      setSelectedPackageId(null);
      setClassTitle("");
      setCheckInStatus("checked_in");
      setWalkInSettlement(null);
      return;
    }
    checkIn({
      data: {
        studentEmail: searchEmail,
        studentName: order?.studentName ?? searchEmail,
        packageOrderId:
          checkInStatus !== "absent" && walkInSettlement === "package_credit"
            ? selectedPackageId
            : null,
        classTitle: classTitle || null,
        status: checkInStatus,
        notes: null,
        ...(checkInStatus !== "absent" ? { settlementMode: walkInSettlement! } : {}),
      },
    });
  }

  return (
    <div className="space-y-6">
      {/* ── Page Header ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: STUDIO_CYAN }} />
            <span
              className="text-[10px] font-semibold tracking-widest uppercase"
              style={{ color: `${STUDIO_CYAN}AA` }}
            >
              STUDIO & BALLET
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Attendance & Check-In
          </h1>
          <p className="mt-0.5 text-sm" style={{ color: MUTED }}>
            Check in Studio or Ballet students by QR scan, parent phone, or child name.
          </p>
        </div>

        {/* Unified Single "Scan QR" Primary Action Button */}
        {(canManualCheckIn || canScan) && (
          <button
            onClick={() => setGatewayOpen(true)}
            data-testid="button-scan-qr"
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold shadow-sm transition-all hover:opacity-90 active:scale-[0.99] shrink-0 self-start"
            style={{ background: STUDIO_CYAN, color: "hsl(var(--primary-foreground))" }}
          >
            <QrCode className="h-4 w-4" />
            Scan QR
          </button>
        )}
      </div>

      {/* Render Unified Attendance Dialog */}
      {canManualCheckIn && (
        <UnifiedAttendanceDialog
          open={gatewayOpen}
          onOpenChange={setGatewayOpen}
          canCheckIn={canManualCheckIn}
          canPackageDeduct={canPackageDeduct}
          canScan={canScan}
          canConfirmPayments={canConfirmPayments}
        />
      )}

      {/* ── Attendance Stats / Overview Summary Cards ── */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div
          className="rounded-xl p-4 space-y-1.5 border bg-card/90 shadow-sm"
          style={{ borderColor: BORDER_SUBTLE }}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Total Check-Ins
            </span>
            <div
              className="flex h-7 w-7 items-center justify-center rounded-lg"
              style={{ background: `${STUDIO_CYAN}18` }}
            >
              <TrendingUp className="h-3.5 w-3.5" style={{ color: STUDIO_CYAN }} />
            </div>
          </div>
          <div className="text-2xl font-bold text-foreground">
            {stats?.total ?? attendanceTotal}
          </div>
          <p className="text-xs text-muted-foreground">
            {period === "daily" ? "Last 7 days" : period === "monthly" ? "Last 6 months" : "Last 3 years"}
          </p>
        </div>

        <div
          className="rounded-xl p-4 space-y-1.5 border bg-card/90 shadow-sm"
          style={{ borderColor: BORDER_SUBTLE }}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Stats Window
            </span>
            <div
              className="flex h-7 w-7 items-center justify-center rounded-lg"
              style={{ background: `${STUDIO_CYAN}18` }}
            >
              <CalendarDays className="h-3.5 w-3.5" style={{ color: STUDIO_CYAN }} />
            </div>
          </div>
          <div className="text-2xl font-bold text-foreground">
            {period === "daily" ? "7 Days" : period === "monthly" ? "6 Months" : "3 Years"}
          </div>
          <p className="text-xs text-muted-foreground">Active period selector</p>
        </div>

        <div
          className="rounded-xl p-4 space-y-1.5 border bg-card/90 shadow-sm"
          style={{ borderColor: BORDER_SUBTLE }}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Total Logged Records
            </span>
            <div
              className="flex h-7 w-7 items-center justify-center rounded-lg"
              style={{ background: `${STUDIO_CYAN}18` }}
            >
              <Users className="h-3.5 w-3.5" style={{ color: STUDIO_CYAN }} />
            </div>
          </div>
          <div className="text-2xl font-bold text-foreground">
            {attendanceTotal}
          </div>
          <p className="text-xs text-muted-foreground">All-time database records</p>
        </div>
      </div>

      {/* ── Main Two-Column Layout ── */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Left Column: Check-in Panel & Chart ── */}
        <div className="space-y-6">
          {/* Manual Student Check-in panel */}
          {canManualCheckIn && (
            <div
              className="rounded-xl p-5 space-y-4 border bg-card/90 shadow-sm"
              style={{ borderColor: BORDER }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-lg"
                    style={{ background: `${STUDIO_CYAN}20` }}
                  >
                    <Users className="h-4 w-4" style={{ color: STUDIO_CYAN }} />
                  </div>
                  <h2 className="text-sm font-semibold text-foreground">Manual Student Check-In</h2>
                </div>
                <span className="text-xs text-muted-foreground">Email Lookup</span>
              </div>

              {successMsg && (
                <div
                  className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium"
                  style={{ background: `${GREEN}15`, color: GREEN, border: `1px solid ${GREEN}30` }}
                >
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
                  className="flex-1 rounded-xl px-3.5 py-2.5 text-sm text-foreground"
                  style={{ background: BG_ROW, border: `1px solid ${BORDER}`, outline: "none" }}
                />
                <button
                  onClick={handleSearch}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-1.5 transition-opacity hover:opacity-90"
                  style={{ background: STUDIO_CYAN, color: "hsl(var(--primary-foreground))" }}
                  title="Look up student"
                >
                  <Search className="h-4 w-4" />
                  Search
                </button>
              </div>

              {searchEmail && (
                <div className="space-y-4 pt-1">
                  {/* Status selector */}
                  <div>
                    <p
                      className="text-xs font-semibold uppercase tracking-wider mb-2"
                      style={{ color: MUTED }}
                    >
                      Attendance Status
                    </p>
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
                                ? {
                                    background: `${cfg.color}20`,
                                    border: `1px solid ${cfg.color}50`,
                                    color: cfg.color,
                                  }
                                : {
                                    background: BG_ROW,
                                    border: `1px solid ${BORDER_SUBTLE}`,
                                    color: MUTED,
                                  }
                            }
                          >
                            <cfg.icon className="h-3.5 w-3.5" />
                            {cfg.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Active packages */}
                  {studentOrders.length === 0 ? (
                    <div
                      className="text-sm px-3.5 py-2.5 rounded-xl"
                      style={{ background: `${AMBER}10`, color: AMBER, border: `1px solid ${AMBER}25` }}
                    >
                      No active packages for {searchEmail}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p
                        className="text-xs font-semibold uppercase tracking-wider"
                        style={{ color: MUTED }}
                      >
                        Active Packages
                      </p>
                      {studentOrders.map((order) => (
                        <button
                          key={order.id}
                          onClick={() =>
                            setSelectedPackageId(selectedPackageId === order.id ? null : order.id)
                          }
                          className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm text-left transition-all"
                          style={{
                            background: selectedPackageId === order.id ? `${STUDIO_CYAN}15` : BG_ROW,
                            border: `1px solid ${
                              selectedPackageId === order.id ? STUDIO_CYAN + "50" : BORDER_SUBTLE
                            }`,
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <CreditCard className="h-4 w-4" style={{ color: STUDIO_CYAN }} />
                            <span className="font-medium text-foreground">{order.packageName}</span>
                          </div>
                          <span className="text-xs font-semibold" style={{ color: STUDIO_CYAN }}>
                            {order.remainingCredits} left
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  <div>
                    <label
                      className="block text-xs font-semibold mb-1.5 uppercase tracking-wider"
                      style={{ color: MUTED }}
                    >
                      Class Title (optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Hip Hop Adults"
                      value={classTitle}
                      onChange={(e) => setClassTitle(e.target.value)}
                      className="w-full rounded-xl px-3.5 py-2.5 text-sm text-foreground"
                      style={{ background: BG_ROW, border: `1px solid ${BORDER}`, outline: "none" }}
                    />
                  </div>

                  {checkInStatus !== "absent" && (
                    <div>
                      <label
                        className="block text-xs font-semibold mb-1.5 uppercase tracking-wider"
                        style={{ color: MUTED }}
                      >
                        Settlement Method (required)
                      </label>
                      <div className="grid grid-cols-1 gap-2">
                        <button
                          type="button"
                          onClick={() => setWalkInSettlement("package_credit")}
                          className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm text-left transition-all"
                          style={{
                            background:
                              walkInSettlement === "package_credit" ? `${STUDIO_CYAN}15` : BG_ROW,
                            border: `1px solid ${
                              walkInSettlement === "package_credit" ? STUDIO_CYAN + "50" : BORDER
                            }`,
                          }}
                        >
                          <span className="font-medium text-foreground">Use Package Credit</span>
                        </button>
                        {walkInSettlement === "package_credit" && !selectedPackageId && (
                          <div
                            className="text-sm px-3 py-2.5 rounded-xl"
                            style={{
                              background: `${AMBER}10`,
                              color: AMBER,
                              border: `1px solid ${AMBER}25`,
                            }}
                          >
                            Select a package with available credit above.
                          </div>
                        )}
                        {canConfirmPayments && (
                          <button
                            type="button"
                            onClick={() => setWalkInSettlement("pay_at_studio")}
                            className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm text-left transition-all"
                            style={{
                              background:
                                walkInSettlement === "pay_at_studio" ? `${STUDIO_CYAN}15` : BG_ROW,
                              border: `1px solid ${
                                walkInSettlement === "pay_at_studio" ? STUDIO_CYAN + "50" : BORDER
                              }`,
                            }}
                          >
                            <span className="font-medium text-foreground">Pay at Studio</span>
                          </button>
                        )}
                        {walkInSettlement === "pay_at_studio" && (
                          <div
                            className="text-sm px-3 py-2.5 rounded-xl"
                            style={{
                              background: `${STUDIO_CYAN}10`,
                              color: STUDIO_CYAN,
                              border: `1px solid ${STUDIO_CYAN}25`,
                            }}
                          >
                            The single-class price will be charged. Package credits will not be used,
                            even if available.
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => setWalkInSettlement("not_paid")}
                          className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm text-left transition-all"
                          style={{
                            background:
                              walkInSettlement === "not_paid" ? `${STUDIO_CYAN}15` : BG_ROW,
                            border: `1px solid ${
                              walkInSettlement === "not_paid" ? STUDIO_CYAN + "50" : BORDER
                            }`,
                          }}
                        >
                          <span className="font-medium text-foreground">Not Paid</span>
                        </button>
                        {walkInSettlement === "not_paid" && (
                          <div
                            className="text-sm px-3 py-2.5 rounded-xl"
                            style={{
                              background: `${AMBER}10`,
                              color: AMBER,
                              border: `1px solid ${AMBER}25`,
                            }}
                          >
                            This walk-in will be cancelled — no attendance, booking, payment, or credit
                            records will be created.
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <button
                    onClick={handleCheckIn}
                    disabled={
                      isCheckingIn ||
                      (checkInStatus !== "absent" &&
                        (!walkInSettlement ||
                          (walkInSettlement === "package_credit" && !selectedPackageId)))
                    }
                    className="w-full py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-60 hover:opacity-90 active:scale-[0.99]"
                    style={{ background: STUDIO_CYAN, color: "hsl(var(--primary-foreground))" }}
                  >
                    {isCheckingIn
                      ? "Recording…"
                      : `Record ${STATUS_CONFIG[checkInStatus]?.label ?? "Check-In"}`}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Period Distribution Stats Panel */}
          <div
            className="rounded-xl p-5 space-y-4 border bg-card/90 shadow-sm"
            style={{ borderColor: BORDER }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-lg"
                  style={{ background: `${STUDIO_CYAN}20` }}
                >
                  <BarChart3 className="h-4 w-4" style={{ color: STUDIO_CYAN }} />
                </div>
                <h2 className="text-sm font-semibold text-foreground">Attendance Distribution</h2>
              </div>
              <div className="flex gap-1">
                {(["daily", "monthly", "yearly"] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    className="px-3 py-1 rounded-lg text-xs font-medium capitalize transition-all"
                    style={
                      period === p
                        ? { background: STUDIO_CYAN, color: "hsl(var(--primary-foreground))" }
                        : { background: BG_ROW, color: MUTED }
                    }
                  >
                    {p === "daily" ? "7 Days" : p === "monthly" ? "6 Mo" : "3 Yr"}
                  </button>
                ))}
              </div>
            </div>

            {stats && (
              <>
                <div className="flex items-baseline justify-between pt-1">
                  <div className="text-2xl font-bold" style={{ color: STUDIO_CYAN }}>
                    {stats.total}
                    <span className="text-xs font-normal text-muted-foreground ml-2">
                      total check-ins in period
                    </span>
                  </div>
                </div>
                <div className="space-y-2.5 pt-2">
                  {stats.data.map((d) => {
                    const max = Math.max(...stats.data.map((x) => x.count), 1);
                    return (
                      <div key={d.label} className="flex items-center gap-3">
                        <span className="text-xs w-16 flex-shrink-0 text-muted-foreground">
                          {d.label}
                        </span>
                        <div
                          className="flex-1 h-2.5 rounded-full overflow-hidden"
                          style={{ background: BORDER_SUBTLE }}
                        >
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${(d.count / max) * 100}%`,
                              background: STUDIO_CYAN,
                            }}
                          />
                        </div>
                        <span className="text-xs font-semibold w-7 text-right text-foreground">
                          {d.count}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── Right Column: Recent Attendance Table ── */}
        <div
          className="rounded-xl overflow-hidden border bg-card/90 shadow-sm flex flex-col justify-between"
          style={{ borderColor: BORDER }}
        >
          <div>
            <div
              className="px-4 py-3.5 flex flex-wrap items-center justify-between gap-2 border-b"
              style={{ background: BG_CARD, borderColor: BORDER_SUBTLE }}
            >
              <div className="flex min-w-0 items-center gap-2">
                <User2 className="h-4 w-4 shrink-0" style={{ color: STUDIO_CYAN }} />
                <h2 className="truncate text-sm font-semibold text-foreground">
                  {searchEmail ? `Attendance — ${searchEmail}` : "Recent Check-Ins"}
                </h2>
              </div>
              {/* Status filter chips */}
              <div className="flex flex-wrap gap-1">
                {["all", "checked_in", "late", "absent"].map((f) => (
                  <button
                    key={f}
                    onClick={() => setStatusFilter(f)}
                    className="px-2.5 py-1 rounded-lg text-xs font-medium transition-all"
                    style={
                      statusFilter === f
                        ? { background: STUDIO_CYAN, color: "hsl(var(--primary-foreground))" }
                        : { background: BG_ROW, color: MUTED }
                    }
                  >
                    {f === "all" ? "All" : STATUS_CONFIG[f]?.label ?? f}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-auto max-h-[560px]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10" style={{ background: BG_ROW }}>
                  <tr>
                    {["Payer", "Participant", "Class", "Source", "Status", "Date"].map((h) => (
                      <th
                        key={h}
                        className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider"
                        style={{ color: MUTED_DARK }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {attendanceLoading ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i} style={{ borderTop: `1px solid ${BORDER_SUBTLE}` }}>
                        {Array.from({ length: 6 }).map((_, j) => (
                          <td key={j} className="px-4 py-3">
                            <Skeleton className="h-3.5 w-full" />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : filteredAttendance.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-sm text-muted-foreground">
                        No attendance records found
                      </td>
                    </tr>
                  ) : (
                    filteredAttendance.map((record) => (
                      <tr
                        key={record.id}
                        className="transition-colors hover:bg-muted/40"
                        style={{ borderTop: `1px solid ${BORDER_SUBTLE}` }}
                      >
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-foreground text-xs">
                            {record.payerName ?? record.studentName}
                          </div>
                          <div className="text-xs" style={{ color: MUTED_DARK }}>
                            {record.studentEmail}
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-foreground text-xs">
                            {record.participantName ?? "Legacy"}
                          </div>
                          <div
                            className="text-[10px] uppercase tracking-wide"
                            style={{
                              color:
                                record.participantType === "child" ? STUDIO_CYAN : MUTED_DARK,
                            }}
                          >
                            {record.participantType === "child"
                              ? "Child"
                              : record.participantType === "self"
                                ? "Myself"
                                : "Unassigned"}
                          </div>
                        </td>
                        <td
                          className="px-4 py-2.5 text-xs max-w-[120px] truncate"
                          style={{ color: "#9CA3AF" }}
                        >
                          {record.classTitle ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 text-xs whitespace-nowrap" style={{ color: MUTED }}>
                          <div>
                            {record.attendanceSource === "walk_in"
                              ? "Walk-in"
                              : record.attendanceSource === "booking"
                                ? "Booking"
                                : "Legacy"}
                          </div>
                          <div className="text-[10px]" style={{ color: MUTED_DARK }}>
                            {record.paymentSource?.replaceAll("_", " ") ??
                              (record.creditDeducted ? "package credit" : "—")}
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusBadge status={record.status} />
                        </td>
                        <td
                          className="px-4 py-2.5 text-xs whitespace-nowrap"
                          style={{ color: MUTED }}
                        >
                          {new Date(record.checkedInAt).toLocaleString("en-GB", {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          {attendanceTotal > 0 && (
            <div className="p-3 border-t bg-card" style={{ borderColor: BORDER_SUBTLE }}>
              <TablePagination
                page={attendancePage}
                totalPages={attendanceTotalPages}
                total={attendanceTotal}
                pageSize={ATTENDANCE_PAGE_SIZE}
                isLoading={attendanceLoading}
                itemLabel="check-ins"
                onPageChange={setAttendancePage}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
