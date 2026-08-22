/**
 * Ballet Application Detail — /ballet/applications/:id
 *
 * Shows:
 *  - Full application data split into readable sections
 *  - Vertical event timeline (newest first)
 *  - Status change panel (select + optional note + save)
 *  - Level assignment panel (select active level + optional note + assign)
 */

import { useEffect, useState } from "react";
import { useParams, useLocation, useSearch } from "wouter";
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
import { Loader2, ChevronLeft, Download, ArrowRight } from "lucide-react";
import { fetchAllPages } from "@/lib/fetchAllPages";
import { useToast } from "@/hooks/use-toast";
import {
  isTransitionAllowed,
  resolveBalletDangerAction,
  BALLET_TERMINAL_APPLICATION_STATUSES,
  type BalletApplicationStatus,
} from "@workspace/api-zod";
import {
  ApplicationDetailTabPanels,
  Field,
  PaymentStatusBadge,
  StatusBadge,
  SubscriptionBadge,
} from "./application-detail";
import {
  APPLICATION_DETAIL_TABS,
  buildApplicationDetailTabUrl,
  parseApplicationTab,
} from "./application-detail/tabState";

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
  classCount: number;
  assignmentReadyClassCount: number;
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
  amountEgp: number | null;
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
  alreadyRefundedEgp: number | null;
  remainingRefundableEgp: number | null;
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
  assessmentFee?: {
    amountEgp: number | null;
    status: "unpaid" | "paid" | "waived";
    paidAt: string | null;
    paymentMethod: string | null;
    recordedById: number | null;
  } | null;
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
const restrictedAmount = (value: number | null) => value == null ? "Restricted" : `${value} EGP`;
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
// Derived from the canonical constant (not a hand-typed duplicate list) so
// this can never drift from the shared source of truth used by the backend
// and by resolveBalletDangerAction.
const TERMINAL_ACTION_STATUSES = new Set<BalletApplicationStatus>(BALLET_TERMINAL_APPLICATION_STATUSES);

// ─── API helpers ──────────────────────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_API_URL as string | undefined ?? "";

