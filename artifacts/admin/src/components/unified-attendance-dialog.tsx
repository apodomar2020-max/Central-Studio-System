/**
 * UnifiedAttendanceDialog — the single Admin Attendance gateway for Scan QR,
 * Search Parent Phone, and Search Child Name, spanning both Studio and
 * Ballet, plus Studio Walk-in for a participant checking into a Schedule
 * occurrence they don't already have an eligible Booking for. Walk-in is
 * always offered as a secondary action per account — never hidden just
 * because the account (or that exact participant) has an eligible Booking
 * for a DIFFERENT class or occurrence; only the SAME occurrence a Booking
 * already covers is excluded, and that exclusion is enforced server-side
 * (see studioWalkIn.ts).
 * Calls the unified resolver/confirm backend (routes/adminAttendanceGateway.ts)
 * — never writes attendance from the resolve step, and never auto-selects a
 * candidate: the admin always sees an explicit confirmation step, even when
 * exactly one candidate is eligible.
 *
 * Camera lifecycle mirrors scan-check-in-dialog.tsx's proven
 * idle/requesting/active/denied/unsupported/error state machine — kept
 * separate rather than shared so the existing, already-tested Studio-only
 * QR dialog is never touched by this addition.
 *
 * Layout: DialogContent is a fixed-height flex column with a non-scrolling
 * header and footer; only the middle body scrolls. This is what makes the
 * Confirm/Back/Cancel actions sticky regardless of candidate-list length.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  CheckCircle2,
  AlertTriangle,
  Loader2,
  User2,
  Phone,
  Search,
  QrCode,
  VideoOff,
  ArrowLeft,
  DoorOpen,
  Clock,
} from "lucide-react";

const CYAN = "#00B6D7";
const PURPLE = "#8B5CF6"; // Ballet program badge
const AMBER = "#F59E0B";
const GREEN = "#22C55E";
const RED = "#EF4444";
const MUTED = "hsl(var(--muted-foreground))";
const BORDER = "hsl(var(--border))";
const CARD = "hsl(var(--card))";

const SCAN_REGION_ID = "unified-attendance-scan-region";

type Mode = "scan" | "phone" | "childName";
type CameraStatus = "idle" | "requesting" | "active" | "denied" | "unsupported" | "error";
type Phase =
  | "search"
  | "resolving"
  | "results"
  | "confirming"
  | "walkInParticipants"
  | "walkInOptions"
  | "walkInPayment"
  | "walkInConfirming"
  | "submitting"
  | "done"
  | "error";

interface Candidate {
  candidateKey: string;
  program: "studio" | "ballet";
  participantType: "account" | "child";
  participantId: number;
  participantName: string;
  participantInitials: string;
  parentName: string;
  maskedParentPhone: string | null;
  bookingId: number | null;
  balletApplicationId: number | null;
  balletLevelAssignmentId: number | null;
  classId: number | null;
  className: string | null;
  scheduleId: number | null;
  occurrenceDate: string;
  dayOfWeek: number | null;
  startTime: string | null;
  endTime: string | null;
  durationMinutes: number | null;
  level: { id: number; name: string } | null;
  group: { id: number; name: string } | null;
  eligibility: "eligible" | "too_early" | "ended" | "already_recorded" | "inactive_enrollment" | "no_active_subscription" | "cancelled" | "invalid_assignment" | "not_scheduled_today";
  reason: string | null;
  existingAttendanceId: number | null;
}

interface AccountGroup {
  accountId: number;
  accountName: string;
  // Used only to correlate this selected account against
  // /admin/package-orders (which exposes studentEmail, not a numeric id)
  // for Studio package-credit checkout — never rendered.
  accountEmail: string;
  maskedPhone: string | null;
  candidates: Candidate[];
}

interface ResolverResponse {
  source: "qr" | "phone" | "childName";
  accounts: AccountGroup[];
}

interface LegacyPackageOrder {
  id: number;
  packageName: string;
  totalCredits: number;
  remainingCredits: number;
  studentEmail: string;
  status: string;
}

interface WalkInParticipant {
  type: "self" | "child";
  childId: number | null;
  name: string;
}

interface WalkInOption {
  candidateKey: string;
  classId: number;
  scheduleId: number;
  className: string;
  instructorName: string | null;
  occurrenceDate: string;
  startTime: string;
  endTime: string;
  priceEgp: number;
  packageEligible: boolean;
}

function formatTime(t: string | null): string {
  if (!t) return "";
  const match = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!match) return t;
  const h = Number(match[1]);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${match[2]} ${period}`;
}

function eligibilityLabel(candidate: Candidate): { label: string; color: string } {
  switch (candidate.eligibility) {
    case "eligible": return { label: "Eligible now", color: GREEN };
    case "too_early": return { label: candidate.reason ?? "Too early", color: AMBER };
    case "ended": return { label: candidate.reason ?? "Closed", color: MUTED };
    case "already_recorded": return { label: candidate.reason ?? "Already recorded", color: MUTED };
    case "no_active_subscription": return { label: candidate.reason ?? "No active subscription", color: RED };
    case "cancelled": return { label: candidate.reason ?? "Cancelled", color: RED };
    default: return { label: candidate.reason ?? candidate.eligibility, color: RED };
  }
}

/** Maps a backend {error,message} pair to accurate, non-technical copy.
 *  Never falls through to the raw backend message for a known code, so a
 *  SQL/internal string can never reach the admin. */
