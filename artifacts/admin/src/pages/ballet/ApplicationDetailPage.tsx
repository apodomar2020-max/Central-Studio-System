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
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, ChevronLeft, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  isTransitionAllowed,
  resolveBalletDangerAction,
  type BalletApplicationStatus,
} from "@workspace/api-zod";
import {
  ApplicationDetailTabPanels,
  Field,
  PaymentStatusBadge,
  StatusBadge,
  SubscriptionBadge,
} from "./application-detail";

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

interface BalletPackage {
  id: number;
  name: string;
  priceEgp: number;
  isActive: boolean;
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
  { value: "withdrawn",       label: "Withdrawn" },
];

const EXPIRY_ADJUSTMENT_REASONS = [
  { value: "studioHoliday", label: "Studio holiday" },
  { value: "classSuspension", label: "Class suspension" },
  { value: "medicalAccommodation", label: "Medical accommodation" },
  { value: "administrativeCorrection", label: "Administrative correction" },
  { value: "other", label: "Other" },
] as const;

const APPLICATION_DETAIL_TABS = [
  { value: "overview", label: "Overview" },
  { value: "application", label: "Application" },
  { value: "enrollment", label: "Enrollment" },
  { value: "payments", label: "Payments & Subscription" },
  { value: "cancellation", label: "Cancellation & Refunds" },
  { value: "activity", label: "Activity" },
] as const;

type ApplicationDetailTab = (typeof APPLICATION_DETAIL_TABS)[number]["value"];
type NextRequiredAction =
  | "Review Application"
  | "Assign Level"
  | "Assign Group"
  | "Create Initial Payment"
  | "Confirm Payment"
  | "Payment data requires review"
  | "Subscription expired — renewal required"
  | "Activate Application"
  | "Application closed"
  | "No action required";

const REVIEW_ACTION_STATUSES = new Set<BalletApplicationStatus>(["pending", "needsFollowUp"]);
const TERMINAL_ACTION_STATUSES = new Set<BalletApplicationStatus>(["rejected", "cancelled", "withdrawn"]);

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

