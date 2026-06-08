import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListPackageOrders,
  useCheckIn,
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
import { Camera, CheckCircle2, CreditCard, RefreshCw, AlertTriangle } from "lucide-react";

const STUDIO_CYAN = "#00B6D7";
const AMBER = "#F59E0B";
const GREEN = "#22C55E";

const SCAN_REGION_ID = "qr-scan-region";

type PackageOrder = {
  id: number;
  studentName: string;
  studentEmail: string;
  packageName: string;
  totalCredits: number;
  remainingCredits: number;
  status: string;
};

type Phase = "scanning" | "selecting" | "done";

function extractIdentity(decoded: string): { email: string; name: string } | null {
  const trimmed = decoded.trim();
  try {
    const parsed = JSON.parse(trimmed) as { email?: string; name?: string };
    if (parsed && typeof parsed.email === "string" && parsed.email.includes("@")) {
      return { email: parsed.email.toLowerCase(), name: parsed.name ?? parsed.email };
    }
  } catch {
    // not JSON — fall through
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { email: trimmed.toLowerCase(), name: trimmed };
  }
  return null;
}

export function ScanCheckInDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [phase, setPhase] = useState<Phase>("scanning");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [manualEmail, setManualEmail] = useState("");
  const [cameraError, setCameraError] = useState("");
  const [selectedPackageId, setSelectedPackageId] = useState<number | null>(null);
  const [classTitle, setClassTitle] = useState("");
  const [deductCredit, setDeductCredit] = useState(true);
  const [successMsg, setSuccessMsg] = useState("");

  const { data: packageOrders = [] } = useListPackageOrders();

  const studentOrders = (packageOrders as PackageOrder[]).filter(
    (o) => o.studentEmail === email && o.status === "active" && o.remainingCredits > 0
  );

  const { mutate: checkIn, isPending: isCheckingIn } = useCheckIn({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getListAttendanceQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListPackageOrdersQueryKey() });
        setSuccessMsg(
          `${data.studentName} checked in${deductCredit && selectedPackageId ? " — 1 credit deducted" : ""}`
        );
        setPhase("done");
      },
    },
  });

  function resetToScan() {
    setEmail("");
    setName("");
    setManualEmail("");
    setSelectedPackageId(null);
    setClassTitle("");
    setDeductCredit(true);
    setSuccessMsg("");
    setCameraError("");
    setPhase("scanning");
  }

  function acceptIdentity(found: { email: string; name: string }) {
    setEmail(found.email);
    setName(found.name);
    setSelectedPackageId(null);
    setClassTitle("");
    setDeductCredit(true);
    setPhase("selecting");
  }

  function handleManualLookup() {
    const found = extractIdentity(manualEmail);
    if (found) acceptIdentity(found);
  }

  function handleCheckIn() {
    if (!email) return;
    const order = studentOrders.find((o) => o.id === selectedPackageId);
    checkIn({
      data: {
        studentEmail: email,
        studentName: order?.studentName ?? name ?? email,
        packageOrderId: selectedPackageId,
        classTitle: classTitle || null,
        creditDeducted: deductCredit && !!selectedPackageId,
        notes: null,
      },
    });
  }

  // Reset state whenever the dialog is (re)opened.
  useEffect(() => {
    if (open) resetToScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Manage the camera lifecycle for the scanning phase.
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
            const found = extractIdentity(decodedText);
            if (found && !cancelled) acceptIdentity(found);
          },
          () => {
            /* per-frame decode errors are expected; ignore */
          }
        );
      } catch {
        if (!cancelled) {
          setCameraError(
            "Could not access the camera. Grant camera permission (open the admin in its own browser tab), or enter the student's email below."
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
          .catch(() => {
            /* already stopped */
          });
      }
    };
  }, [open, phase]);

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
              <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: "#8A9AB0" }}>
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
                  style={{ background: "hsl(203 30% 14%)", border: "1px solid hsl(203 30% 20%)", outline: "none" }}
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

        {phase === "selecting" && (
          <div className="space-y-3">
            <div className="rounded-xl px-3 py-2.5 text-sm" style={{ background: `${STUDIO_CYAN}12`, border: `1px solid ${STUDIO_CYAN}30` }}>
              <span style={{ color: "#8A9AB0" }}>Checking in </span>
              <span className="font-semibold text-white">{name}</span>
              <div className="text-xs" style={{ color: "#4E6070" }}>{email}</div>
            </div>

            {studentOrders.length === 0 ? (
              <div className="text-sm px-3 py-2.5 rounded-xl" style={{ background: `${AMBER}10`, color: AMBER, border: `1px solid ${AMBER}25` }}>
                No active packages found. You can still check in without deducting a credit.
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
                <input type="checkbox" checked={deductCredit} onChange={(e) => setDeductCredit(e.target.checked)} className="rounded" />
                <span className="text-sm" style={{ color: "#9CA3AF" }}>Deduct 1 credit from selected package</span>
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
                onClick={handleCheckIn}
                disabled={isCheckingIn}
                className="flex-1 py-3 rounded-xl text-sm font-bold transition-colors disabled:opacity-60"
                style={{ background: STUDIO_CYAN, color: "#000" }}
              >
                {isCheckingIn ? "Checking in…" : "Check In"}
              </button>
            </div>
          </div>
        )}

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
      </DialogContent>
    </Dialog>
  );
}
