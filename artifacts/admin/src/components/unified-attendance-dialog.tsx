/**
 * UnifiedAttendanceDialog — the single Admin Attendance gateway for Scan QR,
 * Search Parent Phone, and Search Child Name, spanning both Studio and
 * Ballet. Calls the unified resolver/confirm backend
 * (routes/adminAttendanceGateway.ts) — never writes attendance from the
 * resolve step, and never auto-selects a candidate: the admin always sees an
 * explicit confirmation step, even when exactly one candidate is eligible.
 *
 * Camera lifecycle mirrors scan-check-in-dialog.tsx's proven
 * idle/requesting/active/denied/unsupported/error state machine — kept
 * separate rather than shared so the existing, already-tested Studio-only
 * QR dialog is never touched by this addition.
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
type Phase = "search" | "resolving" | "results" | "confirming" | "submitting" | "done" | "error";

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
  // Finance Phase 2B-4: set only on a Studio WALK-IN candidate (bookingId
  // is null) — the server-resolved, display-only price and whether a
  // Package Credit is available for this account. Never editable.
  walkinPriceEgp: number | null;
  walkinChildId: number | null;
  hasPackageCredit: boolean;
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

function formatTime(t: string | null): string {
  if (!t) return "";
  const match = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!match) return t;
  const h = Number(match[1]);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${match[2]} ${period}`;
}

/**
 * Finance Batch 1 (Part C): a candidate with a real booking (bookingId !=
 * null) and a Studio walk-in OFFER (bookingId == null — this account/child
 * simply has an open, unbooked check-in window right now) both used to
 * render as the identical green "Eligible now" label — this is exactly what
 * caused UAT confusion: every family member looked "booked" for the class in
 * front of the admin, when only the actual booked participant truly was.
 * Booked and walk-in candidates now get distinct labels so the two can never
 * be visually confused, without changing any backend eligibility logic.
 */
function isBookedCandidate(candidate: Candidate): boolean {
  return candidate.bookingId != null || candidate.program === "ballet";
}

