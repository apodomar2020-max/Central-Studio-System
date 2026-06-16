import { useCallback, useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  useListPackageOrders,
  getListAttendanceQueryKey,
  getListPackageOrdersQueryKey,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Camera,
  CheckCircle2,
  CreditCard,
  RefreshCw,
  AlertTriangle,
  Loader2,
  User2,
  ChevronDown,
} from "lucide-react";

const STUDIO_CYAN = "#00B6D7";
const AMBER = "#F59E0B";
const GREEN = "#22C55E";
const RED = "#EF4444";

const SCAN_REGION_ID = "qr-scan-region";
const MANUAL_SCHEDULE_ID = -1; // sentinel: "Not listed / Enter manually"

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Phases of the check-in dialog.
 *
 * scanning   → camera/manual entry active
 * resolving  → fetching student by token
 * selecting  → admin picks class + package
 * submitting → POST /api/attendance in flight
 * done       → success
 * error      → unrecoverable error (404, network) — show retry
 */
type Phase = "scanning" | "resolving" | "selecting" | "submitting" | "done" | "error";

/**
 * Structured result from parsing a scanned QR string.
 *
 * token  → new secure flow: resolved via GET /api/students/by-token/:token
 * email  → legacy PII flow or raw email text: resolved locally
 */
type ScanResult =
  | { type: "token"; token: string }
  | { type: "email"; email: string; name: string };

type ActivePackage = {
  id: number;
  packageName: string;
  totalCredits: number;
  remainingCredits: number;
  expiresAt?: string | null;
};

type ResolvedStudent = {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  activePackages: ActivePackage[];
};

type TodaySchedule = {
  scheduleId: number;
  classId: number;
  classTitle: string;
  startTime: string;
  endTime: string;
  instructorName?: string | null;
};

// Shape of records from useListPackageOrders (generated hook)
type LegacyPackageOrder = {
  id: number;
  studentEmail: string;
  packageName: string;
  totalCredits: number;
  remainingCredits: number;
  status: string;
};

// ─── QR parsing ───────────────────────────────────────────────────────────────

/**
 * Parse a scanned QR string into a structured ScanResult.
 *
 * Priority order:
 *   1. { app: "centralstudio", token: "<uuid>" }  → new secure flow
 *   2. { app: "centralstudio", email, name, ... }  → legacy PII fallback
 *   3. raw email text                              → manual-entry fallback
 *
 * Returns null if the QR cannot be interpreted as a Central Studio code.
 * The token value is NEVER logged or displayed in the UI.
 */