function mapConfirmError(err: unknown): string {
  const data = err !== null && typeof err === "object" && "data" in err
    ? (err as { data?: { message?: string; error?: string } }).data
    : null;
  const status = err !== null && typeof err === "object" && "status" in err
    ? (err as { status: number }).status
    : 0;
  const code = data?.error;
  switch (code) {
    case "invalid_qr":
    case "account_not_found":
      return "Account not found.";
    case "booking_not_found":
      return "This booking could not be found.";
    case "booking_mismatch":
      return "This selection does not belong to the resolved account.";
    case "already_attended":
    case "duplicate_attendance":
      return "Attendance already recorded.";
    case "check_in_too_early":
      return "Check-in has not opened yet.";
    case "check_in_closed":
      return "Check-in window has ended.";
    case "no_credits":
      return "No available Studio credit.";
    case "no_active_subscription":
      return "No active Ballet subscription.";
    case "package_not_eligible":
    case "invalid_package":
    case "package_not_found":
      return "Could not record the Pay at Studio payment.";
    case "booking_not_actionable":
      return "Selected Schedule is no longer active.";
    case "candidate_key_mismatch":
      return "This selection is stale — please search again.";
    case "booking_exists_use_normal_checkin":
      return "This participant already has a Booking for this class — use the normal check-in above instead of Walk-in.";
    default:
      if (status === 0) return "Connection failed — check your network and try again.";
      return "Could not record attendance — please try again.";
  }
}

function mapResolveError(err: unknown): string {
  const status = err !== null && typeof err === "object" && "status" in err
    ? (err as { status: number }).status
    : 0;
  if (status === 0) return "Connection failed — check your network and try again.";
  if (status === 400) return "Invalid Central Studio QR.";
  if (status === 404) return "Account not found.";
  return "Could not resolve this search — please try again.";
}

async function requestCameraPermission(): Promise<CameraStatus> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
    return "unsupported";
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    stream.getTracks().forEach((track) => track.stop());
    return "active";
  } catch (err: unknown) {
    const name = err instanceof Error ? err.name : "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") return "denied";
    if (name === "NotFoundError" || name === "DevicesNotFoundError") return "unsupported";
    return "error";
  }
}

