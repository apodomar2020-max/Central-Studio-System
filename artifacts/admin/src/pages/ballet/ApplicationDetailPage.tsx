/**
 * Ballet Application Detail — /ballet/applications/:id
 *
 * Shows:
 *  - Full application data split into readable sections
 *  - Vertical event timeline (newest first)
 *  - Status change panel (select + optional note + save)
 *  - Level assignment panel (select active level + optional note + assign)
 */

import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, ChevronLeft, Clock, User, ArrowRight, Download, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  isTransitionAllowed,
  resolveBalletDangerAction,
  BALLET_CANCELLATION_INITIATOR_LABELS,
  type BalletApplicationStatus,
  type BalletCancellationInitiatorType,
} from "@workspace/api-zod";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Application {
  id: number;
  parentName: string;
  parentPhone: string;
  parentEmail: string;
  parentStudentId: number | null;
  childId: number | null;
  childName: string;
  childBirthday: string | null;
  childAge: number | null;
  childGender: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  previousExperience: boolean;
  experienceDetails: string | null;
  medicalNotes: string | null;
  notes: string | null;
  assessmentScheduleId: number | null;
  assessmentDate: string | null;
  status: string;
  adminNotes: string | null;
  assignedLevelId: number | null;
  assignedAt: string | null;
  createdAt: string;
  preferredPaymentMethod: string | null;
  preferredPackageId: number | null;
  preferredPackageName: string | null;
  updatedAt: string;
}

interface AssessmentSchedule {
  id: number;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  status: string;
  classId: number | null;
  classTitle: string | null;
  instructorId: number | null;
  instructorName: string | null;
  levelId: number | null;
  levelName: string | null;
}

