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
  ShieldAlert,
  VideoOff,
} from "lucide-react";

const STUDIO_CYAN = "#00B6D7";
const AMBER = "#F59E0B";
const GREEN = "#22C55E";
const RED = "#EF4444";

// This ID is used by html5-qrcode to find the container div via document.getElementById.
// The div with this ID must be completely empty — no React children — because
// html5-qrcode owns the DOM inside it via direct mutation.
const SCAN_REGION_ID = "qr-scan-region-inner";

const MANUAL_SCHEDULE_ID = -1;

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase = "scanning" | "resolving" | "selecting" | "submitting" | "done" | "error";

/**
 * Camera-specific state machine, separate from the check-in workflow phase.
 *
 * idle        – not yet started
 * requesting  – getUserMedia is in flight (browser permission prompt may be showing)
 * active      – stream running, scanner decoding frames
 * denied      – user rejected the permission prompt or OS-level block
 * unsupported – no mediaDevices API / HTTP page / no camera hardware
 * error       – started but html5-qrcode threw (driver issue, already in use, etc.)
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
      if (typeof parsed["email"] === "string" && (parsed["email"] as string).includes("@"))
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
    stream.getTracks().forEach((t) => t.stop());
    return "active";
  } catch (err: unknown) {
    const name = err instanceof Error ? err.name : "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") return "denied";
    if (name === "NotFoundError" || name === "DevicesNotFoundError") return "unsupported";
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

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const processedRef = useRef(false);
  const startingRef = useRef(false);

  const [phase, setPhase] = useState<Phase>("scanning");
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>("idle");
  const [cameraError, setCameraError] = useState("");

  const [resolvedStudent, setResolvedStudent] = useState<ResolvedStudent | null>(null);
  const [legacyEmail, setLegacyEmail] = useState("");
  const [legacyName, setLegacyName] = useState("");
  const [manualEmail, setManualEmail] = useState("");

  const [schedules, setSchedules] = useState<TodaySchedule[]>([]);
  const [selectedScheduleId, setSelectedScheduleId] = useState<number>(MANUAL_SCHEDULE_ID);
  const [manualClassTitle, setManualClassTitle] = useState("");
  const [selectedPackageId, setSelectedPackageId] = useState<number | null>(null);
  const [deductCredit, setDeductCredit] = useState(true);

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
        setDuplicateError(errMsg ?? "This student is already checked in for this class today.");
        setPhase("selecting");
      } else {
        setResolveError(errMsg ?? "Check-in failed. Please try again.");
        setPhase("error");
      }
    }
  }

  // ── Camera startup ─────────────────────────────────────────────────────────

  const startCamera = useCallback(async () => {
    if (startingRef.current || scannerRef.current) return;
    startingRef.current = true;
    setCameraStatus("requesting");
    setCameraError("");

    // Step 1: Explicit permission request — triggers the browser's native prompt.
    // We release the test stream immediately; html5-qrcode opens its own stream.
    const permResult = await requestCameraPermission();
    if (permResult !== "active") {
      startingRef.current = false;
      setCameraStatus(permResult);
      if (permResult === "denied") {
        setCameraError(
          "Camera access was denied. Click 'Retry' to request permission again, or use the manual email entry below.",
        );
      } else {
        setCameraError(
          "Camera not available. This may be because the page isn't served over HTTPS, or no camera is connected. Use the manual email entry below.",
        );
      }
      return;
    }

    // Step 2: The scanner container must exist and have a non-zero size.
    const el = document.getElementById(SCAN_REGION_ID);
    if (!el || el.clientWidth === 0) {
      startingRef.current = false;
      setCameraStatus("error");
      setCameraError("Scanner container is not visible. Please close and reopen the dialog.");
      return;
    }

    // Step 3: Start html5-qrcode.
    //
    // IMPORTANT — we do NOT pass a qrbox option.
    // The qrbox option causes html5-qrcode to create absolutely-positioned
    // shading overlays calculated from the video element's clientWidth/clientHeight.
    // When those dimensions are misread (portal animation, zero-size, etc.), the
    // shading elements overflow the container and produce a solid-black screen.
    // Without qrbox, the entire video area is the scanning zone — simpler and
    // visually cleaner for a dialog scanner.
    //
    // We try `facingMode: "environment"` first (rear camera, ideal for tablets).
    // On laptops with only a front-facing camera, we fall back to "user".
    try {
      const html5 = new Html5Qrcode(SCAN_REGION_ID, { verbose: false });
      scannerRef.current = html5;

      const startConfig = { fps: 10 };
      let started = false;

      try {
        await html5.start(
          { facingMode: "environment" },
          startConfig,
          (decodedText) => { void handleScanResult(decodedText); },
          () => { /* per-frame decode errors are expected */ },
        );
        started = true;
      } catch {
        // environment camera not available (most admin laptops) — fall back to user-facing
        await html5.start(
          { facingMode: "user" },
          startConfig,
          (decodedText) => { void handleScanResult(decodedText); },
          () => { /* per-frame decode errors are expected */ },
        );
        started = true;
      }

      if (started) {
        setCameraStatus("active");
        startingRef.current = false;
      }
    } catch (err: unknown) {
      startingRef.current = false;
      // Don't null scannerRef here — html5-qrcode may have partially started.
      // stopScanner() handles cleanup safely.
      await stopScanner();
      setCameraStatus("error");
      const msg = err instanceof Error ? err.message : String(err);
      setCameraError(`Camera failed to start: ${msg}. Try clicking 'Restart Camera' below.`);
    }
  }, [handleScanResult]);

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (open) {
      resetToScan();
    } else {
      void stopScanner();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || phase !== "scanning") return;

    // Two nested rAF calls give the Radix portal two full layout passes to
    // commit the container div to the DOM and assign it correct dimensions
    // before html5-qrcode reads clientWidth/clientHeight.
    let raf1: number;
    let raf2: number;
    let dead = false;

    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (!dead) void startCamera();
      });
    });

    return () => {
      dead = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      void stopScanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, phase]);

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

  function handleRestart() {
    void stopScanner().then(() => {
      processedRef.current = false;
      setCameraStatus("idle");
      setCameraError("");
      // Reset phase through error to force the useEffect to re-fire with phase="scanning"
      setPhase("error");
      requestAnimationFrame(() => setPhase("scanning"));
    });
  }

  // ── Camera viewport section ────────────────────────────────────────────────
  //
  // Layout explanation:
  //
  //   ┌─ outerWrapper (position: relative, 320px tall, overflow: hidden) ──┐
  //   │                                                                      │
  //   │  ┌─ #qr-scan-region-inner (100% × 100%, NO React children) ──────┐ │
  //   │  │  html5-qrcode appends <video>, <canvas> here via DOM mutation  │ │
  //   │  └────────────────────────────────────────────────────────────────┘ │
  //   │                                                                      │
  //   │  ┌─ statusOverlay (absolute inset-0, z-10) ───────────────────────┐ │
  //   │  │  Managed entirely by React. Shown when cameraStatus ≠ active.  │ │
  //   │  │  Sits ABOVE the scanner div in stacking order.                 │ │
  //   │  └────────────────────────────────────────────────────────────────┘ │
  //   │                                                                      │
  //   └──────────────────────────────────────────────────────────────────────┘
  //
  // Why this structure:
  //   • The scanner div has ZERO React children so React never touches its
  //     interior. html5-qrcode owns it completely.
  //   • overflow: hidden and border-radius are on the WRAPPER, not on the
  //     scanner div. This prevents html5-qrcode's internal elements from
  //     being clipped unexpectedly.
  //   • The status overlay is a sibling (not child) of the scanner div,
  //     positioned on top via z-index. When the camera is active the overlay
  //     is removed and the video is fully visible.

  function renderCameraViewport() {
    return (
      <div
        style={{
          position: "relative",
          height: "320px",
          borderRadius: "12px",
          overflow: "hidden",
          border: "1px solid hsl(203 30% 18%)",
          background: "#0a0a0a",
        }}
      >
        {/* Scanner div — completely empty, owned by html5-qrcode */}
        <div
          id={SCAN_REGION_ID}
          style={{ width: "100%", height: "100%" }}
        />

        {/* "Point at QR code" hint — shown only when camera is live */}
        {cameraStatus === "active" && (
          <div
            style={{
              position: "absolute",
              bottom: 10,
              left: 0,
              right: 0,
              display: "flex",
              justifyContent: "center",
              zIndex: 5,
              pointerEvents: "none",
            }}
          >
            <span
              style={{
                color: "#fff",
                fontSize: 11,
                fontWeight: 500,
                background: "rgba(0,0,0,0.55)",
                padding: "3px 10px",
                borderRadius: 20,
                letterSpacing: "0.02em",
              }}
            >
              Point camera at QR code
            </span>
          </div>
        )}

        {/* Status overlay — rendered as a SIBLING of the scanner div,
            covering it via absolute positioning. Removed when camera is active. */}
        {cameraStatus !== "active" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "#111",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "10px",
              zIndex: 10,
              padding: "20px",
            }}
          >
            {(cameraStatus === "idle" || cameraStatus === "requesting") && (
              <>
                <Loader2
                  style={{ width: 28, height: 28, color: STUDIO_CYAN }}
                  className="animate-spin"
                />
                <p style={{ color: "#8A9AB0", fontSize: 12, textAlign: "center" }}>
                  {cameraStatus === "idle"
                    ? "Initialising camera…"
                    : "Waiting for camera permission…"}
                </p>
              </>
            )}

            {(cameraStatus === "denied" ||
              cameraStatus === "unsupported" ||
              cameraStatus === "error") && (
              <>
                {cameraStatus === "denied" ? (
                  <ShieldAlert style={{ width: 28, height: 28, color: AMBER }} />
                ) : (
                  <VideoOff style={{ width: 28, height: 28, color: "#4E6070" }} />
                )}

                <p
                  style={{
                    color: "#9CA3AF",
                    fontSize: 12,
                    textAlign: "center",
                    lineHeight: 1.5,
                    maxWidth: "280px",
                  }}
                >
                  {cameraError}
                </p>

                {(cameraStatus === "denied" || cameraStatus === "error") && (
                  <button
                    onClick={handleRestart}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "7px 14px",
                      borderRadius: 8,
                      border: "none",
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: 600,
                      background: STUDIO_CYAN,
                      color: "#000",
                    }}
                  >
                    <RefreshCw style={{ width: 13, height: 13 }} />
                    Restart Camera
                  </button>
                )}
              </>
            )}
          </div>
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
            {renderCameraViewport()}

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

        {/* ── RESOLVING / SUBMITTING ────────────────────────────────────────── */}
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
              <div className="text-xs" style={{ color: "#4E6070" }}>{effectiveStudentEmail}</div>
              {resolvedStudent?.phone && (
                <div className="text-xs mt-0.5" style={{ color: "#4E6070" }}>
                  {resolvedStudent.phone}
                </div>
              )}
            </div>

            {duplicateError && (
              <div
                className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-xs"
                style={{ background: `${RED}12`, color: RED, border: `1px solid ${RED}30` }}
              >
                <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                {duplicateError}
              </div>
            )}

            {activePackages.length === 0 ? (
              <div
                className="text-sm px-3 py-2.5 rounded-xl"
                style={{ background: `${AMBER}10`, color: AMBER, border: `1px solid ${AMBER}25` }}
              >
                No active packages found. You can still check in without deducting a credit.
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#8A9AB0" }}>
                  Active Packages
                </p>
                {activePackages.map((pkg) => (
                  <button
                    key={pkg.id}
                    onClick={() => setSelectedPackageId(selectedPackageId === pkg.id ? null : pkg.id)}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm text-left transition-all"
                    style={{
                      background: selectedPackageId === pkg.id ? `${STUDIO_CYAN}15` : "hsl(203 30% 14%)",
                      border: `1px solid ${selectedPackageId === pkg.id ? STUDIO_CYAN + "50" : "hsl(203 30% 18%)"}`,
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

            <div>
              <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: "#8A9AB0" }}>
                Today's Class
              </label>
              <div className="relative">
                <select
                  value={selectedScheduleId}
                  onChange={(e) => setSelectedScheduleId(Number(e.target.value))}
                  className="w-full rounded-xl px-3 py-2.5 text-sm text-white appearance-none pr-8"
                  style={{ background: "hsl(203 30% 14%)", border: "1px solid hsl(203 30% 20%)", outline: "none" }}
                >
                  <option value={MANUAL_SCHEDULE_ID}>Not listed / Enter manually</option>
                  {schedules.map((s) => (
                    <option key={s.scheduleId} value={s.scheduleId}>
                      {s.classTitle} · {formatTime(s.startTime)}
                      {s.instructorName ? ` · ${s.instructorName}` : ""}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none" style={{ color: "#8A9AB0" }} />
              </div>
            </div>

            {isManualSchedule && (
              <div>
                <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: "#8A9AB0" }}>
                  Class Title (optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Hip Hop Adults"
                  value={manualClassTitle}
                  onChange={(e) => setManualClassTitle(e.target.value)}
                  className="w-full rounded-xl px-3 py-2.5 text-sm text-white"
                  style={{ background: "hsl(203 30% 14%)", border: "1px solid hsl(203 30% 20%)", outline: "none" }}
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
                onClick={() => { void stopScanner(); resetToScan(); }}
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
                onClick={() => { void stopScanner(); resetToScan(); }}
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
                onClick={() => { void stopScanner(); resetToScan(); }}
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