export function UnifiedAttendanceDialog({
  open,
  onOpenChange,
  canCheckIn,
  canPackageDeduct,
  canScan,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canCheckIn: boolean;
  canPackageDeduct: boolean;
  canScan: boolean;
}) {
  const queryClient = useQueryClient();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const startingRef = useRef(false);
  const processedRef = useRef(false);

  const [mode, setMode] = useState<Mode>(canScan ? "scan" : "phone");
  const [phase, setPhase] = useState<Phase>("search");
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>("idle");
  const [cameraError, setCameraError] = useState("");

  const [phoneQuery, setPhoneQuery] = useState("");
  const [nameQuery, setNameQuery] = useState("");

  const [resolverResult, setResolverResult] = useState<ResolverResponse | null>(null);
  const [selected, setSelected] = useState<{ account: AccountGroup; candidate: Candidate } | null>(null);
  const [paymentMode, setPaymentMode] = useState<"package_credit" | "pay_at_studio">("pay_at_studio");
  const [selectedPackageId, setSelectedPackageId] = useState<number | null>(null);

  // ── Walk-in state ───────────────────────────────────────────────────────
  const [walkInAccount, setWalkInAccount] = useState<{ accountId: number; accountName: string } | null>(null);
  const [walkInParticipants, setWalkInParticipants] = useState<WalkInParticipant[]>([]);
  const [walkInParticipant, setWalkInParticipant] = useState<WalkInParticipant | null>(null);
  const [walkInOptions, setWalkInOptions] = useState<WalkInOption[]>([]);
  const [walkInSelectedOption, setWalkInSelectedOption] = useState<WalkInOption | null>(null);
  const [walkInPaymentDecision, setWalkInPaymentDecision] = useState<"package_credit" | "paid_at_studio" | null>(null);
  const [walkInPackageOrderId, setWalkInPackageOrderId] = useState<number | null>(null);

  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const { data: allPackageOrders = [] } = useListPackageOrders();

  function resetAll() {
    processedRef.current = false;
    setPhase("search");
    setPhoneQuery("");
    setNameQuery("");
    setResolverResult(null);
    setSelected(null);
    setPaymentMode("pay_at_studio");
    setSelectedPackageId(null);
    setWalkInAccount(null);
    setWalkInParticipants([]);
    setWalkInParticipant(null);
    setWalkInOptions([]);
    setWalkInSelectedOption(null);
    setWalkInPaymentDecision(null);
    setWalkInPackageOrderId(null);
    setErrorMessage("");
    setSuccessMessage("");
  }

  // ── Camera lifecycle (Scan mode only) ───────────────────────────────────────

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

  const runResolve = useCallback(async (source: "qr" | "phone" | "childName", query: string) => {
    setPhase("resolving");
    setErrorMessage("");
    try {
      const result = await customFetch<ResolverResponse>("/api/admin/attendance/resolve", {
        method: "POST",
        body: JSON.stringify({ source, query }),
      });
      setResolverResult(result);
      setPhase("results");
    } catch (err: unknown) {
      setErrorMessage(mapResolveError(err));
      setPhase("error");
    }
  }, []);

  const handleScanResult = useCallback(async (decodedText: string) => {
    if (processedRef.current) return;
    processedRef.current = true;
    await stopScanner();
    setCameraStatus("idle");
    await runResolve("qr", decodedText);
  }, [runResolve]);

  const startCamera = useCallback(async () => {
    if (startingRef.current || scannerRef.current) return;
    startingRef.current = true;
    setCameraStatus("requesting");
    setCameraError("");

    const permResult = await requestCameraPermission();
    if (permResult !== "active") {
      startingRef.current = false;
      setCameraStatus(permResult);
      setCameraError(
        permResult === "denied"
          ? "Camera access was denied. Click 'Retry' to request permission again, or use Parent Phone / Child Name search."
          : "Camera not available. Use Parent Phone / Child Name search instead.",
      );
      return;
    }

    const el = document.getElementById(SCAN_REGION_ID);
    if (!el || el.clientWidth === 0) {
      startingRef.current = false;
      setCameraStatus("error");
      setCameraError("Scanner container is not visible. Please close and reopen this dialog.");
      return;
    }

    try {
      const html5 = new Html5Qrcode(SCAN_REGION_ID, { verbose: false });
      scannerRef.current = html5;
      const startConfig = { fps: 10 };
      try {
        await html5.start({ facingMode: "environment" }, startConfig, (text) => { void handleScanResult(text); }, () => {});
      } catch {
        await html5.start({ facingMode: "user" }, startConfig, (text) => { void handleScanResult(text); }, () => {});
      }
      setCameraStatus("active");
      startingRef.current = false;
    } catch (err: unknown) {
      startingRef.current = false;
      await stopScanner();
      setCameraStatus("error");
      const msg = err instanceof Error ? err.message : String(err);
      setCameraError(`Camera failed to start: ${msg}.`);
    }
  }, [handleScanResult]);

  useEffect(() => {
    if (open) {
      resetAll();
    } else {
      void stopScanner();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || mode !== "scan" || phase !== "search") { void stopScanner(); return; }
    let raf1: number;
    let raf2: number;
    let dead = false;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => { if (!dead) void startCamera(); });
    });
    return () => {
      dead = true;
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
      void stopScanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, phase]);

  // ── Search submit handlers ──────────────────────────────────────────────────

  function submitPhone() {
    if (!phoneQuery.trim()) return;
    void runResolve("phone", phoneQuery.trim());
  }
  function submitName() {
    if (nameQuery.trim().length < 2) return;
    void runResolve("childName", nameQuery.trim());
  }

  function pickCandidate(account: AccountGroup, candidate: Candidate) {
    setSelected({ account, candidate });
    setPaymentMode("pay_at_studio");
    setSelectedPackageId(null);
    setPhase("confirming");
  }

  function backToResults() {
    setSelected(null);
    setWalkInAccount(null);
    setWalkInParticipant(null);
    setWalkInOptions([]);
    setWalkInSelectedOption(null);
    setWalkInPaymentDecision(null);
    setWalkInPackageOrderId(null);
    setPhase("results");
  }

  // ── Walk-in flow ─────────────────────────────────────────────────────────

  async function startWalkIn(account: { accountId: number; accountName: string }) {
    setWalkInAccount(account);
    setPhase("resolving");
    setErrorMessage("");
    try {
      const result = await customFetch<{ accountId: number; participants: WalkInParticipant[] }>(
        `/api/admin/attendance/walk-in/participants?accountId=${account.accountId}`,
      );
      setWalkInParticipants(result.participants);
      setPhase("walkInParticipants");
    } catch (err: unknown) {
      setErrorMessage(mapResolveError(err));
      setPhase("error");
    }
  }

  async function pickWalkInParticipant(participant: WalkInParticipant) {
    if (!walkInAccount) return;
    setWalkInParticipant(participant);
    setPhase("resolving");
    setErrorMessage("");
    try {
      const result = await customFetch<{ options: WalkInOption[] }>("/api/admin/attendance/walk-in/options", {
        method: "POST",
        body: JSON.stringify({ accountId: walkInAccount.accountId, participantChildId: participant.childId }),
      });
      setWalkInOptions(result.options);
      setPhase("walkInOptions");
    } catch (err: unknown) {
      setErrorMessage(mapResolveError(err));
      setPhase("error");
    }
  }

  function pickWalkInOption(option: WalkInOption) {
    setWalkInSelectedOption(option);
    setWalkInPaymentDecision(null);
    setWalkInPackageOrderId(null);
    setPhase("walkInPayment");
  }

  function cancelWalkInCheckIn() {
    // Not Paid: a pure client-side reset — the confirm endpoint is never
    // called, so zero mutation of any kind (no Attendance, no Booking, no
    // Payment, no Credit) is even possible.
    backToResults();
  }

  async function confirmWalkIn() {
    if (!walkInAccount || !walkInParticipant || !walkInSelectedOption || !walkInPaymentDecision) return;
    if (walkInPaymentDecision === "package_credit" && walkInPackageOrderId == null) return;

    setPhase("submitting");
    setErrorMessage("");
    try {
      const body = {
        candidateKey: walkInSelectedOption.candidateKey,
        accountId: walkInAccount.accountId,
        participantChildId: walkInParticipant.childId,
        classId: walkInSelectedOption.classId,
        scheduleId: walkInSelectedOption.scheduleId,
        occurrenceDate: walkInSelectedOption.occurrenceDate,
        payment: walkInPaymentDecision === "package_credit"
          ? { type: "package_credit", packageOrderId: walkInPackageOrderId }
          : { type: "paid_at_studio" },
      };
      await customFetch("/api/admin/attendance/walk-in/confirm", { method: "POST", body: JSON.stringify(body) });

      queryClient.invalidateQueries({ queryKey: getListAttendanceQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListPackageOrdersQueryKey() });

      setSuccessMessage(`${walkInParticipant.name} checked in for ${walkInSelectedOption.className} (walk-in).`);
      setPhase("done");
    } catch (err: unknown) {
      setErrorMessage(mapConfirmError(err));
      setPhase("error");
    }
  }

  async function confirmAttendance() {
    if (!selected) return;
    const { account, candidate } = selected;
    if (candidate.eligibility !== "eligible") return;
    if (candidate.program === "studio" && paymentMode === "package_credit" && !canPackageDeduct) {
      setErrorMessage("You do not have permission to deduct package credits.");
      return;
    }

    setPhase("submitting");
    setErrorMessage("");
    try {
      const body: Record<string, unknown> = {
        candidateKey: candidate.candidateKey,
        program: candidate.program,
        accountId: account.accountId,
        source: resolverResult?.source ?? "qr",
      };
      if (candidate.program === "studio") {
        body.bookingId = candidate.bookingId;
        body.paymentMode = paymentMode;
        if (paymentMode === "package_credit") body.packageOrderId = selectedPackageId;
      } else {
        body.balletLevelAssignmentId = candidate.balletLevelAssignmentId;
        body.balletScheduleId = candidate.scheduleId;
      }

      await customFetch("/api/admin/attendance/confirm", { method: "POST", body: JSON.stringify(body) });

      queryClient.invalidateQueries({ queryKey: getListAttendanceQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListPackageOrdersQueryKey() });

      setSuccessMessage(`${candidate.participantName} checked in for ${candidate.className ?? "class"}.`);
      setPhase("done");
    } catch (err: unknown) {
      setErrorMessage(mapConfirmError(err));
      setPhase("error");
    }
  }

  function recordAnother() {
    resetAll();
  }

  const accountPackages: LegacyPackageOrder[] = selected
    ? (allPackageOrders as LegacyPackageOrder[]).filter(
        (order) => order.studentEmail === selected.account.accountEmail && order.status === "active" && order.remainingCredits > 0,
      )
    : [];

  // Walk-in credit eligibility needs the account's email, which the resolver
  // only ever attaches per-AccountGroup — walkInAccount is intentionally a
  // minimal {accountId, accountName} pair (no email), so package lookup here
  // goes through the resolver's already-fetched accounts instead of a second
  // fetch. Falls back to an empty list (Paid at Studio only) if the account
  // is not present in the last resolve response for any reason.
  const walkInAccountEmail = resolverResult?.accounts.find((a) => a.accountId === walkInAccount?.accountId)?.accountEmail ?? null;
  const walkInPackages: LegacyPackageOrder[] = walkInAccountEmail
    ? (allPackageOrders as LegacyPackageOrder[]).filter(
        (order) => order.studentEmail === walkInAccountEmail && order.status === "active" && order.remainingCredits > 0,
      )
    : [];

  if (!canCheckIn) return null;

  const showBackButton = phase === "results" || phase === "confirming" || phase === "walkInParticipants" || phase === "walkInOptions" || phase === "walkInPayment" || phase === "walkInConfirming";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl h-[85vh] p-0 gap-0 flex flex-col overflow-hidden">
        <DialogHeader className="p-5 pb-4 border-b shrink-0" style={{ borderColor: BORDER }}>
          <DialogTitle>Check In Student</DialogTitle>
          <DialogDescription>Scan a QR, search by phone, or search by child name.</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-5">
          {phase === "search" && (
            <div className="space-y-4">
              <div className="flex gap-2 rounded-lg p-1" style={{ background: "hsl(var(--muted))" }}>
                {canScan && (
                  <ModeTab active={mode === "scan"} onClick={() => setMode("scan")} icon={<QrCode className="h-4 w-4" />} label="Scan QR" />
                )}
                <ModeTab active={mode === "phone"} onClick={() => setMode("phone")} icon={<Phone className="h-4 w-4" />} label="Parent Phone" />
                <ModeTab active={mode === "childName"} onClick={() => setMode("childName")} icon={<User2 className="h-4 w-4" />} label="Child Name" />
              </div>

              {mode === "scan" && canScan && (
                <div className="space-y-3">
                  <div id={SCAN_REGION_ID} className="w-full aspect-square max-h-[360px] rounded-xl overflow-hidden" style={{ background: "#000" }} />
                  {cameraStatus === "requesting" && (
                    <p className="flex items-center gap-2 text-sm" style={{ color: MUTED }}>
                      <Loader2 className="h-4 w-4 animate-spin" /> Requesting camera access…
                    </p>
                  )}
                  {(cameraStatus === "denied" || cameraStatus === "unsupported" || cameraStatus === "error") && (
                    <div className="flex items-start gap-2 rounded-lg p-3 text-sm" style={{ background: "hsl(var(--destructive) / 0.1)", color: RED }}>
                      <VideoOff className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      <span>{cameraError}</span>
                    </div>
                  )}
                </div>
              )}

              {mode === "phone" && (
                <form onSubmit={(e) => { e.preventDefault(); submitPhone(); }} className="space-y-3">
                  <input
                    autoFocus
                    type="tel"
                    value={phoneQuery}
                    onChange={(e) => setPhoneQuery(e.target.value)}
                    placeholder="Registered phone number"
                    className="w-full rounded-lg px-3 py-2 text-sm"
                    style={{ border: `1px solid ${BORDER}`, background: CARD }}
                  />
                  <button type="submit" disabled={!phoneQuery.trim()} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50" style={{ background: CYAN, color: "hsl(var(--primary-foreground))" }}>
                    <Search className="h-4 w-4" /> Search
                  </button>
                </form>
              )}

              {mode === "childName" && (
                <form onSubmit={(e) => { e.preventDefault(); submitName(); }} className="space-y-3">
                  <input
                    autoFocus
                    type="text"
                    value={nameQuery}
                    onChange={(e) => setNameQuery(e.target.value)}
                    placeholder="Child's full or partial name (min. 2 characters)"
                    className="w-full rounded-lg px-3 py-2 text-sm"
                    style={{ border: `1px solid ${BORDER}`, background: CARD }}
                  />
                  <button type="submit" disabled={nameQuery.trim().length < 2} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50" style={{ background: CYAN, color: "hsl(var(--primary-foreground))" }}>
                    <Search className="h-4 w-4" /> Search
                  </button>
                </form>
              )}
            </div>
          )}

          {phase === "resolving" && (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <Loader2 className="h-8 w-8 animate-spin" style={{ color: CYAN }} />
              <p className="text-sm" style={{ color: MUTED }}>Looking up eligible classes…</p>
            </div>
          )}

          {phase === "results" && resolverResult && (
            <div className="space-y-5">
              {resolverResult.accounts.length === 0 ? (
                <p className="text-sm text-center py-8" style={{ color: MUTED }}>No matching account found.</p>
              ) : (
                resolverResult.accounts.map((account) => {
                  const hasEligible = account.candidates.some((c) => c.eligibility === "eligible");
                  // Walk-in is a SECONDARY action, always available per account —
                  // never hidden just because this account (or even this exact
                  // participant) already has an eligible Booking for a
                  // DIFFERENT class/occurrence. A participant can be booked into
                  // Class A and still walk into Class B; a sibling can walk in
                  // while another sibling has a Booking. The occurrence-level
                  // exclusion (never double-offering the SAME occurrence a
                  // Booking already covers) is enforced server-side, per
                  // participant + Schedule + occurrence — see
                  // studioWalkIn.ts's participantHasEligibleBookingForOccurrence.
                  return (
                    <div key={account.accountId} className="space-y-2.5">
                      <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
                        {account.accountName} {account.maskedPhone ? `· ${account.maskedPhone}` : ""}
                      </p>
                      {account.candidates.length === 0 ? (
                        <p className="text-sm rounded-lg p-3" style={{ border: `1px solid ${BORDER}`, color: MUTED }}>No eligible class right now for this account.</p>
                      ) : (
                        account.candidates.map((candidate) => (
                          <CandidateCard
                            key={candidate.candidateKey}
                            candidate={candidate}
                            onSelect={() => pickCandidate(account, candidate)}
                          />
                        ))
                      )}
                      <div className="rounded-xl p-3 flex items-center justify-between gap-3" style={{ border: `1px dashed ${BORDER}`, background: "hsl(var(--muted) / 0.4)" }}>
                        <div>
                          <p className="text-sm font-semibold">{hasEligible ? "Checking in for a different class?" : "No eligible booking found"}</p>
                          <p className="text-xs" style={{ color: MUTED }}>Record a Studio walk-in instead.</p>
                        </div>
                        <button
                          onClick={() => void startWalkIn(account)}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold flex-shrink-0"
                          style={{ background: CYAN, color: "hsl(var(--primary-foreground))" }}
                        >
                          <DoorOpen className="h-3.5 w-3.5" /> Record Walk-in
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {phase === "confirming" && selected && (
            <div className="space-y-4">
              <div className="rounded-xl p-4 space-y-2" style={{ border: `1px solid ${BORDER}`, background: CARD }}>
                <div className="flex items-center gap-2">
                  <p className="text-lg font-bold">{selected.candidate.participantName}</p>
                  <ProgramBadge program={selected.candidate.program} />
                </div>
                <p className="text-sm font-medium">{selected.candidate.className ?? "Class"}</p>
                <p className="text-sm" style={{ color: MUTED }}>
                  {selected.candidate.occurrenceDate} · {formatTime(selected.candidate.startTime)}{selected.candidate.endTime ? ` – ${formatTime(selected.candidate.endTime)}` : ""}
                </p>
                {selected.candidate.level && (
                  <div className="flex gap-1.5">
                    <Chip label={selected.candidate.level.name} />
                    {selected.candidate.group && <Chip label={selected.candidate.group.name} />}
                  </div>
                )}
              </div>

              {selected.candidate.program === "studio" && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">Payment</p>
                  <div className="flex gap-2">
                    <button onClick={() => setPaymentMode("pay_at_studio")} className="flex-1 px-3 py-2 rounded-lg text-sm font-semibold" style={{ background: paymentMode === "pay_at_studio" ? CYAN : "hsl(var(--muted))", color: paymentMode === "pay_at_studio" ? "hsl(var(--primary-foreground))" : undefined }}>
                      Pay at Studio
                    </button>
                    {canPackageDeduct && (
                      <button onClick={() => setPaymentMode("package_credit")} className="flex-1 px-3 py-2 rounded-lg text-sm font-semibold" style={{ background: paymentMode === "package_credit" ? CYAN : "hsl(var(--muted))", color: paymentMode === "package_credit" ? "hsl(var(--primary-foreground))" : undefined }}>
                      Package Credit
                      </button>
                    )}
                  </div>
                  {paymentMode === "package_credit" && (
                    <select value={selectedPackageId ?? ""} onChange={(e) => setSelectedPackageId(e.target.value ? Number(e.target.value) : null)} className="w-full rounded-lg px-3 py-2 text-sm" style={{ border: `1px solid ${BORDER}`, background: CARD }}>
                      <option value="">Select a package…</option>
                      {accountPackages.map((pkg) => (
                        <option key={pkg.id} value={pkg.id}>{pkg.packageName} ({pkg.remainingCredits} left)</option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </div>
          )}

          {phase === "walkInParticipants" && walkInAccount && (
            <div className="space-y-3">
              <p className="text-sm" style={{ color: MUTED }}>Who is checking in for <strong>{walkInAccount.accountName}</strong>?</p>
              {walkInParticipants.length === 0 ? (
                <p className="text-sm text-center py-6" style={{ color: MUTED }}>No participants found for this account.</p>
              ) : (
                <div className="space-y-2">
                  {walkInParticipants.map((p) => (
                    <button
                      key={`${p.type}-${p.childId ?? "self"}`}
                      onClick={() => void pickWalkInParticipant(p)}
                      className="w-full text-left rounded-xl p-3 flex items-center gap-3"
                      style={{ border: `1px solid ${BORDER}`, background: CARD }}
                    >
                      <div className="h-9 w-9 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: `${CYAN}22`, color: CYAN }}>
                        {p.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-semibold">{p.name}</p>
                        <p className="text-xs" style={{ color: MUTED }}>{p.type === "self" ? "Account Owner" : "Child"}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {phase === "walkInOptions" && (
            <div className="space-y-3">
              <p className="text-sm" style={{ color: MUTED }}>
                Select the Class {walkInParticipant?.name} is attending right now.
              </p>
              {walkInOptions.length === 0 ? (
                <p className="text-sm text-center py-6" style={{ color: MUTED }}>No Studio class is currently open for check-in.</p>
              ) : (
                walkInOptions.map((opt) => (
                  <button
                    key={opt.candidateKey}
                    onClick={() => pickWalkInOption(opt)}
                    className="w-full text-left rounded-xl p-3 flex items-center gap-3"
                    style={{ border: `1px solid ${BORDER}`, background: CARD }}
                  >
                    <div className="h-9 w-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: `${CYAN}22`, color: CYAN }}>
                      <Clock className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold">{opt.className}</p>
                      <p className="text-xs" style={{ color: MUTED }}>{opt.occurrenceDate} · {formatTime(opt.startTime)} – {formatTime(opt.endTime)}</p>
                      {opt.instructorName && <p className="text-xs" style={{ color: MUTED }}>Instructor: {opt.instructorName}</p>}
                    </div>
                    <span className="text-sm font-semibold flex-shrink-0" style={{ color: CYAN }}>{opt.priceEgp} EGP</span>
                  </button>
                ))
              )}
            </div>
          )}

          {phase === "walkInPayment" && walkInSelectedOption && (
            <div className="space-y-4">
              <div className="rounded-xl p-4 space-y-1" style={{ border: `1px solid ${BORDER}`, background: CARD }}>
                <p className="text-sm font-semibold">{walkInParticipant?.name}</p>
                <p className="text-sm">{walkInSelectedOption.className}</p>
                <p className="text-xs" style={{ color: MUTED }}>{walkInSelectedOption.occurrenceDate} · {formatTime(walkInSelectedOption.startTime)} – {formatTime(walkInSelectedOption.endTime)}</p>
              </div>

              {canPackageDeduct && walkInSelectedOption.packageEligible && walkInPackages.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">Studio Credit available</p>
                  {walkInPackages.map((pkg) => (
                    <button
                      key={pkg.id}
                      onClick={() => { setWalkInPaymentDecision("package_credit"); setWalkInPackageOrderId(pkg.id); }}
                      className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm text-left"
                      style={{
                        background: walkInPaymentDecision === "package_credit" && walkInPackageOrderId === pkg.id ? `${CYAN}15` : CARD,
                        border: `1px solid ${walkInPaymentDecision === "package_credit" && walkInPackageOrderId === pkg.id ? CYAN : BORDER}`,
                      }}
                    >
                      <span className="font-medium">{pkg.packageName}</span>
                      <span className="text-xs font-semibold" style={{ color: CYAN }}>{pkg.remainingCredits} credit{pkg.remainingCredits !== 1 ? "s" : ""} left</span>
                    </button>
                  ))}
                  <p className="text-xs" style={{ color: MUTED }}>Selecting a package deducts 1 credit automatically.</p>
                </div>
              )}

              <div className="space-y-2">
                <p className="text-sm font-semibold">
                  {walkInPaymentDecision === "package_credit" ? "Or pay without using a credit" : `No Studio Credit? Price: ${walkInSelectedOption.priceEgp} EGP`}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setWalkInPaymentDecision("paid_at_studio"); setWalkInPackageOrderId(null); }}
                    className="flex-1 px-3 py-2.5 rounded-lg text-sm font-semibold"
                    style={{ background: walkInPaymentDecision === "paid_at_studio" ? GREEN : "hsl(var(--muted))", color: walkInPaymentDecision === "paid_at_studio" ? "white" : undefined }}
                  >
                    Paid
                  </button>
                  <button
                    onClick={cancelWalkInCheckIn}
                    className="flex-1 px-3 py-2.5 rounded-lg text-sm font-semibold"
                    style={{ background: "hsl(var(--muted))" }}
                  >
                    Not Paid — Cancel Check-In
                  </button>
                </div>
                <p className="text-xs" style={{ color: MUTED }}>Not Paid cancels this check-in — nothing is recorded.</p>
              </div>

              {walkInPaymentDecision && (
                <button
                  onClick={() => setPhase("walkInConfirming")}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-bold"
                  style={{ background: GREEN, color: "white" }}
                >
                  <CheckCircle2 className="h-4 w-4" /> Continue to Review
                </button>
              )}
            </div>
          )}

          {phase === "walkInConfirming" && walkInSelectedOption && walkInParticipant && (
            <div className="space-y-4">
              <div className="rounded-xl p-4 space-y-1.5" style={{ border: `1px solid ${BORDER}`, background: CARD }}>
                <div className="flex items-center gap-2">
                  <p className="text-lg font-bold">{walkInParticipant.name}</p>
                  <ProgramBadge program="studio" />
                  <Chip label="Walk-in" />
                </div>
                <p className="text-sm font-medium">{walkInSelectedOption.className}</p>
                <p className="text-sm" style={{ color: MUTED }}>
                  {walkInSelectedOption.occurrenceDate} · {formatTime(walkInSelectedOption.startTime)} – {formatTime(walkInSelectedOption.endTime)}
                </p>
                <p className="text-sm font-semibold" style={{ color: walkInPaymentDecision === "package_credit" ? CYAN : GREEN }}>
                  {walkInPaymentDecision === "package_credit" ? "1 Package Credit will be deducted" : `Paid at Studio — ${walkInSelectedOption.priceEgp} EGP`}
                </p>
              </div>
            </div>
          )}

          {phase === "submitting" && (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <Loader2 className="h-8 w-8 animate-spin" style={{ color: CYAN }} />
              <p className="text-sm" style={{ color: MUTED }}>Recording attendance…</p>
            </div>
          )}

          {phase === "done" && (
            <div className="flex flex-col items-center justify-center py-8 gap-4 text-center">
              <CheckCircle2 className="h-12 w-12" style={{ color: GREEN }} />
              <p className="text-base font-semibold">{successMessage}</p>
            </div>
          )}

          {phase === "error" && (
            <div className="flex flex-col items-center justify-center py-8 gap-4 text-center">
              <AlertTriangle className="h-12 w-12" style={{ color: RED }} />
              <p className="text-sm" style={{ color: MUTED }}>{errorMessage}</p>
            </div>
          )}
        </div>

        <DialogFooter className="p-4 border-t shrink-0 sm:justify-between" style={{ borderColor: BORDER }}>
          {phase === "done" ? (
            <div className="flex gap-2 w-full">
              <button onClick={recordAnother} className="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold" style={{ background: CYAN, color: "hsl(var(--primary-foreground))" }}>
                Record Another
              </button>
              <button onClick={() => onOpenChange(false)} className="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold" style={{ background: "hsl(var(--muted))" }}>
                Done
              </button>
            </div>
          ) : phase === "error" ? (
            <div className="flex gap-2 w-full">
              <button onClick={resetAll} className="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold" style={{ background: CYAN, color: "hsl(var(--primary-foreground))" }}>
                Try Again
              </button>
              <button onClick={() => onOpenChange(false)} className="px-5 py-2.5 rounded-lg text-sm font-semibold" style={{ background: "hsl(var(--muted))" }}>
                Close
              </button>
            </div>
          ) : (
            <div className="flex gap-2 w-full items-center">
              {showBackButton && (
                <button
                  onClick={() => {
                    if (phase === "results") { resetAll(); return; }
                    if (phase === "confirming") { backToResults(); return; }
                    if (phase === "walkInParticipants") { backToResults(); return; }
                    if (phase === "walkInOptions") { setPhase("walkInParticipants"); return; }
                    if (phase === "walkInPayment") { setPhase("walkInOptions"); return; }
                    if (phase === "walkInConfirming") { setPhase("walkInPayment"); return; }
                  }}
                  className="flex items-center gap-1 px-3 py-2.5 rounded-lg text-sm font-semibold"
                  style={{ color: MUTED }}
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Back
                </button>
              )}
              <div className="flex-1" />
              {phase === "confirming" && selected && (
                <button
                  onClick={confirmAttendance}
                  disabled={selected.candidate.program === "studio" && paymentMode === "package_credit" && selectedPackageId == null}
                  className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold disabled:opacity-50"
                  style={{ background: GREEN, color: "white" }}
                >
                  <CheckCircle2 className="h-4 w-4" /> Confirm Attendance
                </button>
              )}
              {phase === "walkInConfirming" && (
                <button
                  onClick={() => void confirmWalkIn()}
                  className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold"
                  style={{ background: GREEN, color: "white" }}
                >
                  <CheckCircle2 className="h-4 w-4" /> Confirm Check-In
                </button>
              )}
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProgramBadge({ program }: { program: "studio" | "ballet" }) {
  return (
    <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ background: program === "ballet" ? `${PURPLE}22` : `${CYAN}22`, color: program === "ballet" ? PURPLE : CYAN }}>
      {program}
    </span>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: "hsl(var(--muted))", color: MUTED }}>
      {label}
    </span>
  );
}

function CandidateCard({ candidate, onSelect }: { candidate: Candidate; onSelect: () => void }) {
  const elig = eligibilityLabel(candidate);
  const clickable = candidate.eligibility === "eligible";
  return (
    <button
      disabled={!clickable}
      onClick={onSelect}
      className="w-full text-left rounded-xl p-3.5 flex flex-col gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
      style={{ border: `1px solid ${BORDER}`, background: CARD }}
    >
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0" style={{ background: candidate.program === "ballet" ? `${PURPLE}22` : `${CYAN}22`, color: candidate.program === "ballet" ? PURPLE : CYAN }}>
          {candidate.participantInitials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{candidate.participantName}</span>
            <ProgramBadge program={candidate.program} />
            <Chip label={candidate.participantType === "child" ? "Child" : "Account Owner"} />
          </div>
        </div>
        <span className="text-xs font-semibold flex-shrink-0" style={{ color: elig.color }}>{elig.label}</span>
      </div>
      <div className="pl-[52px] space-y-1">
        <p className="text-sm font-medium">{candidate.className ?? "Class"}</p>
        <p className="text-xs" style={{ color: MUTED }}>
          {formatTime(candidate.startTime)}{candidate.endTime ? ` – ${formatTime(candidate.endTime)}` : ""}
        </p>
        {(candidate.level || candidate.group) && (
          <div className="flex gap-1.5">
            {candidate.level && <Chip label={candidate.level.name} />}
            {candidate.group && <Chip label={candidate.group.name} />}
          </div>
        )}
      </div>
    </button>
  );
}

function ModeTab({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-md text-xs font-semibold transition-colors"
      style={active ? { background: CARD, color: CYAN } : { color: MUTED }}
    >
      {icon}
      {label}
    </button>
  );
}
