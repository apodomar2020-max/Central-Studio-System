import { useCallback, useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  useListPackageOrders,
  getListAttendanceQueryKey,
  getListPackageOrdersQueryKey,
} from "@workspace/api-client-react";
import type { CheckInQrResponse, Booking } from "@workspace/api-client-react";
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
type PaymentMode = "package_credit" | "pay_at_studio";

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

function bookingStatusStyle(status: string): { background: string; color: string } {
  switch (status) {
    case "confirmed":
      return { background: `${GREEN}18`, color: GREEN };
    case "pending":
      return { background: `${AMBER}18`, color: AMBER };
    case "pendingPayment":
      return { background: "#F9731618", color: "#F97316" };
    case "completed":
    case "attended":
      return { background: `${GREEN}18`, color: GREEN };
    case "cancelled":
      return { background: "#6B728018", color: "#9CA3AF" };
    case "rejected":
    case "failed":
      return { background: `${RED}18`, color: RED };
    default:
      return { background: "hsl(203 30% 20%)", color: "#8A9AB0" };
  }
}

function paymentStatusStyle(status: string): { background: string; color: string } {
  switch (status) {
    case "paid":
    case "not_required":
      return { background: `${GREEN}18`, color: GREEN };
    case "pending_payment":
      return { background: `${AMBER}18`, color: AMBER };
    case "refunded":
      return { background: "hsl(203 30% 20%)", color: "#8A9AB0" };
    default:
      return { background: `${RED}18`, color: RED };
  }
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: "Pending",
    confirmed: "Confirmed",
    rejected: "Rejected",
    cancelled: "Cancelled",
    attended: "Attended",
    completed: "Completed",
    pendingPayment: "Pending Payment",
    pending_payment: "Pending Payment",
    not_required: "No Payment",
    paid: "Paid",
    refunded: "Refunded",
    failed: "Failed",
  };
  return labels[status] ?? status;
}

// ─── Booking ownership / scope helpers ─────────────────────────────────────────
// A booking is a "child" booking when its scope says so, or when a participant
// child is linked; otherwise it is the account owner's own ("self") booking.
function bookingScopeOf(bk: Booking): "self" | "child" {
  return bk.bookingScope === "child" || bk.participantChildId != null ? "child" : "self";
}

// Sort priority: confirmed+paid → confirmed+(package/no-payment) → confirmed+pending
// → everything else. Lower rank sorts first.
function bookingSortRank(bk: Booking): number {
  const bs = bk.bookingStatus ?? bk.status;
  const ps = bk.paymentStatus ?? "not_required";
  if (bs === "confirmed" && ps === "paid") return 0;
  if (bs === "confirmed" && (ps === "not_required" || bk.paymentMode === "package_credit")) return 1;
  if (bs === "confirmed" && ps === "pending_payment") return 2;
  return 3;
}

function isBookingCheckInEligible(bk: Booking): boolean {
  // Eligible ONLY when the backend explicitly authorises check-in right now
  // (confirmed + today's occurrence + inside the grace window + not already
  // attended). Strict `=== true` — so pending, attended, cancelled, rejected,
  // future, past and legacy bookings (whose checkInEligible is not true) are all
  // hidden from the default reception list. We never fall back to a status guess.
  return bk.checkInEligible === true && bk.alreadyCheckedIn !== true;
}

