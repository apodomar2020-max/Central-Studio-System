import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAttendance,
  useListPackageOrders,
  useCheckIn,
  useGetAttendanceStats,
  getListAttendanceQueryKey,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { QrCode, Search, CheckCircle2, CreditCard, User2, BarChart3 } from "lucide-react";

const STUDIO_CYAN = "#00B6D7";
const AMBER = "#F59E0B";
const GREEN = "#22C55E";

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

type AttendanceRecord = {
  id: number;
  studentName: string;
  studentEmail: string;
  classTitle?: string | null;
  creditDeducted: boolean;
  checkedInAt: string;
};

export default function AttendancePage() {
  const queryClient = useQueryClient();
  const [emailInput, setEmailInput] = useState("");
  const [searchEmail, setSearchEmail] = useState("");
  const [selectedPackageId, setSelectedPackageId] = useState<number | null>(null);
  const [classTitle, setClassTitle] = useState("");
  const [deductCredit, setDeductCredit] = useState(true);
  const [period, setPeriod] = useState<"daily" | "monthly" | "yearly">("monthly");
  const [successMsg, setSuccessMsg] = useState("");

  const { data: allAttendance = [], isLoading: attendanceLoading } = useListAttendance(
    searchEmail ? { studentEmail: searchEmail } : undefined
  );
  const { data: packageOrders = [] } = useListPackageOrders(searchEmail ? undefined : undefined);
  const { data: stats } = useGetAttendanceStats({ period });

  const { mutate: checkIn, isPending: isCheckingIn } = useCheckIn({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getListAttendanceQueryKey() });
        setSuccessMsg(`✓ ${data.studentName} checked in successfully${deductCredit ? " — 1 credit deducted" : ""}`);
        setTimeout(() => setSuccessMsg(""), 4000);
        setSelectedPackageId(null);
        setClassTitle("");
      },
    },
  });

  const studentOrders = (packageOrders as PackageOrder[]).filter(
    (o) => o.studentEmail === searchEmail && o.status === "active" && o.remainingCredits > 0
  );

  function handleSearch() {
    setSearchEmail(emailInput.trim().toLowerCase());
    setSelectedPackageId(null);
    setSuccessMsg("");
  }

  function handleCheckIn() {
    if (!searchEmail) return;
    const order = studentOrders.find((o) => o.id === selectedPackageId);
    checkIn({
      data: {
        studentEmail: searchEmail,
        studentName: order?.studentName ?? searchEmail,
        packageOrderId: selectedPackageId,
        classTitle: classTitle || null,
        creditDeducted: deductCredit && !!selectedPackageId,
        notes: null,
      },
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Attendance & Check-In</h1>
        <p className="mt-1 text-sm" style={{ color: "#8A9AB0" }}>
          Check in students and track attendance. QR codes from the app contain the student email.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Check-in panel */}
        <div className="space-y-4">
          <div className="rounded-xl p-5 space-y-4" style={{ background: "hsl(203 28% 10%)", border: "1px solid hsl(203 30% 16%)" }}>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: `${STUDIO_CYAN}20` }}>
                <QrCode className="h-4 w-4" style={{ color: STUDIO_CYAN }} />
              </div>
              <h2 className="text-sm font-semibold text-white">Student Check-In</h2>
            </div>

            {successMsg && (
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium" style={{ background: `${GREEN}15`, color: GREEN, border: `1px solid ${GREEN}30` }}>
                <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                {successMsg}
              </div>
            )}

            <div className="flex gap-2">
              <input
                type="email"
                placeholder="Enter student email or scan QR..."
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="flex-1 rounded-xl px-3 py-2.5 text-sm text-white"
                style={{ background: "hsl(203 30% 14%)", border: "1px solid hsl(203 30% 20%)", outline: "none" }}
              />
              <button
                onClick={handleSearch}
                className="px-3 py-2.5 rounded-xl transition-colors"
                style={{ background: STUDIO_CYAN, color: "#000" }}
                title="Look up student"
              >
                <Search className="h-4 w-4" />
              </button>
            </div>

            {searchEmail && (
              <div className="space-y-3">
                {studentOrders.length === 0 ? (
                  <div className="text-sm px-3 py-2.5 rounded-xl" style={{ background: `${AMBER}10`, color: AMBER, border: `1px solid ${AMBER}25` }}>
                    No active packages found for {searchEmail}. Check-in without credit deduction.
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#8A9AB0" }}>Active Packages</p>
                    {studentOrders.map((order) => (
                      <button
                        key={order.id}
                        onClick={() => setSelectedPackageId(selectedPackageId === order.id ? null : order.id)}
                        className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm text-left transition-all"
                        style={{
                          background: selectedPackageId === order.id ? `${STUDIO_CYAN}15` : "hsl(203 30% 14%)",
                          border: `1px solid ${selectedPackageId === order.id ? STUDIO_CYAN + "50" : "hsl(203 30% 18%)"}`,
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <CreditCard className="h-3.5 w-3.5" style={{ color: STUDIO_CYAN }} />
                          <span className="font-medium text-white">{order.packageName}</span>
                        </div>
                        <span className="text-xs font-semibold" style={{ color: STUDIO_CYAN }}>
                          {order.remainingCredits} credits left
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: "#8A9AB0" }}>Class Title (optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. Hip Hop Adults"
                    value={classTitle}
                    onChange={(e) => setClassTitle(e.target.value)}
                    className="w-full rounded-xl px-3 py-2.5 text-sm text-white"
                    style={{ background: "hsl(203 30% 14%)", border: "1px solid hsl(203 30% 20%)", outline: "none" }}
                  />
                </div>

                {selectedPackageId && (
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
                  {isCheckingIn ? "Checking in…" : "Check In Student"}
                </button>
              </div>
            )}
          </div>

          {/* Stats panel */}
          <div className="rounded-xl p-5 space-y-4" style={{ background: "hsl(203 28% 10%)", border: "1px solid hsl(203 30% 16%)" }}>
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
                    style={
                      period === p
                        ? { background: STUDIO_CYAN, color: "#000" }
                        : { background: "hsl(203 30% 14%)", color: "#8A9AB0" }
                    }
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
                  <span className="text-sm font-normal ml-2" style={{ color: "#8A9AB0" }}>total check-ins</span>
                </div>
                <div className="space-y-2">
                  {stats.data.map((d) => {
                    const max = Math.max(...stats.data.map((x) => x.count), 1);
                    return (
                      <div key={d.label} className="flex items-center gap-3">
                        <span className="text-xs w-16 flex-shrink-0" style={{ color: "#8A9AB0" }}>{d.label}</span>
                        <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "hsl(203 30% 12%)" }}>
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

        {/* Recent attendance */}
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(203 30% 16%)" }}>
          <div className="px-4 py-3 flex items-center gap-2" style={{ background: "hsl(203 30% 10%)" }}>
            <User2 className="h-4 w-4" style={{ color: STUDIO_CYAN }} />
            <h2 className="text-sm font-semibold text-white">
              {searchEmail ? `Attendance for ${searchEmail}` : "Recent Check-Ins"}
            </h2>
          </div>
          <table className="w-full text-sm">
            <thead style={{ background: "hsl(203 30% 9%)" }}>
              <tr>
                {["Student", "Class", "Credit", "Time"].map((h) => (
                  <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider" style={{ color: "#4E6070" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {attendanceLoading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} style={{ borderTop: "1px solid hsl(203 30% 12%)" }}>
                      {Array.from({ length: 4 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <Skeleton className="h-3.5 w-full" style={{ background: "hsl(203 30% 14%)" }} />
                        </td>
                      ))}
                    </tr>
                  ))
                : (allAttendance as AttendanceRecord[]).length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-sm" style={{ color: "#4E6070" }}>
                      No attendance records yet
                    </td>
                  </tr>
                ) : (
                  (allAttendance as AttendanceRecord[]).slice(0, 30).map((record) => (
                    <tr key={record.id} className="transition-colors hover:bg-white/[0.02]" style={{ borderTop: "1px solid hsl(203 30% 12%)" }}>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-white text-xs">{record.studentName}</div>
                        <div className="text-xs" style={{ color: "#4E6070" }}>{record.studentEmail}</div>
                      </td>
                      <td className="px-4 py-2.5 text-xs" style={{ color: "#9CA3AF" }}>
                        {record.classTitle ?? "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        {record.creditDeducted ? (
                          <span className="text-xs font-medium" style={{ color: AMBER }}>−1</span>
                        ) : (
                          <span className="text-xs" style={{ color: "#4E6070" }}>—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs" style={{ color: "#8A9AB0" }}>
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
  );
}
