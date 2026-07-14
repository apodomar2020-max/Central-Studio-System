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
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, ChevronLeft, Clock, User, ArrowRight, Download, CreditCard } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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
  slotId: number | null;
  slotLabel: string | null;
  status: string;
  adminNotes: string | null;
  assignedLevelId: number | null;
  assignedAt: string | null;
  createdAt: string;
  preferredPaymentMethod: string | null;
  updatedAt: string;
}

interface Slot {
  id: number;
  date: string;
  startTime: string;
  endTime: string;
  capacity: number;
  isActive: boolean;
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

interface SubscriptionExtension {
  previousExpiresAt: string;
  newExpiresAt: string;
  daysAdded: number;
  reason: string;
  note: string | null;
  actorId: number | null;
  extendedAt: string;
}

interface BalletPackage {
  id: number;
  name: string;
  priceEgp: number;
  monthlyHours: number;
  isActive: boolean;
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
  slot: Slot | null;
  level: Level | null;
  group: Group | null;
  assignmentId: number | null;
  groupSchedules: GroupSchedule[];
  events: Event[];
  payments: BalletPayment[];
  currentPayment: BalletPayment | null;
  currentSubscription: BalletPayment | null;
  attendanceSummary: AttendanceSummary | null;
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

interface PackagesResponse {
  data: BalletPackage[];
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
];

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  pending:           { label: "Pending",            className: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  accepted:          { label: "Accepted",           className: "bg-green-500/15 text-green-400 border-green-500/30" },
  rejected:          { label: "Rejected",           className: "bg-red-500/15 text-red-400 border-red-500/30" },
  needsFollowUp:     { label: "Needs Follow-up",    className: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" },
  assignedToLevel:   { label: "Assigned to Level",  className: "bg-purple-500/15 text-purple-400 border-purple-500/30" },
  active:            { label: "Active",             className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  cancelled:         { label: "Cancelled",           className: "bg-slate-500/15 text-slate-400 border-slate-500/30" },
};

const PAYMENT_STATUSES = [
  { value: "pending", label: "Pending" },
  { value: "paid", label: "Paid" },
  { value: "rejected", label: "Rejected" },
  { value: "refunded", label: "Refunded" },
];

const PAYMENT_METHODS = [
  { value: "bankTransfer", label: "Bank Transfer" },
  { value: "kashier", label: "Kashier" },
  { value: "inPerson", label: "In Person" },
];

const PAYMENT_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  pending:  { label: "Pending",  className: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" },
  paid:     { label: "Paid",     className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  rejected: { label: "Rejected", className: "bg-red-500/15 text-red-400 border-red-500/30" },
  refunded: { label: "Refunded", className: "bg-slate-500/15 text-slate-400 border-slate-500/30" },
};

function formatPaymentMethod(method?: string | null) {
  return PAYMENT_METHODS.find((item) => item.value === method)?.label ?? method ?? null;
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

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
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
    <div className="rounded-lg border bg-card p-5 space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">{value ?? <span className="italic text-muted-foreground/60">—</span>}</span>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ApplicationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { token, can } = useAdminAuth();
  const canReview = can("ballet.applications", "review");
  const canApprove = can("ballet.applications", "approve");
  const canReject = can("ballet.applications", "reject");
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
  const [paymentPackageId, setPaymentPackageId] = useState("");
  const [paymentBillingMonth, setPaymentBillingMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentInitialStatus, setPaymentInitialStatus] = useState("pending");
  const [paymentStatus, setPaymentStatus] = useState("");
  const [paymentStartDate, setPaymentStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [paymentExpiresAt, setPaymentExpiresAt] = useState(() => addDays(new Date().toISOString().slice(0, 10), 30));
  const [renewPackageId, setRenewPackageId] = useState("");
  const [renewAmount, setRenewAmount] = useState("");
  const [renewMethod, setRenewMethod] = useState("");
  const [renewStatus, setRenewStatus] = useState("pending");
  const [renewStartDate, setRenewStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [renewExpiresAt, setRenewExpiresAt] = useState(() => addDays(new Date().toISOString().slice(0, 10), 30));
  const [extendMode, setExtendMode] = useState<"date" | "days">("days");
  const [extensionDays, setExtensionDays] = useState("");
  const [extensionDate, setExtensionDate] = useState("");
  const [extensionReason, setExtensionReason] = useState("studio_holiday");
  const [extensionNote, setExtensionNote] = useState("");
  const [confirmExpiredExtension, setConfirmExpiredExtension] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);

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

  const { data: packagesData } = useQuery<PackagesResponse>({
    queryKey: ["ballet-packages"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/admin/ballet/packages?limit=100`, {
        headers: makeHeaders(token),
      });
      if (!res.ok) throw new Error("Failed to load packages");
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

  // ── Payment mutations ──────────────────────────────────────────────────────

  const createPaymentMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/api/admin/ballet/payments`, {
        method: "POST",
        headers: makeHeaders(token),
        body: JSON.stringify({
          applicationId: appId,
          packageId: parseInt(paymentPackageId, 10),
          billingMonth: paymentBillingMonth,
          amountEgp: parseInt(paymentAmount, 10),
          paymentMethod: paymentMethod || data?.application.preferredPaymentMethod || undefined,
          status: paymentInitialStatus,
          startDate: paymentInitialStatus === "paid" ? paymentStartDate : undefined,
          expiresAt: paymentInitialStatus === "paid" ? paymentExpiresAt : undefined,
          levelAssignmentId: data?.assignmentId ?? undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Failed to create payment");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Payment created" });
      setPaymentPackageId("");
      setPaymentAmount("");
      setPaymentInitialStatus("pending");
      setPaymentStartDate(new Date().toISOString().slice(0, 10));
      setPaymentExpiresAt(addDays(new Date().toISOString().slice(0, 10), 30));
      queryClient.invalidateQueries({ queryKey: ["ballet-application", appId] });
      queryClient.invalidateQueries({ queryKey: ["ballet-applications"] });
      queryClient.invalidateQueries({ queryKey: ["ballet-students"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updatePaymentStatusMutation = useMutation({
    mutationFn: async (payment: BalletPayment) => {
      const res = await fetch(`${API_BASE}/api/admin/ballet/applications/${appId}/payments/${payment.id}/status`, {
        method: "PATCH",
        headers: makeHeaders(token),
        body: JSON.stringify({
          status: paymentStatus,
          startDate: paymentStatus === "paid" ? paymentStartDate : undefined,
          expiresAt: paymentStatus === "paid" ? paymentExpiresAt : undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Failed to update payment status");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Payment status updated" });
      setPaymentStatus("");
      queryClient.invalidateQueries({ queryKey: ["ballet-application", appId] });
      queryClient.invalidateQueries({ queryKey: ["ballet-applications"] });
      queryClient.invalidateQueries({ queryKey: ["ballet-students"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const renewSubscriptionMutation = useMutation({
    mutationFn: async (payment: BalletPayment) => {
      const res = await fetch(`${API_BASE}/api/admin/ballet/applications/${appId}/subscriptions/renew`, {
        method: "POST",
        headers: makeHeaders(token),
        body: JSON.stringify({
          renewedFromId: payment.id,
          packageId: parseInt(renewPackageId, 10),
          amountEgp: parseInt(renewAmount, 10),
          paymentMethod: renewMethod || payment.paymentMethod || data?.application.preferredPaymentMethod,
          status: renewStatus,
          startDate: renewStartDate,
          expiresAt: renewExpiresAt,
          billingMonth: paymentBillingMonth || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Failed to renew subscription");
      }
      return res.json();
    },
    onSuccess: (result: { duplicatePrevented?: boolean }) => {
      toast({ title: result.duplicatePrevented ? "Renewal already exists" : "Subscription renewed" });
      setRenewPackageId("");
      setRenewAmount("");
      setRenewStatus("pending");
      queryClient.invalidateQueries({ queryKey: ["ballet-application", appId] });
      queryClient.invalidateQueries({ queryKey: ["ballet-applications"] });
      queryClient.invalidateQueries({ queryKey: ["ballet-students"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const extendSubscriptionMutation = useMutation({
    mutationFn: async (payment: BalletPayment) => {
      const res = await fetch(`${API_BASE}/api/admin/ballet/applications/${appId}/payments/${payment.id}/extend`, {
        method: "PATCH",
        headers: makeHeaders(token),
        body: JSON.stringify({
          ...(extendMode === "days" ? { additionalDays: parseInt(extensionDays, 10) } : { newExpiresAt: extensionDate }),
          reason: extensionReason,
          note: extensionNote || null,
          confirmExpiredExtension,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Failed to extend subscription");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Subscription extended" });
      setExtensionDays("");
      setExtensionDate("");
      setExtensionNote("");
      setConfirmExpiredExtension(false);
      queryClient.invalidateQueries({ queryKey: ["ballet-application", appId] });
      queryClient.invalidateQueries({ queryKey: ["ballet-applications"] });
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

  const { application: app, slot, level, group, events, groupSchedules, attendanceSummary, currentPayment, payments } = data;
  const currentSubscription = data.currentSubscription ?? currentPayment;
  const activeSchedules = (groupSchedules ?? []).filter((s) => s.status === "active");
  const levels = levelsData?.levels ?? [];
  // Groups are only offered for the level actually assigned to this
  // application — mirrors the existing level-filter pattern used elsewhere
  // in this admin app (client-side filter, no backend query param).
  const groups = (groupsData?.data ?? []).filter((g) => g.levelId === app.assignedLevelId);
  const packages = (packagesData?.data ?? []).filter((pkg) => pkg.isActive);
  const permittedStatuses = ALL_STATUSES.filter((status) => {
    if (status.value === "rejected") return canReject;
    if (["accepted", "assignedToLevel", "active"].includes(status.value)) return canApprove;
    return canReview;
  });

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
            title={`Application #${app.id} — ${app.childName}`}
            description={`Submitted by ${app.parentName} · ${new Date(app.createdAt).toLocaleDateString()}`}
            mode="stage"
          >
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={app.status} />
              <Button variant="outline" size="sm" onClick={handleExportPdf} disabled={isExportingPdf}>
                {isExportingPdf ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-2 h-3.5 w-3.5" />}
                Export PDF
              </Button>
            </div>
          </PageHeader>
        </div>
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

          {/* Assessment slot */}
          <Section title="Assessment Slot">
            {slot ? (
              <>
                <Field label="Date"     value={slot.date} />
                <Field label="Time"     value={`${slot.startTime} – ${slot.endTime}`} />
                <Field label="Capacity" value={String(slot.capacity)} />
              </>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                {app.slotLabel ?? "No slot selected"}
              </p>
            )}
          </Section>

          <Section title="Payment">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Current status" value={<PaymentStatusBadge status={currentPayment?.status} />} />
              <Field label="Subscription" value={<SubscriptionBadge payment={currentSubscription} />} />
              <Field label="Amount" value={currentPayment ? `${currentPayment.amountEgp} EGP` : null} />
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
            {payments.length > 1 && (
              <div className="mt-4 space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Payment History</h4>
                <div className="space-y-2">
                  {payments.map((payment) => (
                    <div key={payment.id} className="rounded-md border p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">#{payment.id} · {payment.packageName ?? (payment.packageId ? `Package #${payment.packageId}` : "No package")}</span>
                        <div className="flex flex-wrap gap-2"><PaymentStatusBadge status={payment.status} /><SubscriptionBadge payment={payment} /></div>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {payment.amountEgp} EGP · {payment.billingMonth ?? "No billing month"} · {formatPaymentMethod(payment.paymentMethod) ?? "No method"} · {payment.subscriptionStartDate ?? "No start"} → {payment.subscriptionExpiresAt ?? "No expiry"} · {new Date(payment.updatedAt).toLocaleString()}
                      </p>
                      {payment.extensionHistory.length > 0 && (
                        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                          {payment.extensionHistory.map((extension, index) => (
                            <p key={`${payment.id}-ext-${index}`}>Extended {extension.previousExpiresAt} → {extension.newExpiresAt} (+{extension.daysAdded}d) · {extension.reason.replaceAll("_", " ")}</p>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
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

          <div className="rounded-lg border bg-card p-5 space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              <CreditCard className="mr-1 inline h-3.5 w-3.5" /> Payment
            </h3>
            {!currentPayment ? (
              <>
                <Select value={paymentPackageId} onValueChange={(value) => {
                  setPaymentPackageId(value);
                  const selected = packages.find((pkg) => String(pkg.id) === value);
                  if (selected) setPaymentAmount(String(selected.priceEgp));
                }}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="Select package…" />
                  </SelectTrigger>
                  <SelectContent>
                    {packages.map((pkg) => (
                      <SelectItem key={pkg.id} value={String(pkg.id)}>{pkg.name} · {pkg.priceEgp} EGP</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <input
                  type="month"
                  className="w-full h-8 rounded-md border bg-background px-2 text-sm"
                  value={paymentBillingMonth}
                  onChange={(e) => setPaymentBillingMonth(e.target.value)}
                />
                <input
                  type="number"
                  min={1}
                  className="w-full h-8 rounded-md border bg-background px-2 text-sm"
                  placeholder="Amount EGP"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                />
                <Select value={paymentMethod || app.preferredPaymentMethod || ""} onValueChange={setPaymentMethod}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="Payment method…" />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((method) => (
                      <SelectItem key={method.value} value={method.value}>{method.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={paymentInitialStatus} onValueChange={setPaymentInitialStatus}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_STATUSES.map((status) => (
                      <SelectItem key={status.value} value={status.value}>{status.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {paymentInitialStatus === "paid" && (
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      className="w-full h-8 rounded-md border bg-background px-2 text-sm"
                      value={paymentStartDate}
                      onChange={(e) => {
                        setPaymentStartDate(e.target.value);
                        setPaymentExpiresAt(addDays(e.target.value, 30));
                      }}
                    />
                    <input
                      type="date"
                      className="w-full h-8 rounded-md border bg-background px-2 text-sm"
                      value={paymentExpiresAt}
                      onChange={(e) => setPaymentExpiresAt(e.target.value)}
                    />
                  </div>
                )}
                <Button
                  size="sm"
                  disabled={!paymentPackageId || !paymentBillingMonth || !paymentAmount || !(paymentMethod || app.preferredPaymentMethod) || createPaymentMutation.isPending}
                  onClick={() => createPaymentMutation.mutate()}
                  style={{ background: "#00B6D6", color: "#000" }}
                  className="w-full"
                >
                  {createPaymentMutation.isPending ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Creating…</> : "Create Payment"}
                </Button>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <PaymentStatusBadge status={currentPayment.status} />
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">new status</span>
                </div>
                <Select value={paymentStatus} onValueChange={setPaymentStatus}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="Select payment status…" />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_STATUSES.filter((s) => s.value !== currentPayment.status).map((status) => (
                      <SelectItem key={status.value} value={status.value}>{status.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {paymentStatus === "paid" && (
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      className="w-full h-8 rounded-md border bg-background px-2 text-sm"
                      value={paymentStartDate}
                      onChange={(e) => {
                        setPaymentStartDate(e.target.value);
                        setPaymentExpiresAt(addDays(e.target.value, 30));
                      }}
                    />
                    <input
                      type="date"
                      className="w-full h-8 rounded-md border bg-background px-2 text-sm"
                      value={paymentExpiresAt}
                      onChange={(e) => setPaymentExpiresAt(e.target.value)}
                    />
                  </div>
                )}
                <Button
                  size="sm"
                  disabled={!paymentStatus || updatePaymentStatusMutation.isPending}
                  onClick={() => updatePaymentStatusMutation.mutate(currentPayment)}
                  style={{ background: "#00B6D6", color: "#000" }}
                  className="w-full"
                >
                  {updatePaymentStatusMutation.isPending ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Saving…</> : "Update Payment Status"}
                </Button>
                {currentSubscription && (
                  <div className="border-t pt-4 space-y-3">
                    <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Renew Subscription</h4>
                    <Select value={renewPackageId} onValueChange={(value) => {
                      setRenewPackageId(value);
                      const selected = packages.find((pkg) => String(pkg.id) === value);
                      if (selected) setRenewAmount(String(selected.priceEgp));
                    }}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Package…" /></SelectTrigger>
                      <SelectContent>{packages.map((pkg) => <SelectItem key={pkg.id} value={String(pkg.id)}>{pkg.name} · {pkg.priceEgp} EGP</SelectItem>)}</SelectContent>
                    </Select>
                    <input className="w-full h-8 rounded-md border bg-background px-2 text-sm" type="number" min={1} placeholder="Amount EGP" value={renewAmount} onChange={(e) => setRenewAmount(e.target.value)} />
                    <Select value={renewMethod || currentSubscription.paymentMethod || app.preferredPaymentMethod || ""} onValueChange={setRenewMethod}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Method…" /></SelectTrigger>
                      <SelectContent>{PAYMENT_METHODS.map((method) => <SelectItem key={method.value} value={method.value}>{method.label}</SelectItem>)}</SelectContent>
                    </Select>
                    <Select value={renewStatus} onValueChange={setRenewStatus}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>{PAYMENT_STATUSES.map((status) => <SelectItem key={status.value} value={status.value}>{status.label}</SelectItem>)}</SelectContent>
                    </Select>
                    <div className="grid grid-cols-2 gap-2">
                      <input type="date" className="w-full h-8 rounded-md border bg-background px-2 text-sm" value={renewStartDate} onChange={(e) => { setRenewStartDate(e.target.value); setRenewExpiresAt(addDays(e.target.value, 30)); }} />
                      <input type="date" className="w-full h-8 rounded-md border bg-background px-2 text-sm" value={renewExpiresAt} onChange={(e) => setRenewExpiresAt(e.target.value)} />
                    </div>
                    <Button size="sm" variant="outline" className="w-full" disabled={!renewPackageId || !renewAmount || !(renewMethod || currentSubscription.paymentMethod || app.preferredPaymentMethod) || renewSubscriptionMutation.isPending} onClick={() => renewSubscriptionMutation.mutate(currentSubscription)}>
                      {renewSubscriptionMutation.isPending ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Renewing…</> : "Renew Subscription"}
                    </Button>
                  </div>
                )}
                {currentSubscription?.subscriptionExpiresAt && (
                  <div className="border-t pt-4 space-y-3">
                    <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Extend Subscription</h4>
                    <Field label="Current expiry" value={currentSubscription.subscriptionExpiresAt} />
                    <Select value={extendMode} onValueChange={(value) => setExtendMode(value as "date" | "days")}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="days">Additional days</SelectItem><SelectItem value="date">New date</SelectItem></SelectContent>
                    </Select>
                    {extendMode === "days" ? (
                      <input className="w-full h-8 rounded-md border bg-background px-2 text-sm" type="number" min={1} placeholder="Additional days" value={extensionDays} onChange={(e) => setExtensionDays(e.target.value)} />
                    ) : (
                      <input className="w-full h-8 rounded-md border bg-background px-2 text-sm" type="date" value={extensionDate} onChange={(e) => setExtensionDate(e.target.value)} />
                    )}
                    <Select value={extensionReason} onValueChange={setExtensionReason}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="studio_holiday">Studio holiday</SelectItem>
                        <SelectItem value="emergency_closure">Emergency closure</SelectItem>
                        <SelectItem value="class_suspension">Class suspension</SelectItem>
                        <SelectItem value="instructor_unavailability">Instructor unavailability</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                    <Textarea className="text-sm min-h-[58px] resize-none" placeholder="Internal note (optional)" value={extensionNote} onChange={(e) => setExtensionNote(e.target.value)} />
                    {currentSubscription.subscriptionStatus === "expired" && (
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <input type="checkbox" checked={confirmExpiredExtension} onChange={(e) => setConfirmExpiredExtension(e.target.checked)} />
                        Confirm extending an expired subscription
                      </label>
                    )}
                    <Button size="sm" variant="outline" className="w-full" disabled={(extendMode === "days" ? !extensionDays : !extensionDate) || extendSubscriptionMutation.isPending} onClick={() => extendSubscriptionMutation.mutate(currentSubscription)}>
                      {extendSubscriptionMutation.isPending ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Extending…</> : "Extend Subscription"}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>

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
    </div>
  );
}