function eligibilityLabel(candidate: Candidate): { label: string; color: string } {
  switch (candidate.eligibility) {
    case "eligible":
      return isBookedCandidate(candidate)
        ? { label: "Booked for this class", color: GREEN }
        : { label: "Available as Walk-in", color: CYAN };
    case "too_early": return { label: candidate.reason ?? "Too early", color: AMBER };
    case "ended": return { label: candidate.reason ?? "Closed", color: MUTED };
    case "already_recorded": return { label: candidate.reason ?? "Already recorded", color: MUTED };
    case "no_active_subscription": return { label: candidate.reason ?? "No active subscription", color: RED };
    case "cancelled": return { label: candidate.reason ?? "Cancelled", color: RED };
    default: return { label: candidate.reason ?? "Not eligible", color: RED };
  }
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
  // For a Walk-in, this starts as null — no default, no automatic preference
  // for Package Credit even when one is available. Existing-booking
  // check-ins keep their prior default ("pay_at_studio") since that flow is
  // unchanged by the explicit Walk-in settlement policy.
  const [paymentMode, setPaymentMode] = useState<"package_credit" | "pay_at_studio" | null>("pay_at_studio");
  const [selectedPackageId, setSelectedPackageId] = useState<number | null>(null);
  // Prevents a double-click/double-submit from firing the confirm request twice.
  const [submitLock, setSubmitLock] = useState(false);

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
    setSubmitLock(false);
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
      const data = err !== null && typeof err === "object" && "data" in err ? (err as { data?: { message?: string; error?: string } }).data : null;
      setErrorMessage(data?.message ?? data?.error ?? "Could not resolve this search — please try again.");
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
    // Mandatory explicit choice — a Walk-in never gets a pre-selected
    // settlement method, even when a valid Package Credit is available.
    // Existing-booking candidates keep the prior default unchanged.
    const isWalkIn = candidate.bookingId == null && candidate.program === "studio";
    setPaymentMode(isWalkIn ? null : "pay_at_studio");
    setSelectedPackageId(null);
    setSubmitLock(false);
    setPhase("confirming");
  }

  function backToResults() {
    setSelected(null);
    setPhase("results");
  }

  // Not Paid cancels the whole operation client-side: nothing was ever
  // written (the server never saw this request), so there is nothing to
  // roll back — just return to the results list without any success state.
  function declineWalkInPayment() {
    backToResults();
  }

  async function confirmAttendance(paidDecision?: boolean) {
    if (!selected || submitLock) return;
    const { account, candidate } = selected;
    if (candidate.eligibility !== "eligible") return;
    if (candidate.program === "studio" && paymentMode == null) return;
    if (candidate.program === "studio" && paymentMode === "package_credit" && !canPackageDeduct) {
      setErrorMessage("You do not have permission to deduct package credits.");
      return;
    }

    setSubmitLock(true);
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
        body.paymentMode = paymentMode;
        if (paymentMode === "package_credit") body.packageOrderId = selectedPackageId;
        if (candidate.bookingId != null) {
          body.bookingId = candidate.bookingId;
        } else {
          // Studio walk-in (Finance Phase 2B-4): no pre-existing booking.
          // The resolved price is echoed back exactly as displayed — never
          // editable, never re-entered — so the server can guarantee it
          // captures the same amount the Admin actually confirmed against
          // (409 walkin_price_changed if the configured price moved since
          // resolve()).
          body.scheduleId = candidate.scheduleId;
          if (candidate.walkinChildId != null) body.childId = candidate.walkinChildId;
          if (candidate.walkinPriceEgp != null) body.expectedPriceEgp = candidate.walkinPriceEgp;
          if (paymentMode === "pay_at_studio") body.paid = paidDecision ?? true;
        }
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
      const data = err !== null && typeof err === "object" && "data" in err ? (err as { data?: { message?: string; error?: string } }).data : null;
      setErrorMessage(data?.message ?? data?.error ?? "Could not record attendance — please try again.");
      setPhase("error");
    } finally {
      setSubmitLock(false);
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

  if (!canCheckIn) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Attendance</DialogTitle>
          <DialogDescription>Scan a QR, search by phone, or search by child name.</DialogDescription>
        </DialogHeader>

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
                <div id={SCAN_REGION_ID} className="w-full aspect-square rounded-xl overflow-hidden" style={{ background: "#000" }} />
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
          <div className="space-y-4">
            <button onClick={resetAll} className="flex items-center gap-1 text-sm" style={{ color: MUTED }}>
              <ArrowLeft className="h-3.5 w-3.5" /> New search
            </button>
            {resolverResult.accounts.length === 0 ? (
              <p className="text-sm text-center py-8" style={{ color: MUTED }}>No matching account found.</p>
            ) : (
              resolverResult.accounts.map((account) => {
                // Finance Batch 1 (Part C, decision tree): when this account
                // has at least one real booking-based candidate for the
                // current occurrence, show ONLY those booked candidates —
                // unrelated family members with an unbooked walk-in window
                // open right now must never render alongside them looking
                // "eligible" the same way (Case 1/2). Only when NO one has
                // an actual booking do we fall into Walk-in mode and offer
                // the account/child list explicitly labeled as such (Case 3).
                const bookedCandidates = account.candidates.filter(isBookedCandidate);
                const walkInCandidates = account.candidates.filter((c) => !isBookedCandidate(c));
                const visibleCandidates = bookedCandidates.length > 0 ? bookedCandidates : walkInCandidates;
                const sectionLabel = bookedCandidates.length > 0
                  ? (bookedCandidates.length === 1 ? "Booked participant" : "Booked participants")
                  : "Walk-in — no booking found, select a participant";

                return (
                  <div key={account.accountId} className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
                      {account.accountName} {account.maskedPhone ? `· ${account.maskedPhone}` : ""}
                    </p>
                    {account.candidates.length === 0 ? (
                      <p className="text-sm rounded-lg p-3" style={{ border: `1px solid ${BORDER}`, color: MUTED }}>No eligible class right now for this account.</p>
                    ) : (
                      <>
                        <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: bookedCandidates.length > 0 ? GREEN : CYAN }}>
                          {sectionLabel}
                        </p>
                        {visibleCandidates.map((candidate) => {
                          const elig = eligibilityLabel(candidate);
                          const clickable = candidate.eligibility === "eligible";
                          return (
                            <button
                              key={candidate.candidateKey}
                              disabled={!clickable}
                              onClick={() => pickCandidate(account, candidate)}
                              className="w-full text-left rounded-xl p-3 flex items-center gap-3 disabled:opacity-60"
                              style={{ border: `1px solid ${BORDER}`, background: CARD }}
                            >
                              <div className="h-10 w-10 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0" style={{ background: candidate.program === "ballet" ? `${PURPLE}22` : `${CYAN}22`, color: candidate.program === "ballet" ? PURPLE : CYAN }}>
                                {candidate.participantInitials}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-semibold truncate">{candidate.participantName}</span>
                                  <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ background: candidate.program === "ballet" ? `${PURPLE}22` : `${CYAN}22`, color: candidate.program === "ballet" ? PURPLE : CYAN }}>
                                    {candidate.program}
                                  </span>
                                  <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "hsl(var(--muted))", color: MUTED }}>
                                    {candidate.participantType === "child" ? "Child" : "Self"}
                                  </span>
                                </div>
                                <p className="text-xs truncate" style={{ color: MUTED }}>
                                  {candidate.className ?? "Class"} · {formatTime(candidate.startTime)}{candidate.endTime ? ` – ${formatTime(candidate.endTime)}` : ""}
                                  {candidate.level ? ` · ${candidate.level.name}` : ""}{candidate.group ? ` / ${candidate.group.name}` : ""}
                                </p>
                              </div>
                              <span className="text-xs font-semibold flex-shrink-0" style={{ color: elig.color }}>{elig.label}</span>
                            </button>
                          );
                        })}
                      </>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {phase === "confirming" && selected && (
          <div className="space-y-4">
            <button onClick={backToResults} className="flex items-center gap-1 text-sm" style={{ color: MUTED }}>
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </button>
            <div className="rounded-xl p-4 space-y-1" style={{ border: `1px solid ${BORDER}`, background: CARD }}>
              <p className="text-lg font-bold">{selected.candidate.participantName}</p>
              <p className="text-sm" style={{ color: MUTED }}>
                {selected.candidate.className ?? "Class"} · {formatTime(selected.candidate.startTime)}{selected.candidate.endTime ? ` – ${formatTime(selected.candidate.endTime)}` : ""}
              </p>
              {selected.candidate.level && (
                <p className="text-sm" style={{ color: MUTED }}>{selected.candidate.level.name}{selected.candidate.group ? ` / ${selected.candidate.group.name}` : ""}</p>
              )}
            </div>

            {(() => {
              const isWalkIn = selected.candidate.bookingId == null && selected.candidate.program === "studio";
              // For a walk-in, only offer Package Credit when the resolver
              // actually found one available for this account — an
              // existing-booking candidate has no such preview, so it keeps
              // the prior canPackageDeduct-only gate exactly as before.
              const showPackageCreditOption = canPackageDeduct && (!isWalkIn || selected.candidate.hasPackageCredit);
              const showPaidNotPaid = isWalkIn && paymentMode === "pay_at_studio";

              return (
                <>
                  {selected.candidate.program === "studio" && (
                    <div className="space-y-2">
                      <p className="text-sm font-semibold">Payment</p>
                      <div className="flex gap-2">
                        <button onClick={() => setPaymentMode("pay_at_studio")} className="flex-1 px-3 py-2 rounded-lg text-sm font-semibold" style={{ background: paymentMode === "pay_at_studio" ? CYAN : "hsl(var(--muted))", color: paymentMode === "pay_at_studio" ? "hsl(var(--primary-foreground))" : undefined }}>
                          Pay at Studio
                        </button>
                        {showPackageCreditOption && (
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
                      {showPaidNotPaid && selected.candidate.walkinPriceEgp != null && (
                        // Server-resolved price, display-only — never an
                        // editable input. Shown before any Paid/Not Paid
                        // decision can be made.
                        <div className="rounded-lg p-3 flex items-center justify-between" style={{ border: `1px solid ${BORDER}`, background: "hsl(var(--muted) / 0.4)" }}>
                          <span className="text-sm" style={{ color: MUTED }}>Single-Class price</span>
                          <span className="text-base font-bold">EGP {selected.candidate.walkinPriceEgp}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {errorMessage && (
                    <div className="flex items-center gap-2 rounded-lg p-3 text-sm" style={{ background: "hsl(var(--destructive) / 0.1)", color: RED }}>
                      <AlertTriangle className="h-4 w-4 flex-shrink-0" /> {errorMessage}
                    </div>
                  )}

                  {showPaidNotPaid ? (
                    <div className="flex gap-2">
                      <button
                        onClick={declineWalkInPayment}
                        disabled={submitLock}
                        className="flex-1 px-4 py-3 rounded-lg text-sm font-bold disabled:opacity-50"
                        style={{ background: "hsl(var(--muted))" }}
                      >
                        Not Paid
                      </button>
                      <button
                        onClick={() => void confirmAttendance(true)}
                        disabled={submitLock}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-bold disabled:opacity-50"
                        style={{ background: GREEN, color: "white" }}
                      >
                        <CheckCircle2 className="h-4 w-4" /> Paid
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => void confirmAttendance()}
                      disabled={
                        submitLock ||
                        (selected.candidate.program === "studio" &&
                          (paymentMode == null ||
                            (paymentMode === "package_credit" && selectedPackageId == null)))
                      }
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-bold disabled:opacity-50"
                      style={{ background: GREEN, color: "white" }}
                    >
                      <CheckCircle2 className="h-4 w-4" /> Confirm Attendance
                    </button>
                  )}
                </>
              );
            })()}
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
            <div className="flex gap-2 w-full">
              <button onClick={recordAnother} className="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold" style={{ background: CYAN, color: "hsl(var(--primary-foreground))" }}>
                Record Another
              </button>
              <button onClick={() => onOpenChange(false)} className="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold" style={{ background: "hsl(var(--muted))" }}>
                Done
              </button>
            </div>
          </div>
        )}

        {phase === "error" && (
          <div className="flex flex-col items-center justify-center py-8 gap-4 text-center">
            <AlertTriangle className="h-12 w-12" style={{ color: RED }} />
            <p className="text-sm" style={{ color: MUTED }}>{errorMessage}</p>
            <button onClick={resetAll} className="px-4 py-2.5 rounded-lg text-sm font-semibold" style={{ background: CYAN, color: "hsl(var(--primary-foreground))" }}>
              Try Again
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
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
