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
  WifiOff,
  ShieldAlert,
} from "lucide-react";

const STUDIO_CYAN = "#00B6D7";
const AMBER = "#F59E0B";
const GREEN = "#22C55E";
const RED = "#EF4444";

const SCAN_REGION_ID = "qr-scan-region";
const MANUAL_SCHEDULE_ID = -1;

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase = "scanning" | "resolving" | "selecting" | "submitting" | "done" | "error";

/**
 * The camera itself has its own mini state machine, separate from the check-in
 * workflow phase. This lets us show precise camera-specific errors while still
 * displaying the manual email fallback.
 *
 * idle        → initial state, nothing started yet
 * requesting  → getUserMedia is in flight (permission prompt may be showing)
 * active      → camera stream is running, scanner is decoding frames
 * denied      → user rejected the permission prompt (or OS-level block)
 * unsupported → no mediaDevices API (HTTP page, insecure context, no hardware)
 * error       → some other camera error (no device found, in-use by another app)
 */
type CameraStatus = "idle" | "requesting" | "active" | "denied" | "unsupported" | "error";

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

type LegacyPackageOrder = {
  id: number;
  studentEmail: string;
  packageName: string;
  totalCredits: number;
  remainingCredits: number;
  status: string;
};

// ─── QR parsing ───────────────────────────────────────────────────────────────

function extractScanResult(decoded: string): ScanResult | null {
  const trimmed = decoded.trim();
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (parsed["app"] === "centralstudio") {
      if (typeof parsed["token"] === "string" && parsed["token"].length > 0)
        return { type: "token", token: parsed["token"] };
      if (
        typeof parsed["email"] === "string" &&
        (parsed["email"] as string).includes("@")
      )
        return {
          type: "email",
          email: (parsed["email"] as string).toLowerCase(),
          name:
            typeof parsed["name"] === "string"
              ? parsed["name"]
              : (parsed["email"] as string),
        };
    }
  } catch {
    // not JSON
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed))
    return { type: "email", email: trimmed.toLowerCase(), name: trimmed };
  return null;
}

// ─── Camera permission helper ─────────────────────────────────────────────────

/**
 * Explicitly request camera permission, then immediately stop the test stream.
 * This surfaces the browser's native permission prompt before html5-qrcode
 * tries to take over, and gives us a clean error classification.
 *
 * Returns a CameraStatus describing the outcome.
 */