function addOneDay(dateOnly: string) {
  const value = new Date(`${dateOnly}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function addDays(dateOnly: string, days: number) {
  const value = new Date(`${dateOnly}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function parseSubscriptionDate(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ApplicationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [location, navigate] = useLocation();
  const { token, can } = useAdminAuth();
  const canReview = can("ballet.applications", "review");
  const canApprove = can("ballet.applications", "approve");
  const canReject = can("ballet.applications", "reject");
  const canCancel = can("ballet.applications", "cancel");
  const canViewPayments = can("ballet.payments", "view");
  const canCreatePayments = can("ballet.payments", "create");
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
  const [createInitialPaymentOpen, setCreateInitialPaymentOpen] = useState(false);
  const [initialPaymentPackageId, setInitialPaymentPackageId] = useState("");
  const [initialPaymentBillingMonth, setInitialPaymentBillingMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [initialPaymentNotes, setInitialPaymentNotes] = useState("");
  const [confirmingPayment, setConfirmingPayment] = useState<BalletPayment | null>(null);
  const [confirmStartDate, setConfirmStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [confirmExpiresAt, setConfirmExpiresAt] = useState(() => addDays(new Date().toISOString().slice(0, 10), 30));

  // D1: inline correction state for an existing attendance history row.
  const [editingAttendanceId, setEditingAttendanceId] = useState<number | null>(null);
  const [editStatus, setEditStatus]     = useState("checked_in");
  const [editDuration, setEditDuration] = useState("");
  const [editNote, setEditNote]         = useState("");

  const appId = parseInt(id ?? "", 10);
  const queryTab = new URLSearchParams(location.split("?")[1] ?? "").get("tab");
  const activeTab = APPLICATION_DETAIL_TABS.some((tab) => tab.value === queryTab)
    ? (queryTab as ApplicationDetailTab)
    : "overview";
  const setActiveTab = (tab: string) => {
    const nextTab = APPLICATION_DETAIL_TABS.some((item) => item.value === tab) ? tab : "overview";
    navigate(`/ballet/applications/${appId}?tab=${nextTab}`);
  };

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
    queryKey: ["admin-ballet-packages-active", token],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/admin/ballet/packages?limit=100`, {
        headers: makeHeaders(token),
      });
      if (!res.ok) throw new Error("Failed to load packages");
      return res.json();
    },
    enabled: canCreatePayments,
  });

  // ── Status mutation ─────────────────────────────────────────────────────────

  const statusMutation = useMutation({
    mutationFn: async (vars?: { status?: string; note?: string }) => {
      const targetStatus = vars?.status ?? newStatus;
      const targetNote = vars?.note ?? (statusNote || undefined);
      const res = await fetch(`${API_BASE}/api/admin/ballet/applications/${appId}/status`, {
        method: "PATCH",
        headers: makeHeaders(token),
        body: JSON.stringify({ status: targetStatus, note: targetNote }),
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

  function closeCreateInitialPaymentDialog() {
    setCreateInitialPaymentOpen(false);
    setInitialPaymentPackageId("");
    setInitialPaymentBillingMonth(new Date().toISOString().slice(0, 7));
    setInitialPaymentNotes("");
  }

  const createInitialPaymentMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/api/admin/ballet/payments`, {
        method: "POST",
        headers: makeHeaders(token),
        body: JSON.stringify({
          applicationId: appId,
          packageId: Number(initialPaymentPackageId),
          levelAssignmentId: data?.assignmentId ?? undefined,
          paymentMethod: "inPerson",
          billingMonth: initialPaymentBillingMonth || undefined,
          notes: initialPaymentNotes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Failed to create initial payment");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Initial payment created", description: "A pending Pay at Studio payment is now ready to confirm after collection." });
      closeCreateInitialPaymentDialog();
      queryClient.invalidateQueries({ queryKey: ["ballet-application", appId] });
      queryClient.invalidateQueries({ queryKey: ["admin-ballet-payments"] });
      queryClient.invalidateQueries({ queryKey: ["ballet-students"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const confirmPaymentMutation = useMutation({
    mutationFn: async () => {
      if (!confirmingPayment) throw new Error("No pending payment selected.");
      const res = await fetch(`${API_BASE}/api/admin/ballet/payments/${confirmingPayment.id}/status`, {
        method: "PATCH",
        headers: makeHeaders(token),
        body: JSON.stringify({
          status: "paid",
          startDate: confirmStartDate,
          expiresAt: confirmExpiresAt,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Failed to confirm payment");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Payment confirmed", description: "Payment confirmed. This application is ready for activation." });
      setConfirmingPayment(null);
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
  const activePackages = (packagesData?.data ?? []).filter((pkg) => pkg.isActive);
  const selectedInitialPackage = activePackages.find((pkg) => String(pkg.id) === initialPaymentPackageId) ?? null;
  const initialPayments = payments.filter((payment) => !payment.isRenewal && payment.renewedFromId == null);
  const pendingInitialPayment = initialPayments.find((payment) => payment.status === "pending") ?? null;
  const paidInitialPayment = initialPayments.find((payment) => payment.status === "paid") ?? null;
  const hasBlockingInitialPayment = initialPayments.some((payment) => ["pending", "paid", "refunded"].includes(payment.status));
  const canCreateInitialPayment = Boolean(
    canCreatePayments
      && ["accepted", "assignedToLevel"].includes(app.status)
      && !hasBlockingInitialPayment,
  );
  const canConfirmInitialPayment = Boolean(canEditPayments && pendingInitialPayment);
  const appAcceptedOrAssigned = ["accepted", "assignedToLevel", "active"].includes(app.status);
  const levelAssigned = app.assignedLevelId != null;
  const groupAssigned = group != null;
  const initialPaymentRecorded = initialPayments.length > 0;
  const paymentConfirmed = paidInitialPayment != null;
  const paidInitialStartDate = parseSubscriptionDate(paidInitialPayment?.subscriptionStartDate);
  const paidInitialExpiryDate = parseSubscriptionDate(paidInitialPayment?.subscriptionExpiresAt);
  const hasValidPaidInitialSubscriptionDates = Boolean(
    paidInitialPayment
      && paidInitialStartDate
      && paidInitialExpiryDate
      && paidInitialExpiryDate.getTime() > paidInitialStartDate.getTime(),
  );
  const paidInitialPaymentRequiresReview = Boolean(paidInitialPayment && !hasValidPaidInitialSubscriptionDates);
  const paidInitialSubscriptionExpired = Boolean(
    paidInitialPayment
      && hasValidPaidInitialSubscriptionDates
      && paidInitialPayment.subscriptionStatus === "expired",
  );
  const paymentDataWarning = paidInitialPaymentRequiresReview
    ? "A paid initial payment exists, but it does not currently provide an active subscription period. Confirm Payment only supports pending payments; review the payment dates/status before activation."
    : null;
  const subscriptionExpiredWarning = paidInitialSubscriptionExpired
    ? "The initial payment is paid and has a valid subscription period, but that period has expired. Renewal remains in Ballet Payments."
    : null;
  const subscriptionReadinessState: "complete" | "pending" | "missing" | "expired" | "warning" =
    currentSubscription?.hasActiveSubscription ? "complete"
    : paidInitialPaymentRequiresReview ? "warning"
    : paidInitialSubscriptionExpired || currentSubscription?.subscriptionStatus === "expired" ? "expired"
    : paymentConfirmed ? "pending"
    : "missing";
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
  const reviewStatuses = permittedStatuses.filter((status) => status.value !== "active");
  const canActivateApplication = permittedStatuses.some((status) => status.value === "active");
  const applicationStatus = app.status as BalletApplicationStatus;
  const nextRequiredAction: NextRequiredAction =
    REVIEW_ACTION_STATUSES.has(applicationStatus) ? "Review Application"
    : TERMINAL_ACTION_STATUSES.has(applicationStatus) ? "Application closed"
    : app.status === "active" ? "No action required"
    : app.status === "accepted" && !levelAssigned ? "Assign Level"
    : app.status === "assignedToLevel" && !groupAssigned ? "Assign Group"
    : ["accepted", "assignedToLevel"].includes(app.status) && !initialPaymentRecorded ? "Create Initial Payment"
    : pendingInitialPayment ? "Confirm Payment"
    : paidInitialPaymentRequiresReview ? "Payment data requires review"
    : paidInitialSubscriptionExpired ? "Subscription expired — renewal required"
    : subscriptionReadinessState === "complete" && canActivateApplication ? "Activate Application"
    : "No action required";
  const openInitialPaymentDialog = () => {
    const preferredActive = activePackages.find((pkg) => pkg.id === app.preferredPackageId);
    setInitialPaymentPackageId(preferredActive ? String(preferredActive.id) : "");
    setCreateInitialPaymentOpen(true);
  };
  const openConfirmPaymentDialog = (payment: BalletPayment) => {
    const today = new Date().toISOString().slice(0, 10);
    setConfirmStartDate(today);
    setConfirmExpiresAt(addDays(today, 30));
    setConfirmingPayment(payment);
  };

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
        <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-semibold text-white">{app.childName}</span>
              <span className="text-sm text-muted-foreground">Application #{app.id}</span>
              <StatusBadge status={app.status} />
              {currentPayment && <PaymentStatusBadge status={currentPayment.status} />}
              {currentSubscription && <SubscriptionBadge payment={currentSubscription} />}
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

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <div className="overflow-x-auto pb-1">
          <TabsList className="inline-flex w-max min-w-full justify-start md:min-w-0" aria-label="Ballet application detail sections">
            {APPLICATION_DETAIL_TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>{tab.label}</TabsTrigger>
            ))}
          </TabsList>
        </div>

        <ApplicationDetailTabPanels
          app={app}
          level={level}
          group={group}
          currentPayment={currentPayment}
          currentSubscription={currentSubscription}
          appAcceptedOrAssigned={appAcceptedOrAssigned}
          levelAssigned={levelAssigned}
          groupAssigned={groupAssigned}
          initialPaymentRecorded={initialPaymentRecorded}
          pendingInitialPayment={pendingInitialPayment}
          paidInitialPayment={paidInitialPayment}
          initialPayments={initialPayments}
          subscriptionReadinessState={subscriptionReadinessState}
          paymentDataWarning={paymentDataWarning}
          subscriptionExpiredWarning={subscriptionExpiredWarning}
          nextRequiredAction={nextRequiredAction}
          setActiveTab={setActiveTab}
          canCreateInitialPayment={canCreateInitialPayment}
          openInitialPaymentDialog={openInitialPaymentDialog}
          canConfirmInitialPayment={canConfirmInitialPayment}
          openConfirmPaymentDialog={openConfirmPaymentDialog}
          canActivateApplication={canActivateApplication}
          statusMutation={statusMutation}
          statusNote={statusNote}
          assessmentSchedule={assessmentSchedule}
          reviewStatuses={reviewStatuses}
          newStatus={newStatus}
          setNewStatus={setNewStatus}
          setStatusNote={setStatusNote}
          payments={payments}
          canAdjustExpiry={canAdjustExpiry}
          canEditPayments={canEditPayments}
          setAdjustExpiryOpen={setAdjustExpiryOpen}
          canViewPayments={canViewPayments}
          navigate={navigate}
          appId={appId}
          data={data}
          activeSchedules={activeSchedules}
          canCheckIn={canCheckIn}
          attendanceSummary={attendanceSummary}
          attendanceHistoryData={attendanceHistoryData}
          editingAttendanceId={editingAttendanceId}
          setEditingAttendanceId={setEditingAttendanceId}
          editStatus={editStatus}
          setEditStatus={setEditStatus}
          editDuration={editDuration}
          setEditDuration={setEditDuration}
          editNote={editNote}
          setEditNote={setEditNote}
          patchAttendanceMutation={patchAttendanceMutation}
          startEditAttendance={startEditAttendance}
          attScheduleId={attScheduleId}
          setAttScheduleId={setAttScheduleId}
          attDate={attDate}
          setAttDate={setAttDate}
          attStatus={attStatus}
          setAttStatus={setAttStatus}
          attDuration={attDuration}
          setAttDuration={setAttDuration}
          attNote={attNote}
          setAttNote={setAttNote}
          attendanceMutation={attendanceMutation}
          canApprove={canApprove}
          levels={levels}
          newLevelId={newLevelId}
          setNewLevelId={setNewLevelId}
          levelNote={levelNote}
          setLevelNote={setLevelNote}
          levelMutation={levelMutation}
          groups={groups}
          newGroupId={newGroupId}
          setNewGroupId={setNewGroupId}
          groupNote={groupNote}
          setGroupNote={setGroupNote}
          groupMutation={groupMutation}
          canCancel={canCancel}
          dangerAction={dangerAction}
          openCancellationRequest={openCancellationRequest}
          setDangerDialog={setDangerDialog}
          setCancelTiming={setCancelTiming}
          cancellationRequests={cancellationRequests}
          refunds={refunds}
          events={events}
        />
      </Tabs>
      <Dialog open={createInitialPaymentOpen} onOpenChange={(open) => (open ? setCreateInitialPaymentOpen(true) : closeCreateInitialPaymentDialog())}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Create Initial Payment</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Creates the first pending Pay at Studio payment for this Ballet application. The amount is taken from the selected package on the server.
            </p>
            <div className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Package</div>
              <Select value={initialPaymentPackageId} onValueChange={setInitialPaymentPackageId}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select active package…" /></SelectTrigger>
                <SelectContent>
                  {activePackages.map((pkg) => (
                    <SelectItem key={pkg.id} value={String(pkg.id)}>
                      {pkg.name} · {pkg.priceEgp.toLocaleString()} EGP
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Method" value="Pay at Studio" />
              <Field label="Status" value="Pending" />
              <Field label="Amount" value={selectedInitialPackage ? `${selectedInitialPackage.priceEgp.toLocaleString()} EGP` : null} />
              <Field label="Cycle" value="Initial payment" />
            </div>
            <div className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Billing month</div>
              <Input type="month" value={initialPaymentBillingMonth} onChange={(event) => setInitialPaymentBillingMonth(event.target.value)} />
            </div>
            <div className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Internal note</div>
              <Textarea
                className="text-sm min-h-[64px] resize-none"
                value={initialPaymentNotes}
                onChange={(event) => setInitialPaymentNotes(event.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={closeCreateInitialPaymentDialog} disabled={createInitialPaymentMutation.isPending}>Cancel</Button>
              <Button size="sm" onClick={() => createInitialPaymentMutation.mutate()} disabled={!initialPaymentPackageId || createInitialPaymentMutation.isPending}>
                {createInitialPaymentMutation.isPending ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Creating…</> : "Create Pending Payment"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(confirmingPayment)} onOpenChange={(open) => { if (!open) setConfirmingPayment(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Confirm Payment</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Confirm only after the customer has paid at the studio. This starts the subscription period; activation remains a separate explicit action.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Start date</div>
                <Input type="date" className="h-8 text-sm" value={confirmStartDate} onChange={(event) => {
                  setConfirmStartDate(event.target.value);
                  setConfirmExpiresAt(addDays(event.target.value, 30));
                }} />
              </div>
              <div className="space-y-1">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Expiry date</div>
                <Input type="date" className="h-8 text-sm" value={confirmExpiresAt} onChange={(event) => setConfirmExpiresAt(event.target.value)} />
              </div>
            </div>
            <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
              Payment #{confirmingPayment?.id} · Pay at Studio · {confirmingPayment?.amountEgp.toLocaleString()} EGP
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setConfirmingPayment(null)} disabled={confirmPaymentMutation.isPending}>Cancel</Button>
              <Button size="sm" onClick={() => confirmPaymentMutation.mutate()} disabled={!confirmStartDate || !confirmExpiresAt || confirmPaymentMutation.isPending}>
                {confirmPaymentMutation.isPending ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Confirming…</> : "Confirm Paid"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