interface Level {
  id: number;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

interface Group {
  id: number;
  name: string;
  levelId: number;
  isActive: boolean;
}

interface Event {
  id: number;
  fromStatus: string | null;
  toStatus: string;
  note: string | null;
  createdAt: string;
  changedById: number | null;
  changedByUsername: string | null;
  changedByFullName: string | null;
}

interface GroupSchedule {
  id: number;
  dayOfWeek: number; // 0=Sun … 6=Sat
  startTime: string;
  endTime: string;
  status: string;
  classId?: number | null;
  classTitle?: string | null;
  instructorId?: number | null;
  instructorName?: string | null;
}

interface BalletPayment {
  id: number;
  applicationId: number;
  levelAssignmentId: number | null;
  packageId: number | null;
  packageName?: string | null;
  amountEgp: number;
  status: string;
  paymentMethod: string | null;
  billingMonth: string | null;
  subscriptionStartDate: string | null;
  subscriptionExpiresAt: string | null;
  originalExpiresAt: string | null;
  isRenewal: boolean;
  renewedFromId: number | null;
  extensionHistory: SubscriptionExtension[];
  subscriptionStatus: "pending" | "active" | "renewed" | "expired";
  subscriptionDisplayStatus: string;
  hasActiveSubscription: boolean;
  daysRemaining: number | null;
  paidAt: string | null;
  refundedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CancellationRequest {
  id: number;
  status: string;
  requestedTiming: string;
  approvedTiming: string | null;
  requestedEffectiveDate: string | null;
  approvedEffectiveDate: string | null;
  reason: string;
  requestRefund: boolean;
  initiatedByType?: string | null;
  initiatedByAdminId?: number | null;
  initiatedByAdminName?: string | null;
  adminNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface EligibleRefund {
  eligible: boolean;
  paymentId: number | null;
  paymentMethod: string | null;
  originalAmountEgp: number | null;
  alreadyRefundedEgp: number;
  remainingRefundableEgp: number;
}

interface BalletRefund {
  id: number;
  cancellationRequestId: number | null;
  paymentId: number;
  status: string;
  refundMethod: string;
  requestedReason: string;
  approvedAmountEgp: number | null;
  refundedAmountEgp: number | null;
  transactionReference: string | null;
  adminNotes: string | null;
  failedReason: string | null;
  processedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SubscriptionExtension {
  previousExpiresAt: string;
  newExpiresAt: string;
  daysAdded: number;
  adjustmentMethod?: string;
  additionalDays?: number | null;
  reasonKey?: string;
  reason: string;
  note: string | null;
  actorId: number | null;
  extendedAt: string;
}

interface AttendanceSummary {
  billingMonth: string;
  hasActiveSubscription: boolean;
  attendedHours: number;
  absentHours: number;
  consumedHours: number;
  monthlyHours: number | null;
  remainingHours: number | null;
  subscriptionId: number | null;
  subscriptionStatus: string;
  subscriptionStartDate: string | null;
  subscriptionExpiresAt: string | null;
  daysRemaining: number | null;
}

// D1: one row from GET /admin/ballet/attendance's history array.
interface AttendanceHistoryRow {
  id: number;
  classDate: string | null;
  status: string;
  durationMinutes: number | null;
  notes: string | null;
  balletScheduleId: number | null;
  createdAt: string;
}

interface AttendanceHistoryResponse {
  history: AttendanceHistoryRow[];
  summary: AttendanceSummary;
}

interface DetailResponse {
  application: Application;
  assessmentSchedule: AssessmentSchedule | null;
  level: Level | null;
  group: Group | null;
  assignmentId: number | null;
  groupSchedules: GroupSchedule[];
  events: Event[];
  payments: BalletPayment[];
  currentPayment: BalletPayment | null;
  currentSubscription: BalletPayment | null;
  attendanceSummary: AttendanceSummary | null;
  cancellationRequests?: CancellationRequest[];
  refunds?: BalletRefund[];
  eligibleRefund?: EligibleRefund;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ATTENDANCE_STATUSES = [
  { value: "checked_in", label: "Checked In" },
  { value: "late",       label: "Late" },
  { value: "absent",     label: "Absent" },
  { value: "cancelled",  label: "Cancelled" },
];

interface LevelsResponse {
  levels: Level[];
}

interface GroupsResponse {
  data: Group[];
}

// ─── Status config ────────────────────────────────────────────────────────────

const ALL_STATUSES = [
  { value: "pending",         label: "Pending" },
  { value: "accepted",        label: "Accepted" },
  { value: "needsFollowUp",   label: "Needs Follow-up" },
  { value: "assignedToLevel", label: "Assigned to Level" },
  { value: "active",          label: "Active" },
  { value: "rejected",        label: "Rejected" },
  { value: "cancelled",       label: "Cancelled" },
  { value: "withdrawn",       label: "Withdrawn" },
];

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  pending:           { label: "Pending",            className: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  accepted:          { label: "Accepted",           className: "bg-green-500/15 text-green-400 border-green-500/30" },
  rejected:          { label: "Rejected",           className: "bg-red-500/15 text-red-400 border-red-500/30" },
  needsFollowUp:     { label: "Needs Follow-up",    className: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" },
  assignedToLevel:   { label: "Assigned to Level",  className: "bg-purple-500/15 text-purple-400 border-purple-500/30" },
  active:            { label: "Active",             className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  cancelled:         { label: "Cancelled",           className: "bg-slate-500/15 text-slate-400 border-slate-500/30" },
  withdrawn:         { label: "Withdrawn",           className: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30" },
};

const PAYMENT_STATUSES = [
  { value: "pending", label: "Pending" },
  { value: "paid", label: "Paid" },
  { value: "rejected", label: "Rejected" },
  { value: "refunded", label: "Refunded" },
];

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  bankTransfer: "Legacy Bank Transfer",
  kashier: "Online Payment",
  inPerson: "Pay at Studio",
};

const PAYMENT_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  pending:  { label: "Pending",  className: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" },
  paid:     { label: "Paid",     className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  rejected: { label: "Rejected", className: "bg-red-500/15 text-red-400 border-red-500/30" },
  refunded: { label: "Refunded", className: "bg-slate-500/15 text-slate-400 border-slate-500/30" },
};

const EXPIRY_ADJUSTMENT_REASONS = [
  { value: "studioHoliday", label: "Studio holiday" },
  { value: "classSuspension", label: "Class suspension" },
  { value: "medicalAccommodation", label: "Medical accommodation" },
  { value: "administrativeCorrection", label: "Administrative correction" },
  { value: "other", label: "Other" },
] as const;

function formatPaymentMethod(method?: string | null) {
  return method ? PAYMENT_METHOD_LABELS[method] ?? method : null;
}

function PaymentStatusBadge({ status }: { status?: string | null }) {
  if (!status) return <span className="italic text-muted-foreground">—</span>;
  const cfg = PAYMENT_STATUS_CONFIG[status] ?? { label: status, className: "bg-gray-500/15 text-gray-400 border-gray-500/30" };
  return <Badge variant="outline" className={cfg.className}>{cfg.label}</Badge>;
}

function SubscriptionBadge({ payment }: { payment?: BalletPayment | null }) {
  if (!payment) return <Badge variant="outline" className="bg-yellow-500/15 text-yellow-400 border-yellow-500/30">Pending Payment</Badge>;
  const className =
    payment.subscriptionStatus === "expired" ? "bg-red-500/15 text-red-400 border-red-500/30"
    : payment.subscriptionStatus === "renewed" ? "bg-cyan-500/15 text-cyan-400 border-cyan-500/30"
    : payment.subscriptionStatus === "active" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
    : "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
  return <Badge variant="outline" className={className}>{payment.subscriptionDisplayStatus}</Badge>;
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, className: "bg-gray-500/15 text-gray-400 border-gray-500/30" };
  return <Badge variant="outline" className={cfg.className}>{cfg.label}</Badge>;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_API_URL as string | undefined ?? "";
const API_KEY  = import.meta.env.VITE_API_KEY  as string | undefined ?? "";

function makeHeaders(token: string | null): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(API_KEY ? { "x-api-key": API_KEY } : {}),
    ...(token ? { "x-admin-token": token } : {}),
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm text-foreground">{value ?? <span className="italic text-muted-foreground">—</span>}</div>
    </div>
  );
}

function SummaryCard({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1 text-lg font-semibold text-white">{value ?? "—"}</div>
        {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function formatDateTime(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}

function addOneDay(dateOnly: string) {
  const value = new Date(`${dateOnly}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ApplicationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { token, can } = useAdminAuth();
  const canReview = can("ballet.applications", "review");
  const canApprove = can("ballet.applications", "approve");
  const canReject = can("ballet.applications", "reject");
  const canCancel = can("ballet.applications", "cancel");
  const canViewPayments = can("ballet.payments", "view");
  const canEditPayments = can("ballet.payments", "edit");
  const canCheckIn = can("attendance", "checkIn");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [newStatus, setNewStatus]       = useState("");
  const [statusNote, setStatusNote]     = useState("");
  const [newLevelId, setNewLevelId]     = useState("");
  const [levelNote, setLevelNote]       = useState("");
  const [newGroupId, setNewGroupId]     = useState("");
  const [groupNote, setGroupNote]       = useState("");
  const [attScheduleId, setAttScheduleId] = useState("");
  const [attDate, setAttDate]             = useState("");
  const [attStatus, setAttStatus]         = useState("checked_in");
  const [attDuration, setAttDuration]     = useState("");
  const [attNote, setAttNote]             = useState("");
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  // Danger Zone (cancellation initiation) state.
  const [dangerDialog, setDangerDialog] = useState<"cancelApplication" | "cancelProgram" | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelAdminNotes, setCancelAdminNotes] = useState("");
  const [cancelTiming, setCancelTiming] = useState<"immediate" | "endOfPeriod">("immediate");
  const [cancelRequestRefund, setCancelRequestRefund] = useState(false);
  const [adjustExpiryOpen, setAdjustExpiryOpen] = useState(false);
  const [expiryAdjustmentMethod, setExpiryAdjustmentMethod] = useState<"addDays" | "setDate">("addDays");
  const [expiryAdditionalDays, setExpiryAdditionalDays] = useState("");
  const [expiryNewDate, setExpiryNewDate] = useState("");
  const [expiryReason, setExpiryReason] = useState<(typeof EXPIRY_ADJUSTMENT_REASONS)[number]["value"]>("studioHoliday");
  const [expiryOtherReason, setExpiryOtherReason] = useState("");
  const [expiryNote, setExpiryNote] = useState("");

  // D1: inline correction state for an existing attendance history row.
  const [editingAttendanceId, setEditingAttendanceId] = useState<number | null>(null);
  const [editStatus, setEditStatus]     = useState("checked_in");
  const [editDuration, setEditDuration] = useState("");
  const [editNote, setEditNote]         = useState("");

  const appId = parseInt(id ?? "", 10);

  // ── Fetch detail ────────────────────────────────────────────────────────────

  const { data, isLoading, isError } = useQuery<DetailResponse>({
    queryKey: ["ballet-application", appId],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/admin/ballet/applications/${appId}`, {
        headers: makeHeaders(token),
      });
      if (!res.ok) throw new Error("Failed to load application");
      return res.json();
    },
    enabled: !isNaN(appId),
  });

  // ── Fetch available levels ──────────────────────────────────────────────────

  const { data: levelsData } = useQuery<LevelsResponse>({
    queryKey: ["ballet-levels"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/admin/ballet/levels`, {
        headers: makeHeaders(token),
      });
      if (!res.ok) throw new Error("Failed to load levels");
      return res.json();
    },
  });

  // ── Fetch available groups ──────────────────────────────────────────────────

  const { data: groupsData } = useQuery<GroupsResponse>({
    queryKey: ["ballet-groups"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/admin/ballet/groups?limit=100`, {
        headers: makeHeaders(token),
      });
      if (!res.ok) throw new Error("Failed to load groups");
      return res.json();
    },
  });

  // ── Status mutation ─────────────────────────────────────────────────────────

  const statusMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/api/admin/ballet/applications/${appId}/status`, {
        method: "PATCH",
        headers: makeHeaders(token),
        body: JSON.stringify({ status: newStatus, note: statusNote || undefined }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Failed to update status");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Status updated" });
      setNewStatus("");
      setStatusNote("");
      queryClient.invalidateQueries({ queryKey: ["ballet-application", appId] });
      queryClient.invalidateQueries({ queryKey: ["ballet-applications"] });
      queryClient.invalidateQueries({ queryKey: ["ballet-students"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // ── Level assignment mutation ───────────────────────────────────────────────

  const levelMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/api/admin/ballet/applications/${appId}/assign-level`, {
        method: "POST",
        headers: makeHeaders(token),
        body: JSON.stringify({ levelId: parseInt(newLevelId, 10), note: levelNote || undefined }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Failed to assign level");
      }
      return res.json();
    },
    onSuccess: (result: { levelName: string }) => {
      toast({ title: `Assigned to ${result.levelName}` });
      setNewLevelId("");
      setLevelNote("");
      queryClient.invalidateQueries({ queryKey: ["ballet-application", appId] });
      queryClient.invalidateQueries({ queryKey: ["ballet-applications"] });
      queryClient.invalidateQueries({ queryKey: ["ballet-students"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // ── Group assignment mutation ───────────────────────────────────────────────

  const groupMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/api/admin/ballet/applications/${appId}/assign-group`, {
        method: "POST",
        headers: makeHeaders(token),
        body: JSON.stringify({ groupId: parseInt(newGroupId, 10), note: groupNote || undefined }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Failed to assign group");
      }
      return res.json();
    },
    onSuccess: (result: { groupName: string }) => {
      toast({ title: `Assigned to ${result.groupName}` });
      setNewGroupId("");
      setGroupNote("");
      queryClient.invalidateQueries({ queryKey: ["ballet-application", appId] });
      queryClient.invalidateQueries({ queryKey: ["ballet-applications"] });
      queryClient.invalidateQueries({ queryKey: ["ballet-students"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // ── Danger Zone mutations ──────────────────────────────────────────────────
  // Both reuse the existing cancellation workflow endpoints — the React page
  // never writes assignment/application rows directly.

  function closeDangerDialog() {
    setDangerDialog(null);
    setCancelReason("");
    setCancelAdminNotes("");
    setCancelTiming("immediate");
    setCancelRequestRefund(false);
  }

  const cancelApplicationMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/api/admin/ballet/applications/${appId}/cancel`, {
        method: "POST",
        headers: makeHeaders(token),
        body: JSON.stringify({ reason: cancelReason.trim(), requestRefund: cancelRequestRefund }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Failed to cancel application");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Application cancelled" });
      closeDangerDialog();
      queryClient.invalidateQueries({ queryKey: ["ballet-application", appId] });
      queryClient.invalidateQueries({ queryKey: ["ballet-applications"] });
      queryClient.invalidateQueries({ queryKey: ["ballet-students"] });
      queryClient.invalidateQueries({ queryKey: ["ballet-cancellation-requests"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const initiateCancellationMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/api/admin/ballet/applications/${appId}/request-cancellation`, {
        method: "POST",
        headers: makeHeaders(token),
        body: JSON.stringify({
          requestedTiming: cancelTiming,
          reason: cancelReason.trim(),
          adminNotes: cancelAdminNotes.trim() || undefined,
          requestRefund: cancelRequestRefund,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Failed to cancel program");
      }
      return res.json();
    },
    onSuccess: (result: { timing?: string }) => {
      toast({ title: result.timing === "immediate" ? "Enrollment cancelled" : "Cancellation scheduled" });
      closeDangerDialog();
      queryClient.invalidateQueries({ queryKey: ["ballet-application", appId] });
      queryClient.invalidateQueries({ queryKey: ["ballet-applications"] });
      queryClient.invalidateQueries({ queryKey: ["ballet-students"] });
      queryClient.invalidateQueries({ queryKey: ["ballet-cancellation-requests"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function closeAdjustExpiryDialog() {
    setAdjustExpiryOpen(false);
    setExpiryAdjustmentMethod("addDays");
    setExpiryAdditionalDays("");
    setExpiryNewDate("");
    setExpiryReason("studioHoliday");
    setExpiryOtherReason("");
    setExpiryNote("");
  }

  const adjustExpiryMutation = useMutation({
    mutationFn: async () => {
      const body = {
        adjustmentMethod: expiryAdjustmentMethod,
        additionalDays: expiryAdjustmentMethod === "addDays" ? Number(expiryAdditionalDays) : undefined,
        newExpiresAt: expiryAdjustmentMethod === "setDate" ? expiryNewDate : undefined,
        reason: expiryReason,
        otherReason: expiryReason === "other" ? expiryOtherReason.trim() : undefined,
        note: expiryNote.trim() || undefined,
      };
      const res = await fetch(`${API_BASE}/api/admin/ballet/applications/${appId}/subscription/expiry`, {
        method: "PATCH",
        headers: makeHeaders(token),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Failed to adjust subscription expiry");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Subscription expiry adjusted" });
      closeAdjustExpiryDialog();
      queryClient.invalidateQueries({ queryKey: ["ballet-application", appId] });
      queryClient.invalidateQueries({ queryKey: ["admin-ballet-payments"] });
      queryClient.invalidateQueries({ queryKey: ["ballet-students"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  async function handleExportPdf() {
    setIsExportingPdf(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/ballet/applications/${appId}/export.pdf`, { headers: makeHeaders(token) });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Failed to export PDF");
      }
      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") ?? "";
      const fallbackName = `Ballet-Application-${appId}-${app?.childName ?? "application"}.pdf`;
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({ title: "Export failed", description: (err as Error)?.message ?? "Failed to export PDF", variant: "destructive" });
    } finally {
      setIsExportingPdf(false);
    }
  }

  // ── Attendance history + monthly summary (D1) ──────────────────────────────
  // A dedicated fetch against the new GET endpoint — the detail route above
  // already carries this month's summary (attendanceSummary, kept as-is
  // below); this one additionally carries the full history list so staff can
  // see and correct past entries.

  const { data: attendanceHistoryData } = useQuery<AttendanceHistoryResponse>({
    queryKey: ["ballet-attendance-history", data?.assignmentId],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/admin/ballet/attendance?levelAssignmentId=${data!.assignmentId}`, {
        headers: makeHeaders(token),
      });
      if (!res.ok) throw new Error("Failed to load attendance history");
      return res.json();
    },
    enabled: data?.assignmentId != null,
  });

  // ── Attendance mutation (C3 / D1) ───────────────────────────────────────────

  const attendanceMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/api/admin/ballet/attendance`, {
        method: "POST",
        headers: makeHeaders(token),
        body: JSON.stringify({
          levelAssignmentId: data?.assignmentId,
          balletScheduleId: parseInt(attScheduleId, 10),
          classDate: attDate,
          status: attStatus,
          durationMinutes: attDuration ? parseInt(attDuration, 10) : undefined,
          note: attNote || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw Object.assign(
          new Error((err as { error?: string }).error ?? "Failed to record attendance"),
          { existingAttendanceId: (err as { existingAttendanceId?: number }).existingAttendanceId },
        );
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Attendance recorded" });
      setAttScheduleId("");
      setAttDate("");
      setAttStatus("checked_in");
      setAttDuration("");
      setAttNote("");
      queryClient.invalidateQueries({ queryKey: ["ballet-application", appId] });
      queryClient.invalidateQueries({ queryKey: ["ballet-attendance-history", data?.assignmentId] });
    },
    onError: (e: Error & { existingAttendanceId?: number | null }) => toast({
      title: "Error",
      description: e.existingAttendanceId
        ? `${e.message} (existing record #${e.existingAttendanceId})`
        : e.message,
      variant: "destructive",
    }),
  });

  // ── Attendance correction mutation (D1) ─────────────────────────────────────

  const patchAttendanceMutation = useMutation({
    mutationFn: async (vars: { id: number; status: string; durationMinutes: string; note: string }) => {
      const res = await fetch(`${API_BASE}/api/admin/ballet/attendance/${vars.id}`, {
        method: "PATCH",
        headers: makeHeaders(token),
        body: JSON.stringify({
          status: vars.status,
          durationMinutes: vars.durationMinutes ? parseInt(vars.durationMinutes, 10) : null,
          note: vars.note || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Failed to update attendance");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Attendance corrected" });
      setEditingAttendanceId(null);
      queryClient.invalidateQueries({ queryKey: ["ballet-application", appId] });
      queryClient.invalidateQueries({ queryKey: ["ballet-attendance-history", data?.assignmentId] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function startEditAttendance(row: AttendanceHistoryRow) {
    setEditingAttendanceId(row.id);
    setEditStatus(row.status);
    setEditDuration(row.durationMinutes != null ? String(row.durationMinutes) : "");
    setEditNote(row.notes ?? "");
  }

  // ── Render states ───────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/ballet/applications")}>
          <ChevronLeft className="mr-1 h-4 w-4" /> Back
        </Button>
        <p className="text-destructive text-sm">Failed to load application.</p>
      </div>
    );
  }

  const { application: app, assessmentSchedule, level, group, events, groupSchedules, attendanceSummary, currentPayment, payments } = data;
  const cancellationRequests = data.cancellationRequests ?? [];
  const refunds = data.refunds ?? [];
  const eligibleRefund = data.eligibleRefund;
  const openCancellationRequest = cancellationRequests.find((r) => r.status === "pendingReview" || r.status === "approved") ?? null;
  // Admin viewer: reapplyAllowed is false — admins never "Apply Again" on a
  // parent's behalf; terminal states resolve to no destructive action.
  const dangerAction = resolveBalletDangerAction({
    applicationStatus: app.status,
    assignmentStatus: data.assignmentId != null ? "active" : null,
    openCancellationRequestStatus: openCancellationRequest?.status ?? null,
    viewer: "admin",
    reapplyAllowed: false,
  });
  const currentSubscription = data.currentSubscription ?? currentPayment;
  const canAdjustExpiry = Boolean(canEditPayments && currentSubscription?.status === "paid" && currentSubscription.hasActiveSubscription && currentSubscription.subscriptionExpiresAt);
  const expiryAdditionalDaysNumber = Number(expiryAdditionalDays);
  const isExpiryFormValid = expiryReason !== "other" || expiryOtherReason.trim().length >= 3;
  const canSubmitExpiryAdjustment = isExpiryFormValid && (
    expiryAdjustmentMethod === "addDays"
      ? Number.isInteger(expiryAdditionalDaysNumber) && expiryAdditionalDaysNumber > 0
      : Boolean(expiryNewDate && currentSubscription?.subscriptionExpiresAt && expiryNewDate > currentSubscription.subscriptionExpiresAt)
  );
  const activeSchedules = (groupSchedules ?? []).filter((s) => s.status === "active");
  const levels = levelsData?.levels ?? [];
  // Groups are only offered for the level actually assigned to this
  // application — mirrors the existing level-filter pattern used elsewhere
  // in this admin app (client-side filter, no backend query param).
  const groups = (groupsData?.data ?? []).filter((g) => g.levelId === app.assignedLevelId);
  const permittedStatuses = ALL_STATUSES.filter((status) => {
    if (status.value === "rejected") return canReject;
    if (["accepted", "assignedToLevel", "active"].includes(status.value)) return canApprove;
    return canReview;
  }).filter((status) =>
    isTransitionAllowed(app.status as BalletApplicationStatus, status.value as BalletApplicationStatus)
  );

  return (
    <div className="space-y-6">
      {/* Back + Header */}
      <div className="flex items-start gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/ballet/applications")}
          className="mt-1 -ml-2 text-muted-foreground"
        >
          <ChevronLeft className="mr-1 h-4 w-4" /> Back
        </Button>
        <div className="flex-1">
          <PageHeader
            title={app.childName}
            description={`Ballet Application #${app.id} · Submitted by ${app.parentName}`}
            mode="stage"
          />
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4 p-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-semibold text-white">{app.childName}</span>
              <StatusBadge status={app.status} />
              <SubscriptionBadge payment={currentSubscription} />
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span>Parent: {app.parentName}</span>
              <span>Application #{app.id}</span>
              {app.childId != null && <span>Child profile #{app.childId}</span>}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>Submitted {formatDateTime(app.createdAt)}</span>
              <span>Last updated {formatDateTime(app.updatedAt)}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={handleExportPdf} disabled={isExportingPdf}>
              {isExportingPdf ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-2 h-3.5 w-3.5" />}
              Export PDF
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Application Status" value={<StatusBadge status={app.status} />} sub={`Updated ${new Date(app.updatedAt).toLocaleDateString()}`} />
        <SummaryCard label="Assigned Level" value={level?.name ?? "Not assigned"} sub={group?.name ? `Group: ${group.name}` : "No group yet"} />
        <SummaryCard label="Payment Status" value={<PaymentStatusBadge status={currentPayment?.status} />} sub={currentPayment ? `${currentPayment.amountEgp} EGP` : "No payment recorded"} />
        <SummaryCard label="Subscription" value={<SubscriptionBadge payment={currentSubscription} />} sub={currentSubscription?.subscriptionExpiresAt ? `Expires ${currentSubscription.subscriptionExpiresAt}` : "No active period"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column — application data */}
        <div className="lg:col-span-2 space-y-4">

          {/* Parent info */}
          <Section title="Parent / Guardian">
            <Field label="Name"  value={app.parentName} />
            <Field label="Phone" value={app.parentPhone} />
            <Field label="Email" value={app.parentEmail} />
            {app.parentStudentId && (
              <Field label="Student ID" value={`#${app.parentStudentId}`} />
            )}
          </Section>

          {/* Emergency contact */}
          {(app.emergencyContactName || app.emergencyContactPhone) && (
            <Section title="Emergency Contact">
              <Field label="Name"  value={app.emergencyContactName} />
              <Field label="Phone" value={app.emergencyContactPhone} />
            </Section>
          )}

          {/* Child info */}
          <Section title="Child Information">
            <Field label="Name"     value={app.childName} />
            <Field label="Birthday" value={app.childBirthday} />
            <Field label="Age"      value={app.childAge !== null ? `${app.childAge} years` : null} />
            <Field label="Gender"   value={app.childGender} />
            {app.childId !== null && (
              <Field label="Linked Child Profile" value={`#${app.childId}`} />
            )}
          </Section>

          {/* Experience */}
          <Section title="Dance Experience">
            <Field
              label="Previous experience"
              value={app.previousExperience ? "Yes" : "No"}
            />
            {app.experienceDetails && (
              <Field label="Details" value={app.experienceDetails} />
            )}
          </Section>

          {/* Medical */}
          {app.medicalNotes && (
            <Section title="Medical Notes">
              <p className="text-sm text-foreground whitespace-pre-wrap">{app.medicalNotes}</p>
            </Section>
          )}

          {/* Notes from parent */}
          {app.notes && (
            <Section title="Additional Notes (from parent)">
              <p className="text-sm text-foreground whitespace-pre-wrap">{app.notes}</p>
            </Section>
          )}

          {/* Assessment */}
          <Section title="Assessment">
            {assessmentSchedule ? (
              <>
                <Field label="Class" value={assessmentSchedule.classTitle} />
                <Field label="Level" value={assessmentSchedule.levelName} />
                <Field label="Schedule" value={`${DAY_NAMES[assessmentSchedule.dayOfWeek] ?? assessmentSchedule.dayOfWeek} ${assessmentSchedule.startTime} – ${assessmentSchedule.endTime}`} />
                <Field label="Selected date" value={app.assessmentDate} />
                {assessmentSchedule.instructorName && (
                  <Field label="Instructor" value={assessmentSchedule.instructorName} />
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                No assessment schedule selected
              </p>
            )}
          </Section>

          <Section title="Payment">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Current status" value={<PaymentStatusBadge status={currentPayment?.status} />} />
              <Field label="Subscription" value={<SubscriptionBadge payment={currentSubscription} />} />
              <Field label="Amount" value={currentPayment ? `${currentPayment.amountEgp} EGP` : null} />
              <Field
                label="Preferred package"
                value={
                  app.preferredPackageName
                    ? `${app.preferredPackageName}${app.preferredPackageId ? ` (#${app.preferredPackageId})` : ""}`
                    : "No preferred package selected (legacy application)"
                }
              />
              <Field label="Package" value={currentPayment?.packageName ?? (currentPayment?.packageId ? `#${currentPayment.packageId}` : null)} />
              <Field label="Billing month" value={currentPayment?.billingMonth} />
              <Field label="Preferred method" value={formatPaymentMethod(app.preferredPaymentMethod)} />
              <Field label="Recorded method" value={formatPaymentMethod(currentPayment?.paymentMethod)} />
              <Field label="Start date" value={currentSubscription?.subscriptionStartDate} />
              <Field label="Original expiry" value={currentSubscription?.originalExpiresAt} />
              <Field label="Current expiry" value={currentSubscription?.subscriptionExpiresAt} />
              <Field label="Days remaining" value={currentSubscription?.daysRemaining != null ? `${currentSubscription.daysRemaining}` : null} />
              <Field label="Renewal" value={currentSubscription?.isRenewal ? `Renewed from #${currentSubscription.renewedFromId}` : "Initial subscription"} />
              <Field label="Last update" value={currentPayment?.updatedAt ? new Date(currentPayment.updatedAt).toLocaleString() : null} />
            </div>
            {currentSubscription?.subscriptionStatus === "expired" && (
              <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                Subscription renewal is required. Expired on {currentSubscription.subscriptionExpiresAt}.
              </p>
            )}
          </Section>

          <Section title="Subscription Management">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Current cycle" value={currentSubscription ? `Payment #${currentSubscription.id}` : null} />
              <Field label="Package" value={currentSubscription?.packageName ?? (currentSubscription?.packageId ? `#${currentSubscription.packageId}` : null)} />
              <Field label="Payment state" value={<PaymentStatusBadge status={currentSubscription?.status} />} />
              <Field label="Subscription state" value={<SubscriptionBadge payment={currentSubscription} />} />
              <Field label="Expiry date" value={currentSubscription?.subscriptionExpiresAt} />
              <Field
                label="Latest adjustment"
                value={currentSubscription?.extensionHistory?.length
                  ? `${currentSubscription.extensionHistory[currentSubscription.extensionHistory.length - 1]?.previousExpiresAt} → ${currentSubscription.extensionHistory[currentSubscription.extensionHistory.length - 1]?.newExpiresAt}`
                  : null}
              />
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              {canEditPayments && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!canAdjustExpiry}
                  onClick={() => setAdjustExpiryOpen(true)}
                >
                  Adjust Expiry
                </Button>
              )}
              {canViewPayments && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/ballet/payments?applicationId=${appId}`)}
                >
                  Open Payment History
                </Button>
              )}
            </div>
            {!canAdjustExpiry && currentSubscription?.subscriptionStatus === "expired" && (
              <p className="text-xs text-muted-foreground">
                Expired cycles are not adjusted here. Create a pending renewal from Ballet Payments, then confirm payment when collected.
              </p>
            )}
          </Section>

          {/* Assigned level (if any) */}
          {(level || app.assignedLevelId) && (
            <Section title="Assigned Level">
              <Field label="Level"       value={level?.name ?? `ID ${app.assignedLevelId}`} />
              <Field label="Group"       value={group?.name} />
              <Field label="Assigned at" value={app.assignedAt ? new Date(app.assignedAt).toLocaleString() : null} />
            </Section>
          )}

          <Section title="Cancellation & Refunds">
            {cancellationRequests.length === 0 && refunds.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No cancellation or refund workflow records.</p>
            ) : (
              <div className="space-y-3">
                {cancellationRequests.map((request) => (
                  <div key={`cancel-${request.id}`} className="rounded-md border p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">Cancellation #{request.id}</span>
                      <Badge variant="outline">{request.status}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Requested {request.requestedTiming}
                      {request.approvedTiming ? ` · approved ${request.approvedTiming}` : ""}
                      {request.approvedEffectiveDate ? ` · effective ${request.approvedEffectiveDate}` : ""}
                      {request.requestRefund ? " · refund requested" : ""}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Initiated by: {request.initiatedByType === "admin"
                        ? (request.initiatedByAdminName ?? "Admin")
                        : (BALLET_CANCELLATION_INITIATOR_LABELS[(request.initiatedByType as BalletCancellationInitiatorType) ?? "parent"] ?? "Parent")}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">{request.reason}</p>
                  </div>
                ))}
                {refunds.map((refund) => (
                  <div key={`refund-${refund.id}`} className="rounded-md border p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">Refund #{refund.id} · Payment #{refund.paymentId}</span>
                      <Badge variant="outline">{refund.status}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {refund.refundMethod === "cash" ? "Cash refund" : refund.refundMethod}
                      {refund.approvedAmountEgp ? ` · approved ${refund.approvedAmountEgp} EGP` : ""}
                      {refund.refundedAmountEgp ? ` · refunded ${refund.refundedAmountEgp} EGP` : ""}
                      {refund.transactionReference ? ` · ref ${refund.transactionReference}` : ""}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">{refund.requestedReason}</p>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Attendance hours — this month (C4). Only meaningful once a level
              is assigned; the backend returns null otherwise. */}
          {app.assignedLevelId != null && (
            <Section title={`Attendance — ${attendanceSummary?.billingMonth ?? "this month"}`}>
              {attendanceSummary && attendanceSummary.hasActiveSubscription ? (
                <>
                  <Field label="Monthly hours"  value={`${attendanceSummary.monthlyHours}h`} />
                  <Field label="Attended"        value={`${attendanceSummary.attendedHours}h`} />
                  <Field label="Absent"          value={`${attendanceSummary.absentHours}h`} />
                  <Field label="Consumed"        value={`${attendanceSummary.consumedHours}h`} />
                  <Field label="Remaining"       value={`${attendanceSummary.remainingHours}h`} />
                </>
              ) : attendanceSummary ? (
                <>
                  <p className="text-sm text-muted-foreground italic">
                    No active monthly subscription for {attendanceSummary.billingMonth}.
                  </p>
                  {/* Attendance facts still shown even without a subscription. */}
                  <Field label="Attended" value={`${attendanceSummary.attendedHours}h`} />
                  <Field label="Absent"   value={`${attendanceSummary.absentHours}h`} />
                </>
              ) : (
                <p className="text-sm text-muted-foreground italic">No attendance data.</p>
              )}
            </Section>
          )}

          {/* Metadata */}
          <Section title="Metadata">
            <Field label="Application ID" value={`#${app.id}`} />
            <Field label="Submitted"       value={new Date(app.createdAt).toLocaleString()} />
            <Field label="Last updated"    value={new Date(app.updatedAt).toLocaleString()} />
          </Section>
        </div>

        {/* Right column — actions + timeline */}
        <div className="space-y-4">

          {/* Status change */}
          {permittedStatuses.length > 0 && <div className="rounded-lg border bg-card p-5 space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Change Status
            </h3>
            <div className="flex items-center gap-2">
              <StatusBadge status={app.status} />
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">new status</span>
            </div>
            <Select value={newStatus} onValueChange={setNewStatus}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Select new status…" />
              </SelectTrigger>
              <SelectContent>
                {permittedStatuses.filter((s) => s.value !== app.status).map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea
              className="text-sm min-h-[64px] resize-none"
              placeholder="Note (optional)"
              value={statusNote}
              onChange={(e) => setStatusNote(e.target.value)}
            />
            <Button
              size="sm"
              disabled={!newStatus || statusMutation.isPending}
              onClick={() => statusMutation.mutate()}
              style={{ background: "#00B6D6", color: "#000" }}
              className="w-full"
            >
              {statusMutation.isPending ? (
                <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Saving…</>
              ) : "Update Status"}
            </Button>
          </div>}

          {/* Level assignment */}
          {canApprove && levels.length > 0 && (
            <div className="rounded-lg border bg-card p-5 space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Assign to Level
              </h3>
              <Select value={newLevelId} onValueChange={setNewLevelId}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Select level…" />
                </SelectTrigger>
                <SelectContent>
                  {levels.map((l) => (
                    <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Textarea
                className="text-sm min-h-[64px] resize-none"
                placeholder="Note (optional)"
                value={levelNote}
                onChange={(e) => setLevelNote(e.target.value)}
              />
              <Button
                size="sm"
                disabled={!newLevelId || levelMutation.isPending}
                onClick={() => levelMutation.mutate()}
                style={{ background: "#00B6D6", color: "#000" }}
                className="w-full"
              >
                {levelMutation.isPending ? (
                  <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Assigning…</>
                ) : "Assign Level"}
              </Button>
            </div>
          )}

          {/* Group assignment — only once a level is assigned; supports
              reassignment the same way the level section does. */}
          {canApprove && app.assignedLevelId != null && groups.length > 0 && (
            <div className="rounded-lg border bg-card p-5 space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Assign to Group
              </h3>
              <Select value={newGroupId} onValueChange={setNewGroupId}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Select group…" />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Textarea
                className="text-sm min-h-[64px] resize-none"
                placeholder="Note (optional)"
                value={groupNote}
                onChange={(e) => setGroupNote(e.target.value)}
              />
              <Button
                size="sm"
                disabled={!newGroupId || groupMutation.isPending}
                onClick={() => groupMutation.mutate()}
                style={{ background: "#00B6D6", color: "#000" }}
                className="w-full"
              >
                {groupMutation.isPending ? (
                  <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Assigning…</>
                ) : "Assign Group"}
              </Button>
            </div>
          )}

          {/* Mark attendance (C3) — minimal admin-recorded path. Shown only when
              this student has an active level assignment with a group that has
              schedules, and the admin holds attendance:checkIn. The schedule
              picker is scoped to the group's own schedules (what the endpoint
              will accept). */}
          {canCheckIn && data.assignmentId != null && activeSchedules.length > 0 && (
            <div className="rounded-lg border bg-card p-5 space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Mark Attendance
              </h3>
              <Select value={attScheduleId} onValueChange={setAttScheduleId}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Select class schedule…" />
                </SelectTrigger>
                <SelectContent>
                  {activeSchedules.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {DAY_NAMES[s.dayOfWeek] ?? "?"} {s.startTime}–{s.endTime}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input
                type="date"
                className="w-full h-8 rounded-md border bg-background px-2 text-sm"
                value={attDate}
                onChange={(e) => setAttDate(e.target.value)}
              />
              <Select value={attStatus} onValueChange={setAttStatus}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ATTENDANCE_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* D1: optional — defaults server-side to the schedule's own duration. */}
              <input
                type="number"
                min={0}
                className="w-full h-8 rounded-md border bg-background px-2 text-sm"
                placeholder="Duration in minutes (optional — defaults to schedule length)"
                value={attDuration}
                onChange={(e) => setAttDuration(e.target.value)}
              />
              <Textarea
                className="text-sm min-h-[56px] resize-none"
                placeholder="Note (optional)"
                value={attNote}
                onChange={(e) => setAttNote(e.target.value)}
              />
              <Button
                size="sm"
                disabled={!attScheduleId || !attDate || attendanceMutation.isPending}
                onClick={() => attendanceMutation.mutate()}
                style={{ background: "#00B6D6", color: "#000" }}
                className="w-full"
              >
                {attendanceMutation.isPending ? (
                  <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Recording…</>
                ) : "Record Attendance"}
              </Button>
            </div>
          )}

          {/* Attendance history + correction (D1) — shown alongside Mark
              Attendance whenever this student has an active level assignment. */}
          {canCheckIn && data.assignmentId != null && (
            <div className="rounded-lg border bg-card p-5 space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Attendance History
              </h3>
              {!attendanceHistoryData || attendanceHistoryData.history.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No attendance recorded yet.</p>
              ) : (
                <div className="space-y-2">
                  {attendanceHistoryData.history.map((row) => (
                    <div key={row.id} className="rounded-md border p-3 text-sm space-y-2">
                      {editingAttendanceId === row.id ? (
                        <>
                          <Select value={editStatus} onValueChange={setEditStatus}>
                            <SelectTrigger className="h-8 text-sm">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ATTENDANCE_STATUSES.map((s) => (
                                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <input
                            type="number"
                            min={0}
                            className="w-full h-8 rounded-md border bg-background px-2 text-sm"
                            placeholder="Duration in minutes"
                            value={editDuration}
                            onChange={(e) => setEditDuration(e.target.value)}
                          />
                          <Textarea
                            className="text-sm min-h-[48px] resize-none"
                            placeholder="Note (optional)"
                            value={editNote}
                            onChange={(e) => setEditNote(e.target.value)}
                          />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              disabled={patchAttendanceMutation.isPending}
                              onClick={() => patchAttendanceMutation.mutate({ id: row.id, status: editStatus, durationMinutes: editDuration, note: editNote })}
                              style={{ background: "#00B6D6", color: "#000" }}
                            >
                              {patchAttendanceMutation.isPending ? (
                                <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Saving…</>
                              ) : "Save Correction"}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditingAttendanceId(null)}>
                              Cancel
                            </Button>
                          </div>
                        </>
                      ) : (
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium">{row.classDate ?? "—"}</span>
                              <Badge variant="outline" className="text-xs">
                                {ATTENDANCE_STATUSES.find((s) => s.value === row.status)?.label ?? row.status}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                {row.durationMinutes != null ? `${row.durationMinutes} min` : "no duration"}
                              </span>
                            </div>
                            {row.notes && <p className="mt-1 text-xs text-muted-foreground">{row.notes}</p>}
                          </div>
                          <Button size="sm" variant="ghost" onClick={() => startEditAttendance(row)}>
                            Correct
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Event timeline */}
          <div className="rounded-lg border bg-card p-5 space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Event History
            </h3>
            {events.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No events yet.</p>
            ) : (
              <div className="relative space-y-4">
                {/* Vertical line */}
                <div className="absolute left-3 top-2 bottom-2 w-px bg-border" aria-hidden />
                {events.map((ev) => (
                  <div key={ev.id} className="flex gap-3 pl-7 relative">
                    {/* Dot */}
                    <div
                      className="absolute left-1.5 top-1.5 h-3 w-3 rounded-full border-2 border-background"
                      style={{ background: "#00B6D6" }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {ev.fromStatus ? (
                          <>
                            <StatusBadge status={ev.fromStatus} />
                            <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                          </>
                        ) : null}
                        <StatusBadge status={ev.toStatus} />
                      </div>
                      {ev.note && (
                        <p className="mt-1 text-xs text-muted-foreground">{ev.note}</p>
                      )}
                      <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground/60">
                        <Clock className="h-2.5 w-2.5" />
                        {new Date(ev.createdAt).toLocaleString()}
                        {ev.changedByFullName && (
                          <>
                            <User className="h-2.5 w-2.5" />
                            {ev.changedByFullName}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Danger Zone ──────────────────────────────────────────────────────
          Visually separated from routine subscription/level/group actions.
          Reuses the existing cancellation workflow endpoints. */}
      {canCancel && (
        <Card className="border-red-500/40">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm text-red-400">
              <AlertTriangle className="h-4 w-4" /> Danger Zone
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {dangerAction.kind === "cancelApplication" && (
              <>
                <p className="text-sm text-muted-foreground">
                  Cancel this pre-activation application. Any assigned level becomes <em>withdrawn</em> (never deleted); attendance and history are preserved.
                </p>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => { setDangerDialog("cancelApplication"); }}
                >
                  Cancel Application
                </Button>
              </>
            )}
            {dangerAction.kind === "cancelProgram" && (
              <>
                <p className="text-sm text-muted-foreground">
                  Cancel this active enrollment. This creates a cancellation request in the shared workflow (never edits the enrollment rows directly) and writes an audit log.
                </p>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => { setCancelTiming("immediate"); setDangerDialog("cancelProgram"); }}
                >
                  Cancel Program
                </Button>
              </>
            )}
            {dangerAction.kind === "viewCancellationRequest" && (
              <>
                <p className="text-sm text-muted-foreground">
                  An open cancellation request already exists for this enrollment ({openCancellationRequest?.status}). Manage it from the Cancellation Requests workflow.
                </p>
                <Button variant="outline" size="sm" onClick={() => navigate("/ballet/cancellation-requests")}>
                  Manage Cancellation Request
                </Button>
              </>
            )}
            {dangerAction.kind === "none" && (
              <p className="text-sm text-muted-foreground italic">
                No cancellation action is available for an application in status “{app.status}”.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={adjustExpiryOpen} onOpenChange={(open) => (open ? setAdjustExpiryOpen(true) : closeAdjustExpiryDialog())}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Adjust Subscription Expiry</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border bg-muted/20 p-3 text-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Current expiry</div>
              <div className="mt-1 text-foreground">{currentSubscription?.subscriptionExpiresAt ?? "—"}</div>
            </div>

            <div className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Adjustment</div>
              <Select value={expiryAdjustmentMethod} onValueChange={(value) => setExpiryAdjustmentMethod(value as "addDays" | "setDate")}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="addDays">Add days</SelectItem>
                  <SelectItem value="setDate">Set new expiry date</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {expiryAdjustmentMethod === "addDays" ? (
              <div className="space-y-1">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Additional days</div>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={expiryAdditionalDays}
                  onChange={(event) => setExpiryAdditionalDays(event.target.value)}
                  placeholder="e.g. 7"
                />
              </div>
            ) : (
              <div className="space-y-1">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">New expiry date</div>
                <Input
                  type="date"
                  value={expiryNewDate}
                  min={currentSubscription?.subscriptionExpiresAt ? addOneDay(currentSubscription.subscriptionExpiresAt) : undefined}
                  onChange={(event) => setExpiryNewDate(event.target.value)}
                />
              </div>
            )}

            <div className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Reason</div>
              <Select value={expiryReason} onValueChange={(value) => setExpiryReason(value as typeof expiryReason)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EXPIRY_ADJUSTMENT_REASONS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {expiryReason === "other" && (
              <div className="space-y-1">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Written reason</div>
                <Textarea
                  className="text-sm min-h-[64px] resize-none"
                  value={expiryOtherReason}
                  onChange={(event) => setExpiryOtherReason(event.target.value)}
                  placeholder="Describe the reason"
                />
              </div>
            )}

            <div className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Internal note</div>
              <Textarea
                className="text-sm min-h-[64px] resize-none"
                value={expiryNote}
                onChange={(event) => setExpiryNote(event.target.value)}
                placeholder="Optional"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={closeAdjustExpiryDialog} disabled={adjustExpiryMutation.isPending}>Cancel</Button>
              <Button size="sm" onClick={() => adjustExpiryMutation.mutate()} disabled={!canSubmitExpiryAdjustment || adjustExpiryMutation.isPending}>
                {adjustExpiryMutation.isPending ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Saving…</> : "Save Adjustment"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Cancel Application (pre-activation) dialog */}
      <Dialog open={dangerDialog === "cancelApplication"} onOpenChange={(open) => (open ? setDangerDialog("cancelApplication") : closeDangerDialog())}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-red-400">Cancel Application</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              This cancels the application using the existing admin cancellation transaction. An assigned level (if any) becomes withdrawn; attendance/history is preserved.
            </p>
            <Textarea
              className="text-sm min-h-[72px] resize-none"
              placeholder="Cancellation reason (required, min 5 characters)"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            />
            {eligibleRefund?.eligible && (
              <>
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground space-y-1">
                  <div>Eligible payment #{eligibleRefund.paymentId} · Pay at Studio (cash refund only)</div>
                  <div>Original amount: {eligibleRefund.originalAmountEgp} EGP</div>
                  <div>Already refunded: {eligibleRefund.alreadyRefundedEgp} EGP</div>
                  <div>Remaining refundable: {eligibleRefund.remainingRefundableEgp} EGP</div>
                </div>
                <label className="flex items-start gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={cancelRequestRefund} onChange={(e) => setCancelRequestRefund(e.target.checked)} />
                  Request a cash refund (an underReview refund record; the amount is decided later — no Bank Transfer / Online refund).
                </label>
              </>
            )}
            <Button
              variant="destructive"
              size="sm"
              className="w-full"
              disabled={cancelReason.trim().length < 5 || cancelApplicationMutation.isPending}
              onClick={() => cancelApplicationMutation.mutate()}
            >
              {cancelApplicationMutation.isPending ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Cancelling…</> : "Confirm Cancel Application"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Cancel Program (active enrollment) dialog */}
      <Dialog open={dangerDialog === "cancelProgram"} onOpenChange={(open) => (open ? setDangerDialog("cancelProgram") : closeDangerDialog())}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-red-400">Cancel Program</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Creates and approves a cancellation request in the shared workflow. “Immediate” withdraws the enrollment now; “End of Current Period” keeps it active until the effective date. Cancellation is separate from any refund.
            </p>
            <Select value={cancelTiming} onValueChange={(v) => setCancelTiming(v as "immediate" | "endOfPeriod")}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="immediate">Immediate</SelectItem>
                <SelectItem value="endOfPeriod">End of Current Period</SelectItem>
              </SelectContent>
            </Select>
            <Textarea
              className="text-sm min-h-[64px] resize-none"
              placeholder="Cancellation reason (required, min 5 characters)"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            />
            <Textarea
              className="text-sm min-h-[48px] resize-none"
              placeholder="Internal admin notes (optional)"
              value={cancelAdminNotes}
              onChange={(e) => setCancelAdminNotes(e.target.value)}
            />
            {eligibleRefund?.eligible && (
              <>
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground space-y-1">
                  <div>Eligible payment #{eligibleRefund.paymentId} · Pay at Studio (cash refund only)</div>
                  <div>Original amount: {eligibleRefund.originalAmountEgp} EGP</div>
                  <div>Already refunded: {eligibleRefund.alreadyRefundedEgp} EGP</div>
                  <div>Remaining refundable: {eligibleRefund.remainingRefundableEgp} EGP</div>
                </div>
                <label className="flex items-start gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={cancelRequestRefund} onChange={(e) => setCancelRequestRefund(e.target.checked)} />
                  Request a cash refund (an underReview refund record; the amount is decided later — no Bank Transfer / Online refund).
                </label>
              </>
            )}
            <Button
              variant="destructive"
              size="sm"
              className="w-full"
              disabled={cancelReason.trim().length < 5 || initiateCancellationMutation.isPending}
              onClick={() => initiateCancellationMutation.mutate()}
            >
              {initiateCancellationMutation.isPending ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Submitting…</> : (cancelTiming === "immediate" ? "Confirm Immediate Cancellation" : "Confirm End-of-Period Cancellation")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
