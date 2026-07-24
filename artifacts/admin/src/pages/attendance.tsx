import { useEffect, useState } from "react";
import { useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  useGetAttendanceStats,
  getListAttendanceQueryKey,
} from "@workspace/api-client-react";
import type { Attendance } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { QrCode, CheckCircle2, User2, BarChart3, Clock, XCircle, Ban } from "lucide-react";
import { UnifiedAttendanceDialog } from "@/components/unified-attendance-dialog";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { TablePagination } from "@/components/shared/table-pagination";

const API_BASE = import.meta.env.VITE_API_URL as string | undefined ?? "";
const API_KEY = import.meta.env.VITE_API_KEY as string | undefined ?? "";

function makeHeaders(token?: string | null): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(API_KEY ? { "x-api-key": API_KEY } : {}),
    ...(token ? { "x-admin-token": token } : {}),
  };
}

const STUDIO_CYAN = "#00B6D7";
const PURPLE = "#8B5CF6";
const AMBER = "#F59E0B";
const GREEN = "#22C55E";
const BG_CARD = "hsl(var(--card))";
const BG_ROW = "hsl(var(--muted))";
const BORDER = "hsl(var(--border))";
const BORDER_SUBTLE = "hsl(var(--border) / 0.72)";
const MUTED = "hsl(var(--muted-foreground))";
const MUTED_DARK = "hsl(var(--muted-foreground) / 0.68)";

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

function ProgramBadge({ program }: { program?: string }) {
  const isBallet = program === "ballet";
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold uppercase"
      style={{ backgroundColor: isBallet ? `${PURPLE}20` : `${STUDIO_CYAN}20`, color: isBallet ? PURPLE : STUDIO_CYAN }}
    >
      {isBallet ? "Ballet" : "Studio"}
    </span>
  );
}

/** Studio checked_in/late with a deducted credit → "1 Credit". Ballet
 *  checked_in/late/absent → duration ("60 min" / "1h" / "1h 30m"). Cancelled,
 *  or Studio without a deducted credit → "—". Never mixes the two systems. */