function extractScanResult(decoded: string): ScanResult | null {
  const trimmed = decoded.trim();

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;

    if (parsed["app"] === "centralstudio") {
      // ── New secure format ────────────────────────────────────────────────
      if (typeof parsed["token"] === "string" && parsed["token"].length > 0) {
        return { type: "token", token: parsed["token"] };
      }
      // ── Legacy PII format (transitional) ────────────────────────────────
      if (
        typeof parsed["email"] === "string" &&
        (parsed["email"] as string).includes("@")
      ) {
        return {
          type: "email",
          email: (parsed["email"] as string).toLowerCase(),
          name:
            typeof parsed["name"] === "string"
              ? parsed["name"]
              : (parsed["email"] as string),
        };
      }
    }
  } catch {
    // Not JSON — fall through to raw email check
  }

  // Raw email text (typed manually or from a very old QR)
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { type: "email", email: trimmed.toLowerCase(), name: trimmed };
  }

  return null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ScanCheckInDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  // Prevents the camera callback from processing the same frame twice.
  const processedRef = useRef(false);

  const [phase, setPhase] = useState<Phase>("scanning");
  const [cameraError, setCameraError] = useState("");

  // Token flow: full student profile returned by /api/students/by-token/:token
  const [resolvedStudent, setResolvedStudent] = useState<ResolvedStudent | null>(null);

  // Legacy email flow: identity extracted from old QR or manual entry
  const [legacyEmail, setLegacyEmail] = useState("");
  const [legacyName, setLegacyName] = useState("");

  // Manual email input (scanning phase)
  const [manualEmail, setManualEmail] = useState("");

  // Selecting-phase form state
  const [schedules, setSchedules] = useState<TodaySchedule[]>([]);
  const [selectedScheduleId, setSelectedScheduleId] = useState<number>(MANUAL_SCHEDULE_ID);
  const [manualClassTitle, setManualClassTitle] = useState("");
  const [selectedPackageId, setSelectedPackageId] = useState<number | null>(null);
  const [deductCredit, setDeductCredit] = useState(true);

  // Error / success messages
  const [resolveError, setResolveError] = useState(""); // shown in "error" phase
  const [duplicateError, setDuplicateError] = useState(""); // shown inline in "selecting" phase
  const [successMsg, setSuccessMsg] = useState("");

  // Used for legacy email flow package lookup — same hook as before.
  const { data: allPackageOrders = [] } = useListPackageOrders();

  // ── Derived values ────────────────────────────────────────────────────────

  const isTokenFlow = resolvedStudent !== null;

  const effectiveStudentEmail = resolvedStudent?.email ?? legacyEmail;
  const effectiveStudentName =
    resolvedStudent?.name ?? legacyName ?? effectiveStudentEmail;
  const effectiveStudentId = resolvedStudent?.id ?? null;

  const isManualSchedule = selectedScheduleId === MANUAL_SCHEDULE_ID;
  const selectedSchedule =
    schedules.find((s) => s.scheduleId === selectedScheduleId) ?? null;

  const effectiveClassTitle = isManualSchedule
    ? manualClassTitle
    : (selectedSchedule?.classTitle ?? "");
  const effectiveClassId = isManualSchedule
    ? null
    : (selectedSchedule?.classId ?? null);
  const effectiveScheduleId = isManualSchedule
    ? null
    : (selectedSchedule?.scheduleId ?? null);

  /**
   * Active packages for the "selecting" UI.
   *
   * Token flow  → sourced directly from the /by-token response (already filtered
   *               by remainingCredits > 0 on the server).
   * Legacy flow → filtered from the global useListPackageOrders cache, matching
   *               the same logic as before.
   */
  const activePackages: ActivePackage[] = isTokenFlow
    ? resolvedStudent.activePackages
    : (allPackageOrders as LegacyPackageOrder[])
        .filter(
          (o) =>
            o.studentEmail === legacyEmail &&
            o.status === "active" &&
            o.remainingCredits > 0,
        )
        .map((o) => ({
          id: o.id,
          packageName: o.packageName,
          totalCredits: o.totalCredits,
          remainingCredits: o.remainingCredits,
        }));

  // ── Helpers ───────────────────────────────────────────────────────────────

  async function fetchSchedules() {
    try {
      const rows = await customFetch<TodaySchedule[]>("/api/schedules/today");
      setSchedules(rows);
      // Auto-select the first schedule when there's exactly one class today.
      if (rows.length === 1) setSelectedScheduleId(rows[0].scheduleId);
    } catch {
      setSchedules([]); // Non-fatal: fall back to manual entry
    }
  }

  function resetToScan() {
    processedRef.current = false;
    setPhase("scanning");
    setCameraError("");
    setResolvedStudent(null);
    setLegacyEmail("");
    setLegacyName("");
    setManualEmail("");
    setSchedules([]);
    setSelectedScheduleId(MANUAL_SCHEDULE_ID);
    setManualClassTitle("");
    setSelectedPackageId(null);
    setDeductCredit(true);
    setResolveError("");
    setDuplicateError("");
    setSuccessMsg("");
  }

  /**
   * Central handler for both camera scans and manual email entry.
   * Guarded by processedRef so a rapid burst of camera frames only fires once.
   */
  const handleScanResult = useCallback(async (decoded: string) => {
    if (processedRef.current) return;
    const result = extractScanResult(decoded);
    if (!result) return;
    processedRef.current = true;

    if (result.type === "token") {
      // ── New secure flow ──────────────────────────────────────────────────
      setPhase("resolving");
      setResolveError("");
      try {
        const student = await customFetch<ResolvedStudent>(
          `/api/students/by-token/${result.token}`,
        );
        setResolvedStudent(student);
        await fetchSchedules();
        setPhase("selecting");
      } catch (err: unknown) {
        const status =
          err !== null && typeof err === "object" && "status" in err
            ? (err as { status: number }).status
            : 0;
        setResolveError(
          status === 404
            ? "QR code not recognised. Please try again or enter email manually."
            : "Could not look up student. Check your connection and try again.",
        );
        setPhase("error");
      }
    } else {
      // ── Legacy email flow ────────────────────────────────────────────────
      setLegacyEmail(result.email);
      setLegacyName(result.name);
      setResolvedStudent(null);
      await fetchSchedules();
      setPhase("selecting");
    }
  }, []);

  function handleManualLookup() {
    const trimmed = manualEmail.trim();
    if (!trimmed.includes("@")) return;
    void handleScanResult(trimmed);
  }

  async function handleCheckIn() {
    if (!effectiveStudentEmail) return;
    setDuplicateError("");
    setPhase("submitting");

    const creditActuallyDeducted = deductCredit && !!selectedPackageId;

    const body = {
      studentEmail: effectiveStudentEmail,
      studentName: effectiveStudentName,
      packageOrderId: selectedPackageId ?? null,
      classTitle: effectiveClassTitle || null,
      creditDeducted: creditActuallyDeducted,
      notes: null,
      // New FK fields — null when using legacy manual class or legacy email flow
      studentId: effectiveStudentId,
      classId: effectiveClassId,
      scheduleId: effectiveScheduleId,
    };

    try {
      const row = await customFetch<{ studentName: string; creditDeducted: boolean }>(
        "/api/attendance",
        { method: "POST", body: JSON.stringify(body) },
      );

      queryClient.invalidateQueries({ queryKey: getListAttendanceQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListPackageOrdersQueryKey() });

      setSuccessMsg(
        `${row.studentName} checked in${creditActuallyDeducted ? " — 1 credit deducted" : ""}`,
      );
      setPhase("done");
    } catch (err: unknown) {
      const status =
        err !== null && typeof err === "object" && "status" in err
          ? (err as { status: number }).status
          : 0;
      const errMsg =
        err !== null && typeof err === "object" && "data" in err
          ? ((err as { data?: { message?: string } }).data?.message ?? null)
          : null;

      if (status === 409) {
        // Duplicate attendance — stay in selecting phase with an inline error.
        // The backend transaction guarantees no credit was deducted.
        setDuplicateError(
          errMsg ?? "This student is already checked in for this class today.",
        );
        setPhase("selecting");
      } else {
        setResolveError(errMsg ?? "Check-in failed. Please try again.");
        setPhase("error");
      }
    }
  }

  // ── Camera lifecycle ──────────────────────────────────────────────────────

  useEffect(() => {
    if (open) resetToScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || phase !== "scanning") return;

    let cancelled = false;
    setCameraError("");

    const start = async () => {
      try {
        const html5 = new Html5Qrcode(SCAN_REGION_ID, { verbose: false });
        scannerRef.current = html5;
        await html5.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decodedText) => {
            if (!cancelled) void handleScanResult(decodedText);
          },
          () => {
            /* per-frame decode errors are expected; ignore */
          },
        );
      } catch {
        if (!cancelled) {
          setCameraError(
            "Could not access the camera. Grant camera permission (open the admin in its own browser tab), or enter the student's email below.",
          );
        }
      }
    };

    void start();

    return () => {
      cancelled = true;
      const inst = scannerRef.current;
      scannerRef.current = null;
      if (inst) {
        inst
          .stop()
          .then(() => inst.clear())
          .catch(() => {});
      }
    };
  }, [open, phase, handleScanResult]);

  // ── Render helpers ────────────────────────────────────────────────────────

  function formatTime(t: string) {
    try {
      const [h, m] = t.split(":");
      const d = new Date();
      d.setHours(parseInt(h, 10), parseInt(m, 10));
      return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    } catch {
      return t;
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md border-0"
        style={{ background: "hsl(203 28% 9%)", border: "1px solid hsl(203 30% 16%)" }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Camera className="h-5 w-5" style={{ color: STUDIO_CYAN }} />
            Scan to Check In
          </DialogTitle>
          <DialogDescription style={{ color: "#8A9AB0" }}>
            Point the camera at the member's Studio Pass QR code from the app.
          </DialogDescription>
        </DialogHeader>

        {/* ── SCANNING ─────────────────────────────────────────────────────── */}
        {phase === "scanning" && (
          <div className="space-y-4">
            <div
              id={SCAN_REGION_ID}
              className="overflow-hidden rounded-xl"
              style={{ background: "#000", minHeight: 240, border: "1px solid hsl(203 30% 18%)" }}
            />

            {cameraError && (
              <div
                className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-xs"
                style={{ background: `${AMBER}12`, color: AMBER, border: `1px solid ${AMBER}30` }}
              >
                <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                {cameraError}
              </div>
            )}

            <div>
              <label
                className="block text-xs font-semibold mb-1.5 uppercase tracking-wider"
                style={{ color: "#8A9AB0" }}
              >
                Or enter email manually
              </label>
              <div className="flex gap-2">
                <input
                  type="email"
                  placeholder="student@email.com"
                  value={manualEmail}
                  onChange={(e) => setManualEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleManualLookup()}
                  className="flex-1 rounded-xl px-3 py-2.5 text-sm text-white"
                  style={{
                    background: "hsl(203 30% 14%)",
                    border: "1px solid hsl(203 30% 20%)",
                    outline: "none",
                  }}
                />
                <button
                  onClick={handleManualLookup}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold"
                  style={{ background: STUDIO_CYAN, color: "#000" }}
                >
                  Look up
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── RESOLVING / SUBMITTING (shared spinner) ───────────────────────── */}
        {(phase === "resolving" || phase === "submitting") && (
          <div className="flex flex-col items-center justify-center gap-3 py-10">
            <Loader2 className="h-8 w-8 animate-spin" style={{ color: STUDIO_CYAN }} />
            <p className="text-sm" style={{ color: "#8A9AB0" }}>
              {phase === "resolving" ? "Looking up student…" : "Recording attendance…"}
            </p>
          </div>
        )}

        {/* ── SELECTING ─────────────────────────────────────────────────────── */}
        {phase === "selecting" && (
          <div className="space-y-3">
            {/* Student card */}
            <div
              className="rounded-xl px-3 py-2.5"
              style={{ background: `${STUDIO_CYAN}12`, border: `1px solid ${STUDIO_CYAN}30` }}
            >
              <div className="flex items-center gap-2 mb-0.5">
                <User2 className="h-4 w-4 flex-shrink-0" style={{ color: STUDIO_CYAN }} />
                <span className="font-semibold text-white text-sm">{effectiveStudentName}</span>
              </div>
              <div className="text-xs" style={{ color: "#4E6070" }}>
                {effectiveStudentEmail}
              </div>
              {resolvedStudent?.phone && (
                <div className="text-xs mt-0.5" style={{ color: "#4E6070" }}>
                  {resolvedStudent.phone}
                </div>
              )}
            </div>

            {/* Duplicate attendance error (inline — stays in selecting phase) */}
            {duplicateError && (
              <div
                className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-xs"
                style={{ background: `${RED}12`, color: RED, border: `1px solid ${RED}30` }}
              >
                <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                {duplicateError}
              </div>
            )}

            {/* Active packages */}
            {activePackages.length === 0 ? (
              <div
                className="text-sm px-3 py-2.5 rounded-xl"
                style={{
                  background: `${AMBER}10`,
                  color: AMBER,
                  border: `1px solid ${AMBER}25`,
                }}
              >
                No active packages found. You can still check in without deducting a credit.
              </div>
            ) : (
              <div className="space-y-2">
                <p
                  className="text-xs font-semibold uppercase tracking-wider"
                  style={{ color: "#8A9AB0" }}
                >
                  Active Packages
                </p>
                {activePackages.map((pkg) => (
                  <button
                    key={pkg.id}
                    onClick={() =>
                      setSelectedPackageId(
                        selectedPackageId === pkg.id ? null : pkg.id,
                      )
                    }
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm text-left transition-all"
                    style={{
                      background:
                        selectedPackageId === pkg.id
                          ? `${STUDIO_CYAN}15`
                          : "hsl(203 30% 14%)",
                      border: `1px solid ${
                        selectedPackageId === pkg.id
                          ? STUDIO_CYAN + "50"
                          : "hsl(203 30% 18%)"
                      }`,
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <CreditCard className="h-3.5 w-3.5" style={{ color: STUDIO_CYAN }} />
                      <span className="font-medium text-white">{pkg.packageName}</span>
                    </div>
                    <span className="text-xs font-semibold" style={{ color: STUDIO_CYAN }}>
                      {pkg.remainingCredits} credit{pkg.remainingCredits !== 1 ? "s" : ""} left
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Today's schedule dropdown */}
            <div>
              <label
                className="block text-xs font-semibold mb-1.5 uppercase tracking-wider"
                style={{ color: "#8A9AB0" }}
              >
                Today's Class
              </label>
              <div className="relative">
                <select
                  value={selectedScheduleId}
                  onChange={(e) => setSelectedScheduleId(Number(e.target.value))}
                  className="w-full rounded-xl px-3 py-2.5 text-sm text-white appearance-none pr-8"
                  style={{
                    background: "hsl(203 30% 14%)",
                    border: "1px solid hsl(203 30% 20%)",
                    outline: "none",
                  }}
                >
                  <option value={MANUAL_SCHEDULE_ID}>Not listed / Enter manually</option>
                  {schedules.map((s) => (
                    <option key={s.scheduleId} value={s.scheduleId}>
                      {s.classTitle} · {formatTime(s.startTime)}
                      {s.instructorName ? ` · ${s.instructorName}` : ""}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none"
                  style={{ color: "#8A9AB0" }}
                />
              </div>
            </div>

            {/* Manual class title — only shown when "Not listed" is selected */}
            {isManualSchedule && (
              <div>
                <label
                  className="block text-xs font-semibold mb-1.5 uppercase tracking-wider"
                  style={{ color: "#8A9AB0" }}
                >
                  Class Title (optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Hip Hop Adults"
                  value={manualClassTitle}
                  onChange={(e) => setManualClassTitle(e.target.value)}
                  className="w-full rounded-xl px-3 py-2.5 text-sm text-white"
                  style={{
                    background: "hsl(203 30% 14%)",
                    border: "1px solid hsl(203 30% 20%)",
                    outline: "none",
                  }}
                />
              </div>
            )}

            {/* Credit deduction toggle — only visible when a package is selected */}
            {selectedPackageId && (
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={deductCredit}
                  onChange={(e) => setDeductCredit(e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm" style={{ color: "#9CA3AF" }}>
                  Deduct 1 credit from selected package
                </span>
              </label>
            )}

            <div className="flex gap-2 pt-1">
              <button
                onClick={resetToScan}
                className="px-4 py-3 rounded-xl text-sm font-semibold"
                style={{ background: "hsl(203 30% 14%)", color: "#8A9AB0" }}
              >
                Back
              </button>
              <button
                onClick={() => void handleCheckIn()}
                className="flex-1 py-3 rounded-xl text-sm font-bold transition-colors"
                style={{ background: STUDIO_CYAN, color: "#000" }}
              >
                Check In
              </button>
            </div>
          </div>
        )}

        {/* ── DONE ──────────────────────────────────────────────────────────── */}
        {phase === "done" && (
          <div className="space-y-4 py-2">
            <div
              className="flex items-center gap-2 px-3 py-3 rounded-xl text-sm font-medium"
              style={{ background: `${GREEN}15`, color: GREEN, border: `1px solid ${GREEN}30` }}
            >
              <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
              {successMsg}
            </div>
            <div className="flex gap-2">
              <button
                onClick={resetToScan}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold"
                style={{ background: STUDIO_CYAN, color: "#000" }}
              >
                <RefreshCw className="h-4 w-4" />
                Scan Next
              </button>
              <button
                onClick={() => onOpenChange(false)}
                className="px-5 py-3 rounded-xl text-sm font-semibold"
                style={{ background: "hsl(203 30% 14%)", color: "#8A9AB0" }}
              >
                Done
              </button>
            </div>
          </div>
        )}

        {/* ── ERROR ─────────────────────────────────────────────────────────── */}
        {phase === "error" && (
          <div className="space-y-4 py-2">
            <div
              className="flex items-start gap-2 px-3 py-3 rounded-xl text-sm"
              style={{ background: `${RED}12`, color: RED, border: `1px solid ${RED}30` }}
            >
              <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" />
              {resolveError}
            </div>
            <div className="flex gap-2">
              <button
                onClick={resetToScan}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold"
                style={{ background: STUDIO_CYAN, color: "#000" }}
              >
                <RefreshCw className="h-4 w-4" />
                Try Again
              </button>
              <button
                onClick={() => onOpenChange(false)}
                className="px-5 py-3 rounded-xl text-sm font-semibold"
                style={{ background: "hsl(203 30% 14%)", color: "#8A9AB0" }}
              >
                Close
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