function bookingBlockedReason(bk: Booking): string {
  return bk.checkInBlockedReason ?? (bk.alreadyCheckedIn ? "Already checked in" : "Not eligible for check-in");
}

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
  canCheckIn,
  canPackageDeduct,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canCheckIn: boolean;
  canPackageDeduct: boolean;
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
  // Explicit Walk-in settlement choice — no default, per the mandatory
  // 3-way settlement policy. See STUDIO_WALKIN_EXPLICIT_SETTLEMENT_POLICY.md.
  // The mere existence of a valid package credit must never pre-select
  // "package_credit"; this only ever changes via an explicit Admin click.
  const [walkInSettlement, setWalkInSettlement] = useState<
    "package_credit" | "pay_at_studio" | "not_paid" | null
  >(null);

  const [resolveError, setResolveError] = useState("");
  const [duplicateError, setDuplicateError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Credit ledger — QR check-in path
  const [scannedQrToken, setScannedQrToken] = useState<string | null>(null);
  // studentBookings = the ELIGIBLE bookings only (the default reception list).
  const [studentBookings, setStudentBookings] = useState<Booking[]>([]);
  // allStudentBookings = every booking returned for the member, used ONLY when the
  // optional "Show all" debug toggle is on (shows blocked bookings, disabled).
  const [allStudentBookings, setAllStudentBookings] = useState<Booking[]>([]);
  const [showAllBookings, setShowAllBookings] = useState(false);
  // Quick filter for the booking list: all participants, self only, or children only.
  const [scopeFilter, setScopeFilter] = useState<"all" | "self" | "child">("all");
  const [selectedBookingId, setSelectedBookingId] = useState<number | null>(null);
  const [paymentMode, setPaymentMode] = useState<PaymentMode | null>(null);

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
    setWalkInSettlement(null);
    setResolveError("");
    setDuplicateError("");
    setSuccessMsg("");
    setScannedQrToken(null);
    setStudentBookings([]);
    setAllStudentBookings([]);
    setShowAllBookings(false);
    setSelectedBookingId(null);
    setScopeFilter("all");
    setPaymentMode(null);
  }

  const handleScanResult = useCallback(async (decoded: string) => {
    if (processedRef.current) return;
    const result = extractScanResult(decoded);
    if (!result) return;
    processedRef.current = true;

    await stopScanner();

    if (result.type === "token") {
      setScannedQrToken(result.token);
      setPhase("resolving");
      setResolveError("");
      try {
        const student = await customFetch<ResolvedStudent>(
          `/api/students/by-token/${result.token}`,
        );
        setResolvedStudent(student);
        // Fetch bookings and today's schedules in parallel
        const [bookings] = await Promise.all([
          customFetch<Booking[]>(
            `/api/bookings?studentEmail=${encodeURIComponent(student.email)}`,
          ).catch(() => [] as Booking[]),
          fetchSchedules(),
        ]);
        // Default reception list = ONLY bookings the backend marks
        // checkInEligible === true (confirmed, today's occurrence, inside the
        // grace window, not already attended). Pending, attended, cancelled,
        // rejected, future, past and legacy bookings are never shown by default.
        // The full set is kept for the optional, off-by-default "Show all" toggle.
        const eligible = bookings.filter(isBookingCheckInEligible);
        setAllStudentBookings(bookings);
        setStudentBookings(eligible);
        if (eligible.length === 1) setSelectedBookingId(eligible[0].id);
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
    if (!canCheckIn) {
      setDuplicateError("You do not have permission to check in this student.");
      return;
    }
    if (!effectiveStudentEmail) return;
    setDuplicateError("");
    setPhase("submitting");

    // ── Path A: QR endpoint (token scan + booking selected) ──────────────────
    // Uses the credit ledger and atomically marks the booking as attended.
    if (scannedQrToken && selectedBookingId) {
      if (!paymentMode) {
        setDuplicateError("Choose Package Credit or Pay at Studio before checking in.");
        setPhase("selecting");
        return;
      }
      if (paymentMode === "package_credit" && !selectedPackageId) {
        setDuplicateError("Choose the package to deduct from before checking in.");
        setPhase("selecting");
        return;
      }
      if (paymentMode === "package_credit" && !canPackageDeduct) {
        setDuplicateError("You do not have permission to deduct package credits.");
        setPhase("selecting");
        return;
      }

      try {
        const row = await customFetch<CheckInQrResponse>("/api/check-in/qr", {
          method: "POST",
          body: JSON.stringify({
            qrToken: scannedQrToken,
            bookingId: selectedBookingId,
            paymentMode,
            packageOrderId: paymentMode === "package_credit" ? selectedPackageId : undefined,
          }),
        });

        queryClient.invalidateQueries({ queryKey: getListAttendanceQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListPackageOrdersQueryKey() });

        const credits = row.remainingCredits;
        setSuccessMsg(
          `${row.studentName} checked in${
            row.creditDeducted
              ? ` — 1 credit deducted${credits != null ? ` (${credits} remaining)` : ""}`
              : ""
          }`,
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
      return;
    }

    // In the QR token flow, check-in must go through an eligible booking. Never
    // fall through to the legacy manual path for a scanned member — that would
    // bypass the Phase A confirmed/today-occurrence rules.
    if (scannedQrToken) {
      setDuplicateError("Select an eligible booking for today to check this member in.");
      setPhase("selecting");
      return;
    }

    // ── Path B: Walk-in / legacy attendance endpoint (email scan, no booking) ──
    // Records walk-in attendance. `walkInSettlement` is a mandatory explicit
    // Admin choice — there is no default and no inference from package
    // availability. See STUDIO_WALKIN_EXPLICIT_SETTLEMENT_POLICY.md.
    if (!walkInSettlement) {
      setResolveError("Choose a settlement method (Use Package Credit, Pay at Studio, or Not Paid) before checking in.");
      setPhase("error");
      return;
    }
    if (walkInSettlement === "package_credit" && (!canPackageDeduct || !selectedPackageId)) {
      setResolveError("Select a package with available credit to use Package Credit.");
      setPhase("error");
      return;
    }
    if (walkInSettlement === "not_paid") {
      // Cancelled at the UI boundary — no attendance-creation request is
      // sent at all, so there is nothing for the backend to no-op against.
      setSuccessMsg("Walk-in cancelled — marked Not Paid. No records were created.");
      setPhase("done");
      return;
    }

    const body = {
      studentEmail: effectiveStudentEmail,
      studentName: effectiveStudentName,
      packageOrderId: walkInSettlement === "package_credit" ? selectedPackageId : null,
      classTitle: effectiveClassTitle || null,
      notes: null,
      studentId: effectiveStudentId,
      classId: effectiveClassId,
      scheduleId: effectiveScheduleId,
      settlementMode: walkInSettlement,
    };

    try {
      const row = await customFetch<{ studentName: string; creditDeducted: boolean }>(
        "/api/attendance",
        { method: "POST", body: JSON.stringify(body) },
      );

      queryClient.invalidateQueries({ queryKey: getListAttendanceQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListPackageOrdersQueryKey() });

      setSuccessMsg(
        `${row.studentName} checked in${walkInSettlement === "package_credit" ? " — 1 credit deducted" : walkInSettlement === "pay_at_studio" ? " — paid at studio" : ""}`,
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

  // Default list is eligible-only; the "Show all" debug toggle widens it to every
  // booking (ineligible rows render disabled with their blocked reason).
  const displayBookings = showAllBookings ? allStudentBookings : studentBookings;
  // Number of ineligible bookings that the toggle would reveal.
  const ineligibleCount = allStudentBookings.length - studentBookings.length;
  // Booking list filtered by the scope chip and sorted by check-in priority.
  const visibleBookings = displayBookings
    .filter((bk) => scopeFilter === "all" || bookingScopeOf(bk) === scopeFilter)
    .slice()
    .sort((a, b) => bookingSortRank(a) - bookingSortRank(b));
  const selectedBooking = displayBookings.find((bk) => bk.id === selectedBookingId) ?? null;
  const selectedBookingEligible = selectedBooking ? isBookingCheckInEligible(selectedBooking) : true;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md border-0 max-h-[85vh] overflow-y-auto"
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

            {/* Optional debug/support toggle — OFF by default. Reveals blocked
                bookings (pending / attended / future / …) as DISABLED rows so
                reception can see why a member has no eligible class, without ever
                being able to check them in. Never the default reception view. */}
            {isTokenFlow && ineligibleCount > 0 && (
              <button
                onClick={() => setShowAllBookings((v) => !v)}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all"
                style={{
                  background: showAllBookings ? `${AMBER}15` : "hsl(203 30% 12%)",
                  color: showAllBookings ? AMBER : "#8A9AB0",
                  border: `1px solid ${showAllBookings ? AMBER + "40" : "hsl(203 30% 18%)"}`,
                }}
              >
                {showAllBookings
                  ? "Hide ineligible bookings"
                  : `Show all bookings (${ineligibleCount} ineligible · debug)`}
              </button>
            )}

            {/* ── Booking picker (token flow only, credit ledger path) ─────── */}
            {isTokenFlow && displayBookings.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#8A9AB0" }}>
                    Select Booking
                  </p>
                  <div className="flex items-center gap-1">
                    {(["all", "self", "child"] as const).map((v) => (
                      <button
                        key={v}
                        onClick={() => setScopeFilter(v)}
                        className="px-2.5 py-0.5 rounded-full text-[11px] font-medium transition-all"
                        style={
                          scopeFilter === v
                            ? { background: `${STUDIO_CYAN}20`, color: STUDIO_CYAN, border: `1px solid ${STUDIO_CYAN}40` }
                            : { background: "transparent", color: "#8A9AB0", border: "1px solid hsl(203 30% 18%)" }
                        }
                      >
                        {v === "all" ? "All" : v === "self" ? "Self" : "Children"}
                      </button>
                    ))}
                  </div>
                </div>
                {visibleBookings.length === 0 && (
                  <p className="text-xs px-1 py-2" style={{ color: "#4E6070" }}>
                    No {scopeFilter === "child" ? "children" : scopeFilter} bookings.
                  </p>
                )}
                {visibleBookings.map((bk) => {
                  const title = bk.displayTitle ?? bk.classTitle ?? `Booking #${bk.id}`;
                  const scheduleLine = bk.scheduleLabel ?? "Schedule not set";
                  const bookingStatus = bk.bookingStatus ?? bk.status;
                  const paymentStatus = bk.paymentStatus ?? "not_required";
                  const statusStyle = bookingStatusStyle(bookingStatus);
                  const payStyle = paymentStatusStyle(paymentStatus);
                  const scope = bookingScopeOf(bk);
                  const participant = bk.participantName ?? bk.studentName;
                  const ownerName = bk.accountOwnerName ?? bk.studentName;
                  const ownerEmail = bk.accountOwnerEmail ?? bk.studentEmail;
                  const eligible = isBookingCheckInEligible(bk);
                  return (
                    <button
                      key={bk.id}
                      onClick={() => {
                        if (!eligible) return;
                        const nextId = selectedBookingId === bk.id ? null : bk.id;
                        setSelectedBookingId(nextId);
                        setSelectedPackageId(null);
                        setPaymentMode(null);
                      }}
                      disabled={!eligible}
                      className="w-full flex items-start justify-between gap-2 px-3 py-2.5 rounded-xl text-sm text-left transition-all disabled:cursor-not-allowed"
                      style={{
                        background: selectedBookingId === bk.id ? `${STUDIO_CYAN}15` : "hsl(203 30% 14%)",
                        border: `1px solid ${selectedBookingId === bk.id ? STUDIO_CYAN + "50" : "hsl(203 30% 18%)"}`,
                        opacity: eligible ? 1 : 0.58,
                      }}
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-white truncate">{title}</div>
                        <div className="text-[11px] mt-0.5" style={{ color: "#C8D4E0" }}>
                          Participant: <span className="text-white font-medium">{participant}</span>
                        </div>
                        <div className="text-[11px] truncate" style={{ color: "#4E6070" }}>
                          Owner: {ownerName}{ownerEmail ? ` · ${ownerEmail}` : ""}
                        </div>
                        <div className="text-xs mt-0.5" style={{ color: "#8A9AB0" }}>
                          {scheduleLine}
                        </div>
                        {bk.instructorName && (
                          <div className="text-xs mt-0.5" style={{ color: "#4E6070" }}>
                            Instructor: {bk.instructorName}
                          </div>
                        )}
                        {bk.scheduleLocation && (
                          <div className="text-xs mt-0.5" style={{ color: "#4E6070" }}>
                            {bk.scheduleLocation}
                          </div>
                        )}
                        {!eligible && (
                          <div className="text-xs mt-1 font-medium" style={{ color: AMBER }}>
                            {bookingBlockedReason(bk)}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <span
                          className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                          style={scope === "child" ? { background: `${AMBER}20`, color: AMBER } : { background: `${STUDIO_CYAN}18`, color: STUDIO_CYAN }}
                        >
                          {scope === "child" ? "Child" : "Self"}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded-full" style={statusStyle}>
                          {statusLabel(bookingStatus)}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded-full" style={payStyle}>
                          {statusLabel(paymentStatus)}
                        </span>
                      </div>
                    </button>
                  );
                })}
                {selectedBookingId && selectedBookingEligible && (
                  <>
                    <p className="text-xs" style={{ color: STUDIO_CYAN }}>
                      Choose how this check-in is being paid before confirming.
                    </p>
                    {studentBookings.find((bk) => bk.id === selectedBookingId)?.paymentMode === "pay_at_studio" &&
                      studentBookings.find((bk) => bk.id === selectedBookingId)?.paymentStatus !== "paid" && (
                        <p className="text-xs" style={{ color: AMBER }}>
                          Payment not marked as paid yet.
                        </p>
                      )}
                  </>
                )}
              </div>
            )}

            {/* No confirmed booking for today's occurrence — nothing to check in.
                (Shown when the current list is empty; with "Show all" off this
                means there is no ELIGIBLE booking today.) */}
            {isTokenFlow && displayBookings.length === 0 && (
              <div
                className="flex flex-col items-center gap-1.5 px-3 py-6 rounded-xl text-center"
                style={{ background: "hsl(203 30% 12%)", border: "1px solid hsl(203 30% 18%)" }}
              >
                <AlertTriangle className="h-5 w-5" style={{ color: AMBER }} />
                <p className="text-sm font-semibold text-white">No eligible class today</p>
                <p className="text-xs" style={{ color: "#8A9AB0" }}>
                  This member has no confirmed booking for today&apos;s class. Check-in opens 2 hours before the class starts.
                </p>
              </div>
            )}

            {canCheckIn && isTokenFlow && selectedBookingId && selectedBookingEligible && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#8A9AB0" }}>
                  Check-in Mode
                </p>
                {canPackageDeduct && selectedBooking && bookingScopeOf(selectedBooking) === "child" && activePackages.length > 0 && (
                  <p className="text-[11px] px-1" style={{ color: AMBER }}>
                    Credits will be deducted from the account owner&apos;s package.
                  </p>
                )}
                <button
                  onClick={() => {
                    setPaymentMode("pay_at_studio");
                    setSelectedPackageId(null);
                  }}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm text-left transition-all"
                  style={{
                    background: paymentMode === "pay_at_studio" ? `${AMBER}15` : "hsl(203 30% 14%)",
                    border: `1px solid ${paymentMode === "pay_at_studio" ? AMBER + "55" : "hsl(203 30% 18%)"}`,
                  }}
                >
                  <span className="font-medium text-white">Pay at Studio / Cash</span>
                  <span className="text-xs" style={{ color: AMBER }}>No credit deduction</span>
                </button>

                {canPackageDeduct && (activePackages.length === 0 ? (
                  <div
                    className="text-sm px-3 py-2.5 rounded-xl"
                    style={{ background: `${AMBER}10`, color: AMBER, border: `1px solid ${AMBER}25` }}
                  >
                    No active packages with credits found.
                  </div>
                ) : (
                  activePackages.map((pkg) => (
                    <button
                      key={pkg.id}
                      onClick={() => {
                        setPaymentMode("package_credit");
                        setSelectedPackageId(pkg.id);
                      }}
                      disabled={pkg.remainingCredits <= 0}
                      className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm text-left transition-all disabled:opacity-40"
                      style={{
                        background:
                          paymentMode === "package_credit" && selectedPackageId === pkg.id
                            ? `${STUDIO_CYAN}15`
                            : "hsl(203 30% 14%)",
                        border: `1px solid ${
                          paymentMode === "package_credit" && selectedPackageId === pkg.id
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
                  ))
                ))}
              </div>
            )}

            {/* Package picker + manual schedule are LEGACY (email-scan / walk-in)
                controls only. In the QR token flow, check-in must go through an
                eligible booking — never a manually picked class. */}
            {canCheckIn && canPackageDeduct && !isTokenFlow && (
              activePackages.length === 0 ? (
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
              )
            )}

            {/* Schedule + manual credit controls — legacy (email-scan) path only;
                hidden entirely in the QR token flow. */}
            {!isTokenFlow && (<>
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

              {/* Mandatory Walk-in settlement choice — no option is pre-selected.
                  Package availability never decides this automatically. */}
              <div>
                <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: "#8A9AB0" }}>
                  Settlement Method (required)
                </label>
                <div className="grid grid-cols-1 gap-2">
                  <button
                    type="button"
                    onClick={() => setWalkInSettlement("package_credit")}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm text-left transition-all"
                    style={{
                      background: walkInSettlement === "package_credit" ? `${STUDIO_CYAN}15` : "hsl(203 30% 14%)",
                      border: `1px solid ${walkInSettlement === "package_credit" ? STUDIO_CYAN + "50" : "hsl(203 30% 18%)"}`,
                    }}
                  >
                    <span className="font-medium text-white">Use Package Credit</span>
                  </button>
                  {walkInSettlement === "package_credit" && (!canPackageDeduct || activePackages.length === 0) && (
                    <div
                      className="text-sm px-3 py-2.5 rounded-xl"
                      style={{ background: `${AMBER}10`, color: AMBER, border: `1px solid ${AMBER}25` }}
                    >
                      No valid package credit is available — choose Pay at Studio or Not Paid instead.
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setWalkInSettlement("pay_at_studio")}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm text-left transition-all"
                    style={{
                      background: walkInSettlement === "pay_at_studio" ? `${STUDIO_CYAN}15` : "hsl(203 30% 14%)",
                      border: `1px solid ${walkInSettlement === "pay_at_studio" ? STUDIO_CYAN + "50" : "hsl(203 30% 18%)"}`,
                    }}
                  >
                    <span className="font-medium text-white">Pay at Studio</span>
                  </button>
                  {walkInSettlement === "pay_at_studio" && (
                    <div
                      className="text-sm px-3 py-2.5 rounded-xl"
                      style={{ background: `${STUDIO_CYAN}10`, color: STUDIO_CYAN, border: `1px solid ${STUDIO_CYAN}25` }}
                    >
                      The single-class price will be charged. Package credits will not be used, even if available.
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setWalkInSettlement("not_paid")}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm text-left transition-all"
                    style={{
                      background: walkInSettlement === "not_paid" ? `${STUDIO_CYAN}15` : "hsl(203 30% 14%)",
                      border: `1px solid ${walkInSettlement === "not_paid" ? STUDIO_CYAN + "50" : "hsl(203 30% 18%)"}`,
                    }}
                  >
                    <span className="font-medium text-white">Not Paid</span>
                  </button>
                  {walkInSettlement === "not_paid" && (
                    <div
                      className="text-sm px-3 py-2.5 rounded-xl"
                      style={{ background: `${AMBER}10`, color: AMBER, border: `1px solid ${AMBER}25` }}
                    >
                      This walk-in will be cancelled — no attendance, booking, payment, or credit records will be created.
                    </div>
                  )}
                </div>
              </div>
            </>)}

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => { void stopScanner(); resetToScan(); }}
                className="px-4 py-3 rounded-xl text-sm font-semibold"
                style={{ background: "hsl(203 30% 14%)", color: "#8A9AB0" }}
              >
                Back
              </button>
              {canCheckIn ? (
                <button
                  onClick={() => void handleCheckIn()}
                  disabled={
                    Boolean(
                      scannedQrToken
                        ? !selectedBookingId ||
                            !selectedBookingEligible ||
                            !paymentMode ||
                            (paymentMode === "package_credit" && (!canPackageDeduct || !selectedPackageId))
                        : !isTokenFlow &&
                            (!walkInSettlement ||
                              (walkInSettlement === "package_credit" && (!canPackageDeduct || !selectedPackageId))),
                    )
                  }
                  className="flex-1 py-3 rounded-xl text-sm font-bold disabled:opacity-40"
                  style={{ background: STUDIO_CYAN, color: "#000" }}
                >
                  Check In
                </button>
              ) : (
                <div className="flex-1 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-center text-xs font-medium text-amber-400">
                  Check-in permission required
                </div>
              )}
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