function UsageCell({ record }: { record: Attendance }) {
  if (record.status === "cancelled") {
    return <span className="text-xs" style={{ color: MUTED_DARK }}>—</span>;
  }
  if (record.program === "ballet") {
    const mins = record.durationMinutes;
    if (mins == null) return <span className="text-xs" style={{ color: MUTED_DARK }}>—</span>;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const label = h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${mins} min`;
    return <span className="text-xs font-medium" style={{ color: PURPLE }}>{label}</span>;
  }
  if (record.creditDeducted) {
    return <span className="text-xs font-medium" style={{ color: AMBER }}>1 Credit</span>;
  }
  if (record.status === "checked_in" || record.status === "late") {
    return <span className="text-xs" style={{ color: MUTED_DARK }}>Paid at Studio</span>;
  }
  return <span className="text-xs" style={{ color: MUTED_DARK }}>—</span>;
}

const ATTENDANCE_PAGE_SIZE = 25;

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AttendancePage() {
  const { can, token } = useAdminAuth();
  const canScan = can("qr", "scan");
  const canManualCheckIn = can("attendance", "checkIn");
  const canPackageDeduct = can("qr", "packageDeduct");
  const [gatewayOpen, setGatewayOpen] = useState(false);
  const [searchEmail, setSearchEmail] = useState("");
  const [period, setPeriod] = useState<"daily" | "monthly" | "yearly">("monthly");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const urlSearch = useSearch();

  // Deep-link support: /attendance?studentEmail=x@y.com filters the table
  // (used by the "View Attendance History" link on the admin 360 profile page).
  useEffect(() => {
    const email = new URLSearchParams(urlSearch).get("studentEmail");
    if (email) {
      setSearchEmail(email.trim().toLowerCase());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Recently Check-ins pagination (Phase 4C) ────────────────────────────
  // The backend GET /attendance already supports page/pageSize and returns
  // X-Total-Count / X-Total-Pages headers; the UI previously hardcoded
  // page 1 / pageSize 50. Raw header-aware fetch (same pattern as Package
  // Orders) because the generated hook cannot expose response headers. The
  // query key extends getListAttendanceQueryKey(), so the existing check-in
  // success invalidation keeps refreshing this list unchanged.
  const [attendancePage, setAttendancePage] = useState(1);

  // Any filter that affects the list resets pagination to page 1.
  useEffect(() => {
    setAttendancePage(1);
  }, [searchEmail, statusFilter]);

  const attendanceQuery = useQuery({
    queryKey: [
      ...getListAttendanceQueryKey(),
      { searchEmail, statusFilter, page: attendancePage, pageSize: ATTENDANCE_PAGE_SIZE, paginated: true },
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(attendancePage),
        pageSize: String(ATTENDANCE_PAGE_SIZE),
        ...(searchEmail ? { studentEmail: searchEmail } : {}),
        ...(statusFilter !== "all" ? { status: statusFilter } : {}),
      });
      const res = await fetch(`${API_BASE}/api/attendance?${params}`, {
        headers: makeHeaders(token),
      });
      if (!res.ok) throw new Error("Failed to load attendance");
      const records = await res.json() as Attendance[];
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
  const { data: stats } = useGetAttendanceStats({ period });

  const filteredAttendance = (allAttendance as Attendance[]).filter((r) =>
    statusFilter === "all" ? true : r.status === statusFilter
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Attendance & Check-In</h1>
          <p className="mt-1 text-sm" style={{ color: MUTED }}>
            Check in Studio or Ballet students by QR scan, parent phone, or child name.
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0 self-start">
          {canManualCheckIn && (
            <button
              onClick={() => setGatewayOpen(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold"
              style={{ background: STUDIO_CYAN, color: "hsl(var(--primary-foreground))" }}
            >
              <QrCode className="h-4 w-4" />
              Check In Student
            </button>
          )}
        </div>
      </div>

      {canManualCheckIn && (
        <UnifiedAttendanceDialog
          open={gatewayOpen}
          onOpenChange={setGatewayOpen}
          canCheckIn={canManualCheckIn}
          canPackageDeduct={canPackageDeduct}
          canScan={canScan}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Stats panel ── */}
        <div className="space-y-4">
          <div className="rounded-xl p-5 space-y-4" style={{ background: BG_CARD, border: `1px solid ${BORDER}` }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: `${STUDIO_CYAN}20` }}>
                  <BarChart3 className="h-4 w-4" style={{ color: STUDIO_CYAN }} />
                </div>
                <h2 className="text-sm font-semibold text-foreground">Attendance Stats</h2>
              </div>
              <div className="flex gap-1">
                {(["daily", "monthly", "yearly"] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    className="px-2.5 py-1 rounded-lg text-xs font-medium capitalize transition-all"
                    style={period === p ? { background: STUDIO_CYAN, color: "hsl(var(--primary-foreground))" } : { background: BG_ROW, color: MUTED }}
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
                  <span className="text-sm font-normal ml-2" style={{ color: MUTED }}>Attendance Records</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <StatChip label="Checked In" value={stats.checkedInCount} color={GREEN} />
                  <StatChip label="Late" value={stats.lateCount} color={AMBER} />
                  <StatChip label="Absent" value={stats.absentCount} color="#EF4444" />
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
                        <span className="text-xs font-semibold w-6 text-right text-foreground">{d.count}</span>
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
          <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-2" style={{ background: BG_CARD }}>
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
                  className="px-2 py-0.5 rounded-md text-xs font-medium transition-all"
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

          <div className="overflow-auto max-h-[520px]">
            <table className="w-full text-sm">
              <thead className="sticky top-0" style={{ background: BG_ROW }}>
                <tr>
                  {["Student", "Program", "Class", "Status", "Usage", "Date"].map((h) => (
                    <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED_DARK }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {attendanceLoading
                  ? Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i} style={{ borderTop: `1px solid ${BORDER_SUBTLE}` }}>
                        {Array.from({ length: 6 }).map((_, j) => (
                          <td key={j} className="px-4 py-3">
                        <Skeleton className="h-3.5 w-full" />
                          </td>
                        ))}
                      </tr>
                    ))
                  : filteredAttendance.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-sm" style={{ color: MUTED_DARK }}>
                        No attendance records yet
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
                          <div className="font-medium text-foreground text-xs">{record.studentName}</div>
                          <div className="text-xs" style={{ color: MUTED_DARK }}>{record.studentEmail}</div>
                        </td>
                        <td className="px-4 py-2.5">
                          <ProgramBadge program={record.program} />
                        </td>
                        <td className="px-4 py-2.5 text-xs max-w-[140px] truncate" style={{ color: "#9CA3AF" }}>
                          {record.classTitle ?? "—"}
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusBadge status={record.status} />
                        </td>
                        <td className="px-4 py-2.5">
                          <UsageCell record={record} />
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

        {/* Recently Check-ins pagination (Phase 4C) */}
        {attendanceTotal > 0 && (
          <TablePagination
            page={attendancePage}
            totalPages={attendanceTotalPages}
            total={attendanceTotal}
            pageSize={ATTENDANCE_PAGE_SIZE}
            isLoading={attendanceLoading}
            itemLabel="check-ins"
            onPageChange={setAttendancePage}
          />
        )}
      </div>
    </div>
  );
}

function StatChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg px-2.5 py-2 text-center" style={{ background: `${color}12`, border: `1px solid ${color}30` }}>
      <div className="text-sm font-bold" style={{ color }}>{value}</div>
      <div className="text-[10px] font-medium uppercase tracking-wide" style={{ color: MUTED }}>{label}</div>
    </div>
  );
}