function makeHeaders(token: string | null): HeadersInit {
  return {
    "Content-Type": "application/json",
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
  const search = useSearch();
  const { token, can } = useAdminAuth();
  const canReview = can("ballet.applications", "review");
  const canApprove = can("ballet.applications", "approve");
  const canReject = can("ballet.applications", "reject");
  const canCancel = can("ballet.applications", "cancel");
  // Gates the "Open Payment History"/"Open Full Payment History" deep links to
  // /ballet/payments below (OverviewTab, PaymentsSubscriptionTab) — that page
  // is itself gated by finance.view (nav-config.ts, App.tsx ROUTE_PERMS), so
  // this must match it, not the unrelated ballet.payments.view permission.
  // The payment records/fields shown directly on this page are unconditional;
  // their amount fields are independently redacted server-side based on
  // finance.view (adminBallet.ts's canViewFinanceAmounts/redactFinancialFields)
  // regardless of this flag, so no raw amount is exposed by this change.
  const canViewPayments = can("finance", "view");
  // ballet.payments.create/edit remain unchanged — those mutation actions
  // (Create Initial Payment, Confirm Payment, Adjust Expiry) are genuinely
  // enforced by the backend under ballet.payments.create/edit, not finance.*.
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
  // Overview-triggered dialogs for the same Assign Level / Assign Group
  // action Enrollment already has inline — same state, same mutation, just a
  // second entry point so Overview never has to send the admin to another
  // tab for these two actions.
  const [assignLevelDialogOpen, setAssignLevelDialogOpen] = useState(false);
  const [assignGroupDialogOpen, setAssignGroupDialogOpen] = useState(false);
  // Same principle for the application review/status decision (Accept /
  // Needs Follow-up / Reject) already on the Application tab.
  const [statusDecisionDialogOpen, setStatusDecisionDialogOpen] = useState(false);
  const [attScheduleId, setAttScheduleId] = useState("");
  const [attDate, setAttDate]             = useState("");
  const [attStatus, setAttStatus]         = useState("checked_in");
  const [attNote, setAttNote]             = useState("");
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const [recordFeeOpen, setRecordFeeOpen] = useState(false);
  const [feeStatusSelect, setFeeStatusSelect] = useState<"paid" | "waived" | "unpaid">("paid");
  const [feePaymentMethod, setFeePaymentMethod] = useState<"cash" | "card" | "kashier" | "bank_transfer" | "">("");
  const [feeAmountInput, setFeeAmountInput] = useState("");

  const recordFeeMutation = useMutation({
    mutationFn: async (vars: { status: "paid" | "waived" | "unpaid"; paymentMethod?: "cash" | "card" | "kashier" | "bank_transfer"; amountEgp?: number }) => {
      const res = await fetch(`${API_BASE}/api/admin/ballet/applications/${appId}/record-assessment-fee`, {
        method: "POST",
        headers: makeHeaders(token),
        body: JSON.stringify(vars),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Failed to record assessment fee");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Assessment fee status updated" });
      setRecordFeeOpen(false);
      queryClient.invalidateQueries({ queryKey: ["ballet-application", appId] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

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
  const [confirmingPaymentAmount, setConfirmingPaymentAmount] = useState<number | null>(null);
  const [confirmingPaymentAmountLoading, setConfirmingPaymentAmountLoading] = useState(false);
  const [confirmStartDate, setConfirmStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [confirmExpiresAt, setConfirmExpiresAt] = useState(() => addDays(new Date().toISOString().slice(0, 10), 30));

  // D1: inline correction state for an existing attendance history row.
  const [editingAttendanceId, setEditingAttendanceId] = useState<number | null>(null);
  const [editStatus, setEditStatus]     = useState("checked_in");
  const [editNote, setEditNote]         = useState("");

  const appId = parseInt(id ?? "", 10);
  const activeTab = parseApplicationTab(search);
  const setActiveTab = (tab: string) => {
    navigate(buildApplicationDetailTabUrl({
      pathname: location,
      search,
      hash: window.location.hash,
      tab,
    }));
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

  useEffect(() => {
    const status = data?.assessmentFee?.status;
    if (status === "paid" || status === "waived" || status === "unpaid") {
      setFeeStatusSelect(status);
    }
    const method = data?.assessmentFee?.paymentMethod;
    setFeePaymentMethod(method === "cash" || method === "card" || method === "kashier" || method === "bank_transfer" ? method : "");
    const amount = data?.assessmentFee?.amountEgp;
    setFeeAmountInput(amount != null && amount > 0 ? String(amount) : "");
  }, [data?.assessmentFee?.status, data?.assessmentFee?.amountEgp, data?.assessmentFee?.paymentMethod]);

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

  // Group-assignment reference data — must reflect every group, not just the
  // first page, or a group beyond page 1 would be invisible to assign here.
  const { data: groupsData } = useQuery<GroupsResponse>({
    queryKey: ["ballet-groups"],
    queryFn: async () => ({
      data: await fetchAllPages<Group>(async (page) => {
        const res = await fetch(`${API_BASE}/api/admin/ballet/groups?page=${page}&limit=100`, {
          headers: makeHeaders(token),
        });
        if (!res.ok) throw new Error("Failed to load groups");
        return res.json();
      }),
    }),
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
      setStatusDecisionDialogOpen(false);
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
      setAssignLevelDialogOpen(false);
      // Changing Level supersedes the assignment's group (adminBallet.ts
      // clears it server-side too) — the picker must not keep offering a
      // stale Group selection from the previous Level.
      setNewGroupId("");
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
      setAssignGroupDialogOpen(false);
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
    mutationFn: async (vars: { id: number; status: string; note: string }) => {
      const res = await fetch(`${API_BASE}/api/admin/ballet/attendance/${vars.id}`, {
        method: "PATCH",
        headers: makeHeaders(token),
        body: JSON.stringify({
          status: vars.status,
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

  const app = data.application;
  const assessmentSchedule = data.assessmentSchedule;
  const level = data.level;
  const group = data.group;
  const events = data.events ?? [];
  const groupSchedules = data.groupSchedules ?? [];
  const attendanceSummary = data.attendanceSummary;
  const currentPayment = data.currentPayment;
  const payments = data.payments ?? [];
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
  // Computed once here (not per-tab) and threaded through every progression
  // gate below + passed to all tabs — the single source of truth for
  // "is this application closed", derived from the canonical terminal-status
  // set (BALLET_TERMINAL_APPLICATION_STATUSES), never a second literal list.
  const applicationStatus = app.status as BalletApplicationStatus;
  const isApplicationTerminal = TERMINAL_ACTION_STATUSES.has(applicationStatus);
  const canAdjustExpiry = Boolean(!isApplicationTerminal && canEditPayments && currentSubscription?.status === "paid" && currentSubscription.hasActiveSubscription && currentSubscription.subscriptionExpiresAt);
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
    !isApplicationTerminal
      && canCreatePayments
      && ["accepted", "assignedToLevel"].includes(app.status)
      && !hasBlockingInitialPayment,
  );
  const canConfirmInitialPayment = Boolean(!isApplicationTerminal && canEditPayments && pendingInitialPayment);
  const appAcceptedOrAssigned = ["accepted", "assignedToLevel", "active"].includes(app.status);
  const levelAssigned = app.assignedLevelId != null;
  const groupAssigned = group != null;
  // Mirrors the backend allowlists exactly (assign-level:
  // accepted/assignedToLevel; assign-group: assignedToLevel/active + an
  // existing level) so Overview/Enrollment never render a button the
  // endpoint would reject with 422.
  const canAssignLevel = Boolean(canApprove && !isApplicationTerminal && ["accepted", "assignedToLevel"].includes(app.status));
  const canAssignGroup = Boolean(canApprove && !isApplicationTerminal && levelAssigned && ["assignedToLevel", "active"].includes(app.status));
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
  const levels = (levelsData?.levels ?? []).filter((item) => item.isActive);
  // Groups are only offered for the level actually assigned to this
  // application — mirrors the existing level-filter pattern used elsewhere
  // in this admin app (client-side filter, no backend query param). Also
  // require active + assignment-ready (at least one Class satisfying the
  // shared entitlement invariant) so the picker never offers a Group the
  // assign-group endpoint would reject.
  const groups = (groupsData?.data ?? []).filter((g) =>
    g.isActive && g.levelId === app.assignedLevelId && g.assignmentReadyClassCount > 0
  );
  const permittedStatuses = ALL_STATUSES.filter((status) => {
    if (status.value === "rejected") return canReject;
    if (["accepted", "assignedToLevel", "active"].includes(status.value)) return canApprove;
    return canReview;
  }).filter((status) =>
    isTransitionAllowed(app.status as BalletApplicationStatus, status.value as BalletApplicationStatus)
  );
  const reviewStatuses = permittedStatuses.filter((status) => status.value !== "active");
  const canActivateApplication = permittedStatuses.some((status) => status.value === "active");
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
    setConfirmingPaymentAmount(null);
    setConfirmingPaymentAmountLoading(true);
    void fetch(`${API_BASE}/api/admin/ballet/payments/${payment.id}/payment-confirmation-amount`, {
      headers: makeHeaders(token),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load the authorized payment amount.");
        return response.json() as Promise<{ amountEgp: number | null }>;
      })
      .then((body) => setConfirmingPaymentAmount(body.amountEgp))
      .catch((error: unknown) => toast({
        title: "Payment amount unavailable",
        description: error instanceof Error ? error.message : "Could not load the authorized payment amount.",
        variant: "destructive",
      }))
      .finally(() => setConfirmingPaymentAmountLoading(false));
  };
  const openStatusDecisionDialog = () => {
    setNewStatus("");
    setStatusNote("");
    setStatusDecisionDialogOpen(true);
  };
  const closeStatusDecisionDialog = () => {
    setStatusDecisionDialogOpen(false);
    setNewStatus("");
    setStatusNote("");
  };
  const openAssignLevelDialog = () => {
    setNewLevelId(app.assignedLevelId != null ? String(app.assignedLevelId) : "");
    setLevelNote("");
    setAssignLevelDialogOpen(true);
  };
  const closeAssignLevelDialog = () => {
    setAssignLevelDialogOpen(false);
    setNewLevelId("");
    setLevelNote("");
  };
  const openAssignGroupDialog = () => {
    setNewGroupId(group?.id != null ? String(group.id) : "");
    setGroupNote("");
    setAssignGroupDialogOpen(true);
  };
  const closeAssignGroupDialog = () => {
    setAssignGroupDialogOpen(false);
    setNewGroupId("");
    setGroupNote("");
  };

  return (
    <div className="admin2-ballet-page admin2-ballet-detail space-y-6">
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
          isApplicationTerminal={isApplicationTerminal}
          applicationStatus={applicationStatus}
          canAssignLevel={canAssignLevel}
          canAssignGroup={canAssignGroup}
          openAssignLevelDialog={openAssignLevelDialog}
          openAssignGroupDialog={openAssignGroupDialog}
          openStatusDecisionDialog={openStatusDecisionDialog}
          assessmentFee={data?.assessmentFee}
          openRecordAssessmentFeeDialog={() => setRecordFeeOpen(true)}
        />
      </Tabs>
      <Dialog open={recordFeeOpen} onOpenChange={setRecordFeeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record Assessment Fee Payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Update the intake assessment fee status. Paid fees require an evidenced amount and actual payment method, and remain separate from package/subscription payments.
            </p>
            {data?.assessmentFee?.amountEgp != null && (
              <div className="rounded-lg border border-border p-3 bg-muted/40 text-sm">
                <strong>Configured Assessment Fee:</strong> {data.assessmentFee.amountEgp} EGP
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Select Status</label>
              <Select
                value={feeStatusSelect}
                onValueChange={(val: "paid" | "waived" | "unpaid") => setFeeStatusSelect(val)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="paid">Mark as Paid</SelectItem>
                  <SelectItem value="waived">Mark as Waived</SelectItem>
                  <SelectItem value="unpaid">Mark as Unpaid</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {feeStatusSelect === "paid" && (
              <>
                {(data?.assessmentFee?.amountEgp == null || data.assessmentFee.amountEgp <= 0) && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Evidenced Paid Amount (EGP)</label>
                    <Input type="number" min={1} step={1} value={feeAmountInput} onChange={(event) => setFeeAmountInput(event.target.value)} />
                    <p className="text-xs text-muted-foreground">Required because this application has no positive historical fee snapshot.</p>
                  </div>
                )}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Payment Method</label>
                  <Select value={feePaymentMethod} onValueChange={(value: "cash" | "card" | "kashier" | "bank_transfer") => setFeePaymentMethod(value)}>
                    <SelectTrigger><SelectValue placeholder="Select actual method" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="card">Card</SelectItem>
                      <SelectItem value="kashier">Kashier</SelectItem>
                      <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
            {feeStatusSelect === "waived" && <p className="text-sm text-muted-foreground">Waived records are non-cash and are not counted as revenue.</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setRecordFeeOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={recordFeeMutation.isPending || (feeStatusSelect === "paid" && (!feePaymentMethod || !Number.isInteger(Number(feeAmountInput)) || Number(feeAmountInput) <= 0))}
                onClick={() => recordFeeMutation.mutate(feeStatusSelect === "paid"
                  ? { status: "paid", paymentMethod: feePaymentMethod || undefined, ...(data?.assessmentFee?.amountEgp == null || data.assessmentFee.amountEgp <= 0 ? { amountEgp: Number(feeAmountInput) } : {}) }
                  : { status: feeStatusSelect })}
              >
                {recordFeeMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save Fee Status
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={statusDecisionDialogOpen} onOpenChange={(open) => (open ? openStatusDecisionDialog() : closeStatusDecisionDialog())}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Application Decision</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <StatusBadge status={app.status} />
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">new status</span>
            </div>
            <div className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Decision</div>
              <Select value={newStatus} onValueChange={setNewStatus}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select review status…" /></SelectTrigger>
                <SelectContent>
                  {reviewStatuses.filter((s: any) => s.value !== app.status).map((s: any) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Internal note</div>
              <Textarea
                className="text-sm min-h-[64px] resize-none"
                value={statusNote}
                onChange={(event) => setStatusNote(event.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={closeStatusDecisionDialog} disabled={statusMutation.isPending}>Cancel</Button>
              <Button size="sm" onClick={() => statusMutation.mutate(undefined)} disabled={!newStatus || statusMutation.isPending}>
                {statusMutation.isPending ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Saving…</> : "Save Decision"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={assignLevelDialogOpen} onOpenChange={(open) => (open ? openAssignLevelDialog() : closeAssignLevelDialog())}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{levelAssigned ? "Change Level" : "Assign Level"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {levelAssigned && (
              <p className="text-sm text-muted-foreground">
                Currently assigned to <span className="text-foreground font-medium">{level?.name ?? `#${app.assignedLevelId}`}</span>. Changing the level clears the current group assignment.
              </p>
            )}
            <div className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Level</div>
              <Select value={newLevelId} onValueChange={setNewLevelId}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select level…" /></SelectTrigger>
                <SelectContent>
                  {levels.map((l: any) => (
                    <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Internal note</div>
              <Textarea
                className="text-sm min-h-[64px] resize-none"
                value={levelNote}
                onChange={(event) => setLevelNote(event.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={closeAssignLevelDialog} disabled={levelMutation.isPending}>Cancel</Button>
              <Button size="sm" onClick={() => levelMutation.mutate()} disabled={!newLevelId || levelMutation.isPending}>
                {levelMutation.isPending ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Assigning…</> : levelAssigned ? "Change Level" : "Assign Level"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={assignGroupDialogOpen} onOpenChange={(open) => (open ? openAssignGroupDialog() : closeAssignGroupDialog())}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{groupAssigned ? "Change Group" : "Assign Group"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {groupAssigned && (
              <p className="text-sm text-muted-foreground">
                Currently assigned to <span className="text-foreground font-medium">{group?.name}</span>.
              </p>
            )}
            {groups.length === 0 ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
                No active group in this level currently has a valid Ballet Class. Create the Class and weekly Schedule before assigning a group.
              </div>
            ) : (
              <div className="space-y-1">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Group</div>
                <Select value={newGroupId} onValueChange={setNewGroupId}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select group…" /></SelectTrigger>
                  <SelectContent>
                    {groups.map((g: any) => (
                      <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Internal note</div>
              <Textarea
                className="text-sm min-h-[64px] resize-none"
                value={groupNote}
                onChange={(event) => setGroupNote(event.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={closeAssignGroupDialog} disabled={groupMutation.isPending}>Cancel</Button>
              <Button size="sm" onClick={() => groupMutation.mutate()} disabled={!newGroupId || groupMutation.isPending || groups.length === 0}>
                {groupMutation.isPending ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Assigning…</> : groupAssigned ? "Change Group" : "Assign Group"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
              Payment #{confirmingPayment?.id} · Pay at Studio ·{" "}
              {confirmingPaymentAmountLoading
                ? "Loading…"
                : confirmingPaymentAmount == null
                  ? "Amount unavailable"
                  : `${confirmingPaymentAmount.toLocaleString()} EGP`}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setConfirmingPayment(null)} disabled={confirmPaymentMutation.isPending}>Cancel</Button>
              <Button size="sm" onClick={() => confirmPaymentMutation.mutate()} disabled={!confirmStartDate || !confirmExpiresAt || confirmingPaymentAmountLoading || confirmingPaymentAmount == null || confirmPaymentMutation.isPending}>
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
                  <div>Original amount: {restrictedAmount(eligibleRefund.originalAmountEgp)}</div>
                  <div>Already refunded: {restrictedAmount(eligibleRefund.alreadyRefundedEgp)}</div>
                  <div>Remaining refundable: {restrictedAmount(eligibleRefund.remainingRefundableEgp)}</div>
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
                  <div>Original amount: {restrictedAmount(eligibleRefund.originalAmountEgp)}</div>
                  <div>Already refunded: {restrictedAmount(eligibleRefund.alreadyRefundedEgp)}</div>
                  <div>Remaining refundable: {restrictedAmount(eligibleRefund.remainingRefundableEgp)}</div>
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
import "./admin2-ballet.css";