async function requestCameraPermission(): Promise<CameraStatus> {
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices ||
    typeof navigator.mediaDevices.getUserMedia !== "function"
  ) {
    return "unsupported";
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    // Permission granted — immediately stop the test stream; html5-qrcode
    // will open its own stream.
    stream.getTracks().forEach((t) => t.stop());
    return "active";
  } catch (err: unknown) {
    const name = err instanceof Error ? err.name : "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      return "denied";
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return "unsupported"; // no camera hardware
    }
    return "error";
  }
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

  // html5-qrcode instance
  const scannerRef = useRef<Html5Qrcode | null>(null);
  // Prevents processing the same QR scan twice from rapid camera frames
  const processedRef = useRef(false);
  // Prevents the camera startup effect from running concurrently with itself
  const startingRef = useRef(false);

  // ── Core workflow phase ────────────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>("scanning");

  // ── Camera state ───────────────────────────────────────────────────────────
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>("idle");
  const [cameraError, setCameraError] = useState(""); // extra detail string

  // ── Resolved student (token flow) ─────────────────────────────────────────
  const [resolvedStudent, setResolvedStudent] = useState<ResolvedStudent | null>(null);

  // ── Legacy email flow ──────────────────────────────────────────────────────
  const [legacyEmail, setLegacyEmail] = useState("");
  const [legacyName, setLegacyName] = useState("");

  // ── Manual email input (scanning phase) ───────────────────────────────────
  const [manualEmail, setManualEmail] = useState("");

  // ── Class / package selection ──────────────────────────────────────────────
  const [schedules, setSchedules] = useState<TodaySchedule[]>([]);
  const [selectedScheduleId, setSelectedScheduleId] = useState<number>(MANUAL_SCHEDULE_ID);
  const [manualClassTitle, setManualClassTitle] = useState("");
  const [selectedPackageId, setSelectedPackageId] = useState<number | null>(null);
  const [deductCredit, setDeductCredit] = useState(true);

  // ── Error / success messages ───────────────────────────────────────────────
  const [resolveError, setResolveError] = useState("");
  const [duplicateError, setDuplicateError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const { data: allPackageOrders = [] } = useListPackageOrders();

  // ── Derived values ─────────────────────────────────────────────────────────

  const isTokenFlow = resolvedStudent !== null;
  const effectiveStudentEmail = resolvedStudent?.email ?? legacyEmail;
  const effectiveStudentName = resolvedStudent?.name ?? legacyName ?? effectiveStudentEmail;
  const effectiveStudentId = resolvedStudent?.id ?? null;
  const isManualSchedule = selectedScheduleId === MANUAL_SCHEDULE_ID;
  const selectedSchedule = schedules.find((s) => s.scheduleId === selectedScheduleId) ?? null;
  const effectiveClassTitle = isManualSchedule ? manualClassTitle : (selectedSchedule?.classTitle ?? "");
  const effectiveClassId = isManualSchedule ? null : (selectedSchedule?.classId ?? null);
  const effectiveScheduleId = isManualSchedule ? null : (selectedSchedule?.scheduleId ?? null);

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

  // ── Helpers ────────────────────────────────────────────────────────────────

  async function fetchSchedules() {
    try {
      const rows = await customFetch<TodaySchedule[]>("/api/schedules/today");
      setSchedules(rows);
      if (rows.length === 1) setSelectedScheduleId(rows[0].scheduleId);
    } catch {
      setSchedules([]);
    }
  }

  /** Stop and destroy the scanner instance, if one is running. */
  async function stopScanner() {
    const inst = scannerRef.current;
    scannerRef.current = null;
    startingRef.current = false;
    if (inst) {
      try {
        if (inst.isScanning) await inst.stop();
        inst.clear();
      } catch {
        // ignore cleanup errors
      }
    }
  }

  function resetToScan() {
    processedRef.current = false;
    setPhase("scanning");
    setCameraStatus("idle");
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

  const handleScanResult = useCallback(async (decoded: string) => {
    if (processedRef.current) return;
    const result = extractScanResult(decoded);
    if (!result) return;
    processedRef.current = true;

    // Stop camera as soon as we have a valid QR — no need to keep it running
    await stopScanner();

    if (result.type === "token") {
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

  // ── Camera startup ─────────────────────────────────────────────────────────

  /**
   * Start the camera scanner. Called only when:
   *   1. The dialog is open
   *   2. phase === "scanning"
   *   3. The scanner container div is confirmed to exist in the DOM
   *
   * Flow:
   *   requestCameraPermission() → explicit getUserMedia (shows browser prompt)
   *     → "denied"      → set cameraStatus="denied", don't start scanner
   *     → "unsupported" → set cameraStatus="unsupported", don't start scanner
   *     → "active"      → start Html5Qrcode on the container div
   */
  const startCamera = useCallback(async () => {
    if (startingRef.current || scannerRef.current) return;
    startingRef.current = true;
    setCameraStatus("requesting");
    setCameraError("");

    // Step 1: explicit permission request (triggers browser prompt)
    const permResult = await requestCameraPermission();

    if (permResult !== "active") {
      startingRef.current = false;
      setCameraStatus(permResult);
      if (permResult === "denied") {
        setCameraError(
          "Camera permission was denied. Click 'Retry' or grant permission in your browser settings, then try again.",
        );
      } else if (permResult === "unsupported") {
        setCameraError(
          "No camera found, or this page is not served over HTTPS. Camera scanning requires a secure connection (HTTPS or localhost).",
        );
      } else {
        setCameraError("An unexpected error occurred while accessing the camera.");
      }
      return;
    }

    // Step 2: Verify the container element exists in the DOM (sanity check)
    const el = document.getElementById(SCAN_REGION_ID);
    if (!el) {
      startingRef.current = false;
      setCameraStatus("error");
      setCameraError("Scanner container not found. Please close and reopen the dialog.");
      return;
    }

    // Step 3: Start html5-qrcode
    try {
      const html5 = new Html5Qrcode(SCAN_REGION_ID, { verbose: false });
      scannerRef.current = html5;
      await html5.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decodedText) => {
          void handleScanResult(decodedText);
        },
        () => {
          /* per-frame decode errors are expected — ignore */
        },
      );
      setCameraStatus("active");
      startingRef.current = false;
    } catch (err: unknown) {
      startingRef.current = false;
      scannerRef.current = null;
      setCameraStatus("error");
      const msg = err instanceof Error ? err.message : String(err);
      setCameraError(`Could not start the camera scanner: ${msg}`);
    }
  }, [handleScanResult]);

  // ── Lifecycle effects ──────────────────────────────────────────────────────

  // Reset workflow state whenever the dialog opens or closes
  useEffect(() => {
    if (open) {
      resetToScan();
    } else {
      void stopScanner();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Start the camera after the scanning phase is active and the DOM is ready.
  // Using two nested rAF calls ensures the browser has had at least one full
  // layout pass after the Radix portal is committed, so the container div is
  // guaranteed to exist and have dimensions before Html5Qrcode is instantiated.
  useEffect(() => {
    if (!open || phase !== "scanning") return;

    let rafId1: number;
    let rafId2: number;
    let cancelled = false;

    rafId1 = requestAnimationFrame(() => {
      rafId2 = requestAnimationFrame(() => {
        if (!cancelled) void startCamera();
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId1);
      cancelAnimationFrame(rafId2);
      void stopScanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, phase]);
  // NOTE: startCamera is intentionally excluded. We only want this effect to
  // fire when the dialog opens or phase returns to "scanning". Including
  // startCamera (a useCallback) would not change correctness, but it would
  // cause spurious re-runs on every render since useCallback recreates on
  // every mount of this component.

  // ── Render helpers ─────────────────────────────────────────────────────────

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

  /** Camera status banner — shown inside the scanning phase when camera is not active */
  function renderCameraBanner() {
    if (cameraStatus === "requesting") {
      return (
        <div
          className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs"
          style={{ background: `${STUDIO_CYAN}12`, color: STUDIO_CYAN, border: `1px solid ${STUDIO_CYAN}30` }}
        >
          <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
          Requesting camera permission…
        </div>
      );
    }

    if (cameraStatus === "idle") return null; // starting up, rAF not fired yet

    if (cameraStatus === "active") return null; // camera is running, no banner needed

    // denied | unsupported | error
    const Icon = cameraStatus === "unsupported" ? WifiOff : ShieldAlert;
    return (
      <div
        className="space-y-2.5 px-3 py-3 rounded-xl text-xs"
        style={{ background: `${RED}10`, color: RED, border: `1px solid ${RED}28` }}
      >
        <div className="flex items-start gap-2">
          <Icon className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <p className="leading-relaxed">{cameraError}</p>
        </div>
        {(cameraStatus === "denied" || cameraStatus === "error") && (
          <button
            onClick={() => {
              void stopScanner().then(() => {
                processedRef.current = false;
                setCameraStatus("idle");
                setCameraError("");
                // Re-trigger the camera startup effect by briefly resetting
                // to a non-scanning phase, then back.
                setPhase("error");
                requestAnimationFrame(() => setPhase("scanning"));
              });
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
            style={{ background: RED, color: "#fff" }}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Retry Camera Permission
          </button>
        )}
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

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
            {/* Camera viewport — always rendered so the DOM element exists
                before html5-qrcode initialises. When the camera hasn't started
                yet (or failed), this div is just a dark placeholder. */}
            <div
              id={SCAN_REGION_ID}
              className="overflow-hidden rounded-xl"
              style={{
                background: "#000",
                minHeight: 240,
                border: "1px solid hsl(203 30% 18%)",
                position: "relative",
              }}
            >
              {/* Show a loading indicator while the camera is requesting permission */}
              {(cameraStatus === "idle" || cameraStatus === "requesting") && (
                <div
                  className="absolute inset-0 flex flex-col items-center justify-center gap-2"
                  style={{ color: "#4E6070" }}
                >
                  <Loader2 className="h-6 w-6 animate-spin" style={{ color: STUDIO_CYAN }} />
                  <span className="text-xs">
                    {cameraStatus === "idle" ? "Initialising…" : "Waiting for camera permission…"}
                  </span>
                </div>
              )}
            </div>

            {/* Camera error / status banner */}
            {renderCameraBanner()}

            {/* Manual email entry — always visible regardless of camera status */}
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

            {/* Duplicate attendance error (inline) */}
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
                style={{ background: `${AMBER}10`, color: AMBER, border: `1px solid ${AMBER}25` }}
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
                      setSelectedPackageId(selectedPackageId === pkg.id ? null : pkg.id)
                    }
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm text-left transition-all"
                    style={{
                      background:
                        selectedPackageId === pkg.id ? `${STUDIO_CYAN}15` : "hsl(203 30% 14%)",
                      border: `1px solid ${
                        selectedPackageId === pkg.id ? STUDIO_CYAN + "50" : "hsl(203 30% 18%)"
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

            {/* Schedule dropdown */}
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
                onClick={() => {
                  void stopScanner();
                  resetToScan();
                }}
                className="px-4 py-3 rounded-xl text-sm font-semibold"
                style={{ background: "hsl(203 30% 14%)", color: "#8A9AB0" }}
              >
                Back
              </button>
              <button
                onClick={() => void handleCheckIn()}
                className="flex-1 py-3 rounded-xl text-sm font-bold"
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
                onClick={() => {
                  void stopScanner();
                  resetToScan();
                }}
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
                onClick={() => {
                  void stopScanner();
                  resetToScan();
                }}
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
