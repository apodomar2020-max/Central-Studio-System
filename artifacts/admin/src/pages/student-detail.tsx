import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  Download,
  Loader2,
  Mail,
  Package,
  Phone,
  QrCode,
  RefreshCw,
  ShieldOff,
  Star,
  UserCog,
  UserPlus,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import {
  useDeactivateStudent,
  useReactivateStudent,
  useGetStudentDeletionImpact,
  useStartStudentDeletionPreparation,
  useCancelStudentDeletionPreparation,
  getListStudentsQueryKey,
  getGetStudentDeletionImpactQueryKey,
} from "@workspace/api-client-react";
import type { StudentDeletionImpactResponse } from "@workspace/api-client-react";
import "./admin2-operations.css";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

function makeHeaders(token?: string | null): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(token ? { "x-admin-token": token } : {}),
  };
}

// ---------------------------------------------------------------------------
// Response shape — mirrors GET /api/students/:id/overview exactly.
// ---------------------------------------------------------------------------
interface OverviewUser {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  avatarUrl: string | null;
  accountType: string | null;
  authProvider: string | null;
  providerDisplayName: string | null;
  emailVerified: boolean;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  joinedAt: string;
  createdAt: string;
  qrToken: string;
  notes: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  city: string | null;
  nationality: string | null;
  howDidYouHearAboutUs: string | null;
  policiesAcceptedAt: string | null;
  /** Account Lifecycle (Phase B1D) — Active/Deactivated/Deleted. */
  accountStatus: "active" | "deactivated" | "deleted";
  deactivatedAt: string | null;
}
/** Mirrors the backend's Profile Completion Engine (lib/profileCompletion.ts). */
interface OverviewCompletion {
  emailVerified: boolean;
  profileCompletedAt: string | null;
  lastCompletionStep: string | null;
  percent: number;
  isComplete: boolean;
  nextStep: string;
  missing: string[];
  completed: string[];
  verificationBadge: boolean;
}
interface OverviewDanceInterest {
  id: number;
  name: string;
  slug: string;
}
interface OverviewStats {
  totalBookings: number;
  totalAttendance: number;
  attendanceRate: number | null;
  activePackage: { id: number; packageName: string; remainingCredits: number; totalCredits: number; expiresAt: string | null } | null;
  remainingCredits: number | null;
  packageExpiry: string | null;
  feedbackAverage: number | null;
  feedbackCount: number;
  lastActivity: string | null;
}
interface OverviewChild {
  id: number;
  fullName: string;
  dateOfBirth: string | null;
  birthday: string | null;
  age: number | null;
  gender: string;
  medicalNotes: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
}
interface OverviewPackage {
  id: number;
  packageName: string;
  status: string;
  totalCredits: number;
  remainingCredits: number;
  activatedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}
interface OverviewBooking {
  id: number;
  bookingNumber: string;
  classTitle: string | null;
  participantType: "self" | "child";
  participantName: string;
  occurrenceDate: string | null;
  scheduleStartTime: string | null;
  scheduleEndTime: string | null;
  bookingStatus: string;
  paymentStatus: string;
  paymentMode: string | null;
  createdAt: string;
}
interface OverviewAttendance {
  id: number;
  classTitle: string | null;
  instructorName: string | null;
  status: string;
  creditDeducted: boolean;
  checkedInAt: string;
}
interface OverviewFeedback {
  id: number;
  classTitle: string | null;
  instructorName: string | null;
  rating: number;
  commentPreview: string | null;
  hasComment: boolean;
  reviewStatus: string;
  submittedAt: string | null;
}
interface OverviewCreditTx {
  id: number;
  packageOrderId: number;
  type: string;
  delta: number;
  balanceBefore: number;
  balanceAfter: number;
  notes: string | null;
  createdBy: string;
  createdAt: string;
}
interface OverviewTimelineItem {
  icon: string;
  title: string;
  description: string;
  timestamp: string;
  sourceType: string;
}
interface OverviewPermissions {
  canViewChildren: boolean;
  canViewBookings: boolean;
  canViewAttendance: boolean;
  canViewPackages: boolean;
  canViewCredits: boolean;
  canViewFeedback: boolean;
  canViewFeedbackComments: boolean;
  canViewProfileCompletion: boolean;
}
type MembershipStatus = "Active" | "Inactive" | "Needs Profile" | "No Active Package" | "New" | "At Risk";

interface StudentOverview {
  user: OverviewUser;
  completion: OverviewCompletion | null;
  membershipStatus: MembershipStatus;
  stats: OverviewStats;
  children: OverviewChild[];
  packages: { active: OverviewStats["activePackage"]; recent: OverviewPackage[] };
  bookings: OverviewBooking[];
  attendance: OverviewAttendance[];
  feedback: OverviewFeedback[];
  creditTransactions: OverviewCreditTx[];
  danceInterests: OverviewDanceInterest[];
  timeline: OverviewTimelineItem[];
  permissions: OverviewPermissions;
}

const TIMELINE_ICONS: Record<string, React.ElementType> = {
  account: UserPlus,
  email: Mail,
  profile: UserCog,
  booking: CalendarCheck,
  attendance: CheckCircle2,
  credit: CreditCard,
  feedback: Star,
  package: Package,
};

const NOT_COLLECTED = "Not collected yet";

function formatDate(value?: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}
function formatDateTime(value?: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}
function formatPercent(value: number | null): string {
  if (value == null) return "—";
  return `${Math.round(value * 100)}%`;
}
function providerLabel(provider: string | null): string {
  if (!provider) return "Manual";
  return { local: "Manual", google: "Google", apple: "Apple", facebook: "Facebook" }[provider] ?? provider;
}

const MEMBERSHIP_STATUS_STYLE: Record<MembershipStatus, string> = {
  Active: "border-transparent bg-emerald-500/15 text-emerald-400",
  New: "border-transparent bg-cyan-500/15 text-cyan-400",
  "No Active Package": "border-transparent bg-amber-500/15 text-amber-400",
  "Needs Profile": "border-transparent bg-amber-500/15 text-amber-400",
  "At Risk": "border-transparent bg-red-500/15 text-red-400",
  Inactive: "text-muted-foreground",
};

const ACCOUNT_STATUS_LABEL: Record<OverviewUser["accountStatus"], string> = {
  active: "Active",
  deactivated: "Deactivated",
  deleted: "Deleted / unavailable",
};
const ACCOUNT_STATUS_STYLE: Record<OverviewUser["accountStatus"], string> = {
  active: "border-transparent bg-emerald-500/15 text-emerald-400",
  deactivated: "border-transparent bg-amber-500/15 text-amber-400",
  deleted: "border-transparent bg-red-500/15 text-red-400",
};

function AccountStatusBadge({ status }: { status: OverviewUser["accountStatus"] }) {
  return (
    <Badge variant="outline" className={ACCOUNT_STATUS_STYLE[status]}>
      {ACCOUNT_STATUS_LABEL[status]}
    </Badge>
  );
}

function DetailRow({ label, value, notCollected }: { label: string; value: React.ReactNode; notCollected?: boolean }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-sm ${notCollected ? "italic text-muted-foreground" : "text-white"}`}>
        {notCollected ? NOT_COLLECTED : value || "—"}
      </div>
    </div>
  );
}

function KpiCard({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1 text-xl font-bold text-white">{value}</div>
        {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function NoPermission({ what }: { what: string }) {
  return <div className="py-8 text-center text-sm text-muted-foreground">You don't have permission to view {what}.</div>;
}
function EmptyState({ text }: { text: string }) {
  return <div className="py-8 text-center text-sm text-muted-foreground">{text}</div>;
}

// ---------------------------------------------------------------------------
// Permanent Account Deletion — Impact Review (Phase B2C)
//
// Pure read-only consumption of the already-live B2B contract
// (GET /api/students/:id/deletion-impact). This component performs ZERO
// writes: no mutation is ever called from here, and no field from the
// response (blockers, canDelete, categories, ...) is ever submitted back to
// the server. Classification into the four display groups below is a pure
// passthrough of the backend's `categories[].classification` — never
// reinterpreted client-side.
// ---------------------------------------------------------------------------

const IMPACT_GROUPS: {
  key: StudentDeletionImpactResponse["categories"][number]["classification"];
  title: string;
}[] = [
  { key: "blocker", title: "Must Resolve First" },
  { key: "anonymize", title: "Will Be Anonymized" },
  { key: "retain", title: "Will Be Retained" },
  { key: "delete", title: "Will Be Deleted" },
];

function impactErrorStatus(error: unknown): number | null {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === "number" ? status : null;
  }
  return null;
}

function ImpactErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const status = impactErrorStatus(error);
  let message: string;
  if (status === 401) {
    message = "Your admin session has expired. Please log in again.";
  } else if (status === 403) {
    message = "You don't have permission to review deletion impact for this account.";
  } else if (status === 404) {
    message = "This student no longer exists.";
  } else if (status === 409) {
    message = "This account is already permanently deleted, or is no longer eligible for impact review.";
  } else {
    message = "Could not load the deletion impact review. Please try again.";
  }
  return (
    <div role="alert" className="space-y-3 rounded-lg border border-red-500/40 bg-red-500/5 p-4">
      <p className="text-sm text-red-400">{message}</p>
      {status !== 403 && status !== 404 && status !== 409 && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

function ImpactSummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b py-1.5 text-sm last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-white">{value}</span>
    </div>
  );
}

function ImpactSummaryCard({ title, rows }: { title: string; rows: { label: string; value: number }[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {rows.map((r) => (
          <ImpactSummaryRow key={r.label} label={r.label} value={r.value} />
        ))}
      </CardContent>
    </Card>
  );
}

function DeletionImpactDialog({
  open,
  onOpenChange,
  query,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: ReturnType<typeof useGetStudentDeletionImpact<StudentDeletionImpactResponse>>;
}) {
  const data = query.data;
  const hasError = query.isError;
  const summary = data?.summary;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle>Permanent Deletion Impact</DialogTitle>
          <DialogDescription>
            Review what must be resolved, what will be anonymized, what will remain for historical or financial
            integrity, and what account data will eventually be removed.
          </DialogDescription>
        </DialogHeader>

        {query.isLoading || (query.isFetching && !data && !hasError) ? (
          <div role="status" aria-live="polite" className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading deletion impact…
          </div>
        ) : hasError || !data ? (
          <div role="status" aria-live="polite">
            <ImpactErrorState error={query.error} onRetry={() => void query.refetch()} />
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>Generated: {formatDateTime(data.generatedAt)}</span>
              <span>Policy version: {data.policyVersion}</span>
              <Button
                variant="outline"
                size="sm"
                aria-label="Refresh Impact"
                disabled={query.isFetching}
                onClick={() => void query.refetch()}
              >
                {query.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Refresh Impact
              </Button>
            </div>

            {data.deletionPreparation.active && (
              <p className="text-xs font-medium text-amber-400">
                Deletion preparation is currently active
                {data.deletionPreparation.startedAt ? ` (started ${formatDateTime(data.deletionPreparation.startedAt)})` : ""}.
              </p>
            )}

            {data.blockers.length > 0 && (
              <section aria-labelledby="impact-blockers-heading" className="rounded-lg border border-red-500/40 bg-red-500/5 p-4 space-y-3">
                <h3 id="impact-blockers-heading" className="text-sm font-semibold text-red-400">
                  Permanent deletion cannot proceed yet.
                </h3>
                <ul className="space-y-2">
                  {data.blockers.map((b) => (
                    <li key={b.key} className="text-sm">
                      <div className="font-medium text-white">
                        {b.label}
                        {typeof b.count === "number" ? ` (${b.count})` : ""}
                      </div>
                      <div className="text-xs text-muted-foreground">{b.description}</div>
                    </li>
                  ))}
                </ul>
                {data.blockers.some((b) => b.key === "ACCOUNT_MUST_BE_DEACTIVATED") && (
                  <p className="text-xs text-muted-foreground">
                    The account must be deactivated before permanent deletion can eventually be performed.
                  </p>
                )}
              </section>
            )}

            <section aria-labelledby="impact-eligibility-heading" className="rounded-lg border p-4 space-y-1">
              <h3 id="impact-eligibility-heading" className="text-sm font-semibold text-white">
                Eligibility
              </h3>
              <p className="text-sm text-muted-foreground">
                {data.canDelete ? "No current blockers detected." : "Not eligible for permanent deletion."}
              </p>
              <p className="text-xs text-muted-foreground">Permanent deletion execution is not enabled yet.</p>
              <p className="text-xs text-muted-foreground">
                This analysis reflects the current account state and will be revalidated before any future
                permanent deletion.
              </p>
            </section>

            {(summary && (summary.legacyAttribution.emailOnlyRows > 0 || summary.legacyAttribution.ambiguousRows > 0)) && (
              <section aria-labelledby="impact-legacy-heading" className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 space-y-2">
                <h3 id="impact-legacy-heading" className="text-sm font-semibold text-amber-400">
                  Legacy attribution
                </h3>
                {summary.legacyAttribution.emailOnlyRows > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Some historical records are still linked through legacy identity data and must be safely
                    attached to the internal Student record before anonymization.
                  </p>
                )}
                {summary.legacyAttribution.ambiguousRows > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Some historical records cannot yet be attributed safely.
                  </p>
                )}
              </section>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              {IMPACT_GROUPS.map((group) => {
                const items = data.categories.filter((c) => c.classification === group.key);
                return (
                  <section key={group.key} aria-labelledby={`impact-group-${group.key}`} className="rounded-lg border p-4">
                    <h3 id={`impact-group-${group.key}`} className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {group.title}
                    </h3>
                    {items.length === 0 ? (
                      <p className="text-xs text-muted-foreground">None.</p>
                    ) : (
                      <ul className="space-y-1">
                        {items.map((c) => (
                          <li key={c.key} className="text-sm text-white">{c.label}</li>
                        ))}
                      </ul>
                    )}
                    {group.key === "retain" && items.length > 0 && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Financial and historical records may be retained to preserve accounting, reconciliation,
                        and audit integrity.
                      </p>
                    )}
                  </section>
                );
              })}
            </div>

            {summary && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <ImpactSummaryCard
                  title="Bookings"
                  rows={[
                    { label: "Historical", value: summary.bookings.historical },
                    { label: "Future", value: summary.bookings.future },
                  ]}
                />
                <ImpactSummaryCard
                  title="Payments"
                  rows={[
                    { label: "Completed", value: summary.payments.completed },
                    { label: "Pending", value: summary.payments.pending },
                    { label: "Open refunds", value: summary.payments.openRefunds },
                  ]}
                />
                <ImpactSummaryCard
                  title="Packages"
                  rows={[
                    { label: "Active", value: summary.packages.active },
                    { label: "Expired", value: summary.packages.expired },
                    { label: "Unused credits", value: summary.packages.unusedCredits },
                    { label: "Pending orders", value: summary.packages.pendingOrders },
                  ]}
                />
                <ImpactSummaryCard
                  title="Children"
                  rows={[
                    { label: "Total", value: summary.children.total },
                    { label: "With future activity", value: summary.children.withFutureActivity },
                  ]}
                />
                <ImpactSummaryCard
                  title="Ballet"
                  rows={[
                    { label: "Open applications", value: summary.ballet.applicationsOpen },
                    { label: "Terminal applications", value: summary.ballet.applicationsTerminal },
                    { label: "Active enrollments", value: summary.ballet.enrollmentsActive },
                    { label: "Pending payments", value: summary.ballet.paymentsPending },
                    { label: "Open refunds", value: summary.ballet.refundsOpen },
                  ]}
                />
                <ImpactSummaryCard
                  title="Security"
                  rows={[
                    { label: "Devices", value: summary.security.devices },
                    { label: "OTP challenges", value: summary.security.otpChallenges },
                    { label: "Provider links", value: summary.security.providerLinks },
                  ]}
                />
                <ImpactSummaryCard
                  title="Legacy attribution"
                  rows={[
                    { label: "Email-only rows", value: summary.legacyAttribution.emailOnlyRows },
                    { label: "Ambiguous rows", value: summary.legacyAttribution.ambiguousRows },
                  ]}
                />
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function StudentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const studentId = Number(id);
  const { token, can } = useAdminAuth();
  const queryClient = useQueryClient();
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [exportPdfError, setExportPdfError] = useState<string | null>(null);

  // Danger Zone (Phase B1D) ------------------------------------------------
  const [dangerDialog, setDangerDialog] = useState<"deactivate" | "reactivate" | "start-prep" | "cancel-prep" | null>(null);
  const [deactivateReason, setDeactivateReason] = useState("");
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [lifecycleSuccess, setLifecycleSuccess] = useState<string | null>(null);

  // Deletion Preparation (Phase B3B0-2B) — start/cancel feedback state, kept
  // separate from lifecycle (deactivate/reactivate) success/error state so
  // the two workflows never bleed messages into each other.
  const [prepError, setPrepError] = useState<string | null>(null);
  const [prepSuccess, setPrepSuccess] = useState<string | null>(null);

  // Permanent Account Deletion — Impact Review (Phase B2C). Read-only,
  // advisory analysis fetched from the already-live B2B contract
  // (GET /api/students/:id/deletion-impact). Lazy: this hook does not fire
  // until the Admin explicitly opens the review dialog (enabled gate below).
  const [impactDialogOpen, setImpactDialogOpen] = useState(false);
  const impactQuery = useGetStudentDeletionImpact<StudentDeletionImpactResponse>(studentId, {
    query: {
      queryKey: getGetStudentDeletionImpactQueryKey(studentId),
      enabled: impactDialogOpen && Number.isInteger(studentId) && studentId > 0,
      staleTime: 0,
      gcTime: 0,
      retry: false,
    },
  });

  // Deletion Preparation status (Phase B3B0-2B). The only place this
  // non-sensitive workflow status (active/startedAt/status) is exposed is
  // the additive `deletionPreparation` field on the already-live B2B/B2C
  // contract (GET /students/:id/deletion-impact) — there is no separate
  // status endpoint. This is a second, independently-enabled subscription
  // to the exact same query (identical queryKey to impactQuery below), so
  // it shares the react-query cache: it loads the Danger Zone's current
  // preparation state up front (gated only on users.delete, not on the
  // impact-review dialog being open) without duplicating network calls
  // once the dialog is also opened. impactQuery's own `enabled` condition
  // is untouched by this addition.
  const prepStatusQuery = useGetStudentDeletionImpact<StudentDeletionImpactResponse>(studentId, {
    query: {
      queryKey: getGetStudentDeletionImpactQueryKey(studentId),
      enabled: can("users", "delete") && Number.isInteger(studentId) && studentId > 0,
      staleTime: 0,
      retry: false,
    },
  });

  const query = useQuery({
    queryKey: ["student-overview", studentId],
    enabled: Number.isInteger(studentId) && studentId > 0,
    queryFn: async (): Promise<StudentOverview> => {
      const res = await fetch(`${API_BASE}/api/students/${studentId}/overview`, { headers: makeHeaders(token) });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Failed to load profile");
      }
      return res.json();
    },
  });

  async function invalidateAfterLifecycleChange() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["student-overview", studentId] }),
      queryClient.invalidateQueries({ queryKey: getListStudentsQueryKey() }),
    ]);
  }

  const deactivateMutation = useDeactivateStudent({
    mutation: {
      onSuccess: async () => {
        setLifecycleError(null);
        setLifecycleSuccess("Account deactivated.");
        setDangerDialog(null);
        setDeactivateReason("");
        await invalidateAfterLifecycleChange();
      },
      onError: (err) => {
        setLifecycleSuccess(null);
        const message = (err as { message?: string })?.message;
        setLifecycleError(message || "Failed to deactivate account. Please try again.");
      },
    },
  });

  const reactivateMutation = useReactivateStudent({
    mutation: {
      onSuccess: async () => {
        setLifecycleError(null);
        setLifecycleSuccess("Account reactivated.");
        setDangerDialog(null);
        await invalidateAfterLifecycleChange();
      },
      onError: (err) => {
        setLifecycleSuccess(null);
        const message = (err as { message?: string })?.message;
        setLifecycleError(message || "Failed to reactivate account. Please try again.");
      },
    },
  });

  const lifecyclePending = deactivateMutation.isPending || reactivateMutation.isPending;

  function confirmDeactivate() {
    if (deactivateMutation.isPending) return;
    const reason = deactivateReason.trim();
    deactivateMutation.mutate({ id: studentId, data: reason ? { reason } : undefined });
  }
  function confirmReactivate() {
    if (reactivateMutation.isPending) return;
    reactivateMutation.mutate({ id: studentId });
  }

  // Extracts a meaningful conflict/error message from an ApiError-shaped
  // rejection (see custom-fetch.ts's buildErrorMessage — status + body
  // title/detail/message/error, e.g. real 409 STUDENT_DELETION_PREPARATION_ACTIVE
  // text) without ever falling back to a hand-rolled generic string.
  function preparationErrorMessage(err: unknown): string | undefined {
    return (err as { message?: string } | undefined)?.message;
  }

  async function invalidateAfterPreparationChange() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["student-overview", studentId] }),
      queryClient.invalidateQueries({ queryKey: getListStudentsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetStudentDeletionImpactQueryKey(studentId) }),
    ]);
  }

  const startPrepMutation = useStartStudentDeletionPreparation({
    mutation: {
      onSuccess: async () => {
        setPrepError(null);
        setPrepSuccess("Deletion preparation started.");
        setDangerDialog(null);
        await invalidateAfterPreparationChange();
      },
      onError: (err) => {
        setPrepSuccess(null);
        setPrepError(preparationErrorMessage(err) || "Failed to start deletion preparation. Please try again.");
      },
    },
  });

  const cancelPrepMutation = useCancelStudentDeletionPreparation({
    mutation: {
      onSuccess: async () => {
        setPrepError(null);
        setPrepSuccess("Deletion preparation cancelled.");
        setDangerDialog(null);
        await invalidateAfterPreparationChange();
      },
      onError: (err) => {
        setPrepSuccess(null);
        setPrepError(preparationErrorMessage(err) || "Failed to cancel deletion preparation. Please try again.");
      },
    },
  });

  const prepPending = startPrepMutation.isPending || cancelPrepMutation.isPending;

  function confirmStartPrep() {
    if (startPrepMutation.isPending) return;
    startPrepMutation.mutate({ id: studentId });
  }
  function confirmCancelPrep() {
    if (cancelPrepMutation.isPending) return;
    cancelPrepMutation.mutate({ id: studentId });
  }

  if (query.isLoading) {
    return (
      <div className="admin2-detail-page">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      </div>
    );
  }
  if (query.isError || !query.data) {
    return <div className="py-10 text-center text-destructive">{query.error?.message ?? "Profile not found"}</div>;
  }

  const d = query.data;
  // Deletion Preparation (Phase B3B0-2B) — derived purely from the additive,
  // non-sensitive `deletionPreparation` field on the shared deletion-impact
  // cache entry (prepStatusQuery / impactQuery). Never reinterpreted beyond
  // this passthrough; no email/fingerprint/secret field exists on this shape.
  const deletionPrep = prepStatusQuery.data?.deletionPreparation ?? null;
  const preparationActive = deletionPrep?.active === true;
  const isParent = d.user.accountType === "parent";
  // Mirrors accountModule() in artifacts/api-server/src/routes/students.ts —
  // the same module the backend deactivate/reactivate routes check.
  const lifecycleModule = isParent ? "parents" : "students";
  const listBackHref = isParent ? "/parents" : "/students";
  const bookingsHref = `/bookings?studentEmail=${encodeURIComponent(d.user.email)}`;
  const attendanceHref = `/attendance?studentEmail=${encodeURIComponent(d.user.email)}`;
  const feedbackHref = `/feedback?studentEmail=${encodeURIComponent(d.user.email)}`;
  const fallbackPdfName = `central-studio-user-${d.user.id}-${d.user.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "user"}.pdf`;

  async function handleExportPdf() {
    setIsExportingPdf(true);
    setExportPdfError(null);
    try {
      const res = await fetch(`${API_BASE}/api/students/${studentId}/overview.pdf`, { headers: makeHeaders(token) });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Failed to export PDF");
      }
      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") ?? "";
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackPdfName;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportPdfError((err as Error)?.message ?? "Failed to export PDF");
    } finally {
      setIsExportingPdf(false);
    }
  }

  return (
    <div className="admin2-detail-page">
      {/* Production refinement: Back navigation and Export PDF used to be
          two stacked rows (a bare Link above PageHeader's own right-
          justified row) reading as two disconnected actions. PageHeader
          never rendered title/description here anyway (TopBar's pagebar
          already owns page identity) — so it added a wrapper for nothing.
          One flex row, one intentional header area. */}
      <div className="flex items-center justify-between gap-3">
        <Link href={listBackHref}>
          <Button variant="ghost" size="sm" className="gap-1"><ArrowLeft className="h-4 w-4" /> Back to {isParent ? "Parents" : "Students"}</Button>
        </Link>
        <Button variant="outline" className="gap-2" onClick={handleExportPdf} disabled={isExportingPdf}>
          {isExportingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {isExportingPdf ? "Exporting..." : "Export PDF"}
        </Button>
      </div>
      {exportPdfError && <div className="text-sm text-destructive">{exportPdfError}</div>}

      {/* ---------------------------------------------------------------- */}
      {/* Header card                                                      */}
      {/* ---------------------------------------------------------------- */}
      <Card className="admin2-detail-identity">
        <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16">
              {d.user.avatarUrl ? <AvatarImage src={d.user.avatarUrl} alt={d.user.name} /> : null}
              <AvatarFallback className="text-lg">{d.user.name.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-semibold text-white">{d.user.name}</span>
                <Badge variant="secondary" className="capitalize">{d.user.accountType ?? "student"}</Badge>
                <AccountStatusBadge status={d.user.accountStatus} />
                <Badge variant="outline" className={MEMBERSHIP_STATUS_STYLE[d.membershipStatus]}>{d.membershipStatus}</Badge>
                {d.completion?.verificationBadge ? (
                  <Badge className="gap-1 border-transparent bg-emerald-500/15 text-emerald-400">
                    <BadgeCheck className="h-3 w-3" /> Verified
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">Not verified</Badge>
                )}
                {d.completion && <Badge variant="outline">{d.completion.percent}% profile complete</Badge>}
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Mail className="h-3.5 w-3.5" /> {d.user.email}</span>
                <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5" /> {d.user.phone || "—"}</span>
                <span className="inline-flex items-center gap-1"><QrCode className="h-3.5 w-3.5" /> {d.user.qrToken.slice(0, 8)}…</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>Joined {formatDate(d.user.joinedAt)}</span>
                <span>Last login {d.user.lastLoginAt ? formatDateTime(d.user.lastLoginAt) : "Never"}</span>
                <span>Signed up via {providerLabel(d.user.authProvider)}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/* KPI cards                                                        */}
      {/* ---------------------------------------------------------------- */}
      <div className="admin2-detail-kpis grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Bookings" value={d.permissions.canViewBookings ? d.stats.totalBookings : "—"} />
        <KpiCard label="Total Attendance" value={d.permissions.canViewAttendance ? d.stats.totalAttendance : "—"} />
        <KpiCard label="Attendance Rate" value={formatPercent(d.stats.attendanceRate)} sub="attendance ÷ bookings" />
        <KpiCard
          label="Active Package"
          value={d.stats.activePackage ? d.stats.activePackage.packageName : "None"}
          sub={d.stats.activePackage ? `${d.stats.activePackage.remainingCredits}/${d.stats.activePackage.totalCredits} credits` : undefined}
        />
        <KpiCard label="Remaining Credits" value={d.stats.remainingCredits ?? "—"} />
        <KpiCard label="Package Expiry" value={formatDate(d.stats.packageExpiry)} />
        <KpiCard
          label="Feedback Average"
          value={d.stats.feedbackAverage != null ? `${d.stats.feedbackAverage.toFixed(1)} / 5` : "No feedback yet"}
          sub={d.stats.feedbackCount > 0 ? `${d.stats.feedbackCount} review${d.stats.feedbackCount === 1 ? "" : "s"}` : undefined}
        />
        <KpiCard label="Last Activity" value={formatDate(d.stats.lastActivity)} />
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Tabs                                                             */}
      {/* ---------------------------------------------------------------- */}
      <Tabs defaultValue="profile" className="admin2-detail-tabs w-full">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          {isParent && <TabsTrigger value="children">Children ({d.children.length})</TabsTrigger>}
          <TabsTrigger value="bookings">Bookings</TabsTrigger>
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
          <TabsTrigger value="feedback">Feedback</TabsTrigger>
          <TabsTrigger value="packages">Packages &amp; Credits</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
        </TabsList>

        {/* Profile ------------------------------------------------------ */}
        <TabsContent value="profile">
          <Card>
            <CardHeader><CardTitle>Profile Details</CardTitle></CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <DetailRow label="Name" value={d.user.name} />
              <DetailRow label="Email" value={d.user.email} />
              <DetailRow label="Phone" value={d.user.phone} />
              <DetailRow label="Gender" value={d.user.gender} notCollected={!d.user.gender} />
              <DetailRow label="Birthday" value={d.user.dateOfBirth} notCollected={!d.user.dateOfBirth} />
              <DetailRow label="City" value={d.user.city} notCollected={!d.user.city} />
              <DetailRow label="Nationality" value={d.user.nationality} notCollected={!d.user.nationality} />
              <DetailRow label="Account Type" value={<span className="capitalize">{d.user.accountType ?? "student"}</span>} />
              <DetailRow label="Signup Provider" value={providerLabel(d.user.authProvider)} />
              <DetailRow label="How Did You Hear About Us" value={d.user.howDidYouHearAboutUs} notCollected={!d.user.howDidYouHearAboutUs} />
              <DetailRow label="Email Verified" value={d.user.emailVerified ? `Yes (${formatDate(d.user.emailVerifiedAt)})` : "No"} />
              <DetailRow label="Policies Accepted" value={d.user.policiesAcceptedAt ? `Yes (${formatDate(d.user.policiesAcceptedAt)})` : "No"} />
              {d.completion && (
                <>
                  <DetailRow label="Profile Completion" value={`${d.completion.percent}% · ${d.completion.isComplete ? "Complete" : `Next: ${d.completion.nextStep}`}`} />
                  <DetailRow label="Last Completion Step" value={d.completion.lastCompletionStep} />
                </>
              )}
            </CardContent>
            {!d.permissions.canViewProfileCompletion && (
              <CardContent className="pt-0">
                <NoPermission what="profile completion details (requires users.view)" />
              </CardContent>
            )}
            {d.completion && d.completion.missing.length > 0 && (
              <CardContent className="pt-0">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Missing</div>
                <div className="flex flex-wrap gap-2">
                  {d.completion.missing.map((m) => <Badge key={m} variant="outline" className="text-amber-400">{m}</Badge>)}
                </div>
              </CardContent>
            )}
          </Card>

          <Card className="mt-6">
            <CardHeader><CardTitle>Dance Interests</CardTitle></CardHeader>
            <CardContent>
              {!d.permissions.canViewProfileCompletion ? (
                <NoPermission what="dance interests" />
              ) : d.danceInterests.length === 0 ? (
                <EmptyState text="No dance interests selected yet." />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {d.danceInterests.map((di) => <Badge key={di.id} variant="secondary">{di.name}</Badge>)}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Danger Zone — Account Lifecycle (Phase B1D). Reuses the same
              students.edit / parents.edit permission check the backend
              deactivate/reactivate routes enforce (falls back to users.edit,
              matching adminCan's anyOf). Super Admin roles carry every
              permission true in their role.permissions map, so `can()`
              already resolves true for them with no special-case here. */}
          {(can(lifecycleModule, "edit") || can("users", "edit")) && d.user.accountStatus !== "deleted" && (
            <Card className="mt-6 border-red-500/40">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm text-red-400">
                  <AlertTriangle className="h-4 w-4" /> Danger Zone
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {lifecycleSuccess && <p role="status" className="text-sm text-emerald-400">{lifecycleSuccess}</p>}
                {lifecycleError && <p role="alert" className="text-sm text-destructive">{lifecycleError}</p>}

                {d.user.accountStatus === "active" ? (
                  <>
                    <p className="text-sm text-muted-foreground">
                      This does not delete the account. Bookings, payments, children, and history all remain.
                      Active sessions are revoked, device push notifications are disabled, and the user cannot
                      log in again until an admin reactivates the account.
                    </p>
                    <Button
                      variant="destructive"
                      size="sm"
                      aria-label="Deactivate account"
                      disabled={lifecyclePending}
                      onClick={() => { setLifecycleError(null); setLifecycleSuccess(null); setDangerDialog("deactivate"); }}
                    >
                      <ShieldOff className="h-4 w-4" /> Deactivate Account
                    </Button>
                  </>
                ) : !preparationActive ? (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Reactivating lets this user log in again. Old sessions remain invalid — a fresh login is
                      required. All historical data was never removed. Device push notifications are not
                      automatically restored; the user must register a device again after logging in.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label="Reactivate account"
                      disabled={lifecyclePending}
                      onClick={() => { setLifecycleError(null); setLifecycleSuccess(null); setDangerDialog("reactivate"); }}
                    >
                      Reactivate Account
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Reactivate Account is unavailable while deletion preparation is active. Cancel deletion
                    preparation first, then reactivate.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Deletion Preparation (Phase B3B0-2B). Distinct workflow from
              Deactivation above: DEACTIVATED means access is disabled and
              reversible; DELETION PREPARATION means identity is frozen while
              deletion work is being prepared. No destructive delete exists
              yet, so this never uses "Deleted"/"Deleting"/"Permanent Delete"
              language. Reuses users.delete — the same permission the
              Permanent Account Deletion (Review Impact) card below already
              requires — rather than introducing a new permission. */}
          {can("users", "delete") && d.user.accountStatus !== "deleted" && (
            <Card className="mt-6 border-red-500/40">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm text-red-400">
                  <AlertTriangle className="h-4 w-4" /> Deletion Preparation
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {prepSuccess && <p role="status" className="text-sm text-emerald-400">{prepSuccess}</p>}
                {prepError && <p role="alert" className="text-sm text-destructive">{prepError}</p>}

                <p className="text-sm text-muted-foreground">
                  Deletion preparation freezes identity-sensitive changes (especially email) while permanent
                  deletion is being prepared. This is separate from deactivation: it does not disable login by
                  itself, and it does not permanently delete the account.
                </p>

                {preparationActive ? (
                  <>
                    <p className="text-sm text-white">
                      Deletion Preparation Active
                      {deletionPrep?.startedAt ? ` · Started ${formatDateTime(deletionPrep.startedAt)}` : ""}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label="Cancel Deletion Preparation"
                      disabled={prepPending}
                      onClick={() => { setPrepError(null); setPrepSuccess(null); setDangerDialog("cancel-prep"); }}
                    >
                      Cancel Deletion Preparation
                    </Button>
                  </>
                ) : d.user.accountStatus === "deactivated" ? (
                  <>
                    <p className="text-sm text-muted-foreground">Deletion preparation has not started.</p>
                    <Button
                      variant="destructive"
                      size="sm"
                      aria-label="Start Deletion Preparation"
                      disabled={prepPending}
                      onClick={() => { setPrepError(null); setPrepSuccess(null); setDangerDialog("start-prep"); }}
                    >
                      Start Deletion Preparation
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    The Student must be deactivated before deletion preparation can start.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Permanent Account Deletion — review-only (Phase B2C). Deliberately
              a separate subsection from Account Access above: reversible
              deactivation and irreversible-deletion analysis must never be
              mixed into one card or one button. The only action here is
              read-only impact review; there is no execution path yet
              (Permanent Delete is a future phase, B4). */}
          {can("users", "delete") && d.user.accountStatus !== "deleted" && (
            <Card className="mt-6 border-red-500/40">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm text-red-400">
                  <AlertTriangle className="h-4 w-4" /> Permanent Account Deletion
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Permanent deletion is irreversible and handled separately from account deactivation.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="Review Deletion Impact"
                  disabled={impactDialogOpen && impactQuery.isFetching}
                  onClick={() => { setImpactDialogOpen(true); void impactQuery.refetch(); }}
                >
                  {impactDialogOpen && impactQuery.isFetching ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  Review Deletion Impact
                </Button>
              </CardContent>
            </Card>
          )}

          <DeletionImpactDialog
            open={impactDialogOpen}
            onOpenChange={(open) => setImpactDialogOpen(open)}
            query={impactQuery}
          />

          <AlertDialog open={dangerDialog === "deactivate"} onOpenChange={(open) => { if (!open) setDangerDialog(null); }}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Deactivate this account?</AlertDialogTitle>
                <AlertDialogDescription>
                  {d.user.name} will be signed out of every session, their device push notifications will be
                  disabled, and they will not be able to log in until an admin reactivates the account. Bookings,
                  payments, children, and history are preserved.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <Textarea
                placeholder="Reason (optional, visible in the audit log)"
                value={deactivateReason}
                onChange={(e) => setDeactivateReason(e.target.value)}
                maxLength={500}
              />
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deactivateMutation.isPending}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={deactivateMutation.isPending}
                  onClick={(e) => { e.preventDefault(); confirmDeactivate(); }}
                >
                  {deactivateMutation.isPending ? "Deactivating…" : "Deactivate Account"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog open={dangerDialog === "reactivate"} onOpenChange={(open) => { if (!open) setDangerDialog(null); }}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reactivate this account?</AlertDialogTitle>
                <AlertDialogDescription>
                  {d.user.name} will be able to log in again with a fresh session. Historical data was never
                  removed. Device push notifications are not automatically restored.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={reactivateMutation.isPending}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={reactivateMutation.isPending}
                  onClick={(e) => { e.preventDefault(); confirmReactivate(); }}
                >
                  {reactivateMutation.isPending ? "Reactivating…" : "Reactivate Account"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog open={dangerDialog === "start-prep"} onOpenChange={(open) => { if (!open) setDangerDialog(null); }}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Start deletion preparation?</AlertDialogTitle>
                <AlertDialogDescription>
                  {d.user.name} will remain deactivated — this does not permanently delete the account, and no
                  data is removed. Identity-sensitive changes, especially email, will be frozen while
                  preparation is active. Reactivation will require cancelling deletion preparation first. No
                  financial or history data is deleted at this step.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={startPrepMutation.isPending}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={startPrepMutation.isPending}
                  onClick={(e) => { e.preventDefault(); confirmStartPrep(); }}
                >
                  {startPrepMutation.isPending ? "Starting…" : "Start Deletion Preparation"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog open={dangerDialog === "cancel-prep"} onOpenChange={(open) => { if (!open) setDangerDialog(null); }}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Cancel deletion preparation?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes the identity freeze. {d.user.name} remains deactivated — cancelling deletion
                  preparation does not reactivate the account. Reactivation is a separate action afterward.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={cancelPrepMutation.isPending}>Keep Preparing</AlertDialogCancel>
                <AlertDialogAction
                  disabled={cancelPrepMutation.isPending}
                  onClick={(e) => { e.preventDefault(); confirmCancelPrep(); }}
                >
                  {cancelPrepMutation.isPending ? "Cancelling…" : "Cancel Deletion Preparation"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </TabsContent>

        {/* Children ------------------------------------------------------ */}
        {isParent && (
          <TabsContent value="children">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Users className="h-4 w-4" /> Children</CardTitle></CardHeader>
              <CardContent>
                {!d.permissions.canViewChildren ? (
                  <NoPermission what="children" />
                ) : d.children.length === 0 ? (
                  <EmptyState text="No children added yet." />
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {d.children.map((c) => (
                      <div key={c.id} className="rounded-lg border p-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-white">{c.fullName}</span>
                          <Badge variant="secondary" className="capitalize">{c.gender}</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Age {c.age ?? "—"}{c.birthday ? ` · Born ${c.birthday}` : ""}
                        </div>
                        <DetailRow label="Medical Notes" value={c.medicalNotes} />
                        <DetailRow
                          label="Emergency Contact"
                          value={c.emergencyName || c.emergencyPhone ? `${c.emergencyName ?? ""} ${c.emergencyPhone ? `(${c.emergencyPhone})` : ""}`.trim() : null}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Bookings ------------------------------------------------------ */}
        <TabsContent value="bookings">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Recent Bookings</CardTitle>
              {d.permissions.canViewBookings && (
                <Link href={bookingsHref}><Button variant="outline" size="sm">View all bookings</Button></Link>
              )}
            </CardHeader>
            <CardContent>
              {!d.permissions.canViewBookings ? (
                <NoPermission what="bookings" />
              ) : d.bookings.length === 0 ? (
                <EmptyState text="No bookings yet." />
              ) : (
                <div className="space-y-2">
                  {d.bookings.map((b) => (
                    <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                      <div>
                        <div className="text-sm font-medium text-white">{b.bookingNumber} · {b.classTitle ?? "Class"}</div>
                        <div className="text-xs text-muted-foreground">
                          {b.participantType === "child" ? `Child: ${b.participantName}` : `Self: ${b.participantName}`} · {formatDate(b.occurrenceDate)}
                          {b.scheduleStartTime ? ` · ${b.scheduleStartTime}${b.scheduleEndTime ? `–${b.scheduleEndTime}` : ""}` : ""}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="capitalize">{b.bookingStatus}</Badge>
                        <Badge variant="outline" className="capitalize">{b.paymentStatus.replace(/_/g, " ")}</Badge>
                        {b.paymentMode && <Badge variant="secondary" className="capitalize">{b.paymentMode.replace(/_/g, " ")}</Badge>}
                        <span className="text-xs text-muted-foreground">{formatDate(b.createdAt)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Attendance ------------------------------------------------------ */}
        <TabsContent value="attendance">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Recent Attendance</CardTitle>
              {d.permissions.canViewAttendance && (
                <Link href={attendanceHref}><Button variant="outline" size="sm">View Attendance History</Button></Link>
              )}
            </CardHeader>
            <CardContent>
              {!d.permissions.canViewAttendance ? (
                <NoPermission what="attendance" />
              ) : d.attendance.length === 0 ? (
                <EmptyState text="No attendance records yet." />
              ) : (
                <div className="space-y-2">
                  {d.attendance.map((a) => (
                    <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                      <div>
                        <div className="text-sm font-medium text-white">{a.classTitle ?? "Class"}</div>
                        <div className="text-xs text-muted-foreground">
                          {a.instructorName ? `with ${a.instructorName} · ` : ""}{formatDateTime(a.checkedInAt)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="capitalize">{a.status.replace(/_/g, " ")}</Badge>
                        {a.creditDeducted && <Badge variant="secondary">Credit deducted</Badge>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Feedback ------------------------------------------------------ */}
        <TabsContent value="feedback">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Recent Feedback</CardTitle>
              {d.permissions.canViewFeedback && (
                <Link href={feedbackHref}><Button variant="outline" size="sm">View all feedback</Button></Link>
              )}
            </CardHeader>
            <CardContent>
              {!d.permissions.canViewFeedback ? (
                <NoPermission what="feedback" />
              ) : d.feedback.length === 0 ? (
                <EmptyState text="No feedback submitted yet." />
              ) : (
                <div className="space-y-2">
                  {d.feedback.map((f) => (
                    <div key={f.id} className="rounded-lg border p-3 space-y-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-medium text-white">{f.classTitle ?? "Class"}{f.instructorName ? ` · ${f.instructorName}` : ""}</div>
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 text-[#00B6D7]">
                            {Array.from({ length: 5 }).map((_, i) => (
                              <Star key={i} className={`h-3.5 w-3.5 ${i < f.rating ? "fill-current" : "opacity-25"}`} />
                            ))}
                          </span>
                          <Badge variant="outline" className="capitalize">{f.reviewStatus.replace(/_/g, " ")}</Badge>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {f.hasComment
                          ? (f.commentPreview ?? "Hidden — this admin lacks feedback.viewComments.")
                          : "No comment."}
                      </div>
                      <div className="text-xs text-muted-foreground">{formatDate(f.submittedAt)}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Packages & Credits ------------------------------------------------------ */}
        <TabsContent value="packages">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Packages</CardTitle>
                <Link href="/package-orders"><Button variant="outline" size="sm">View Packages</Button></Link>
              </CardHeader>
              <CardContent>
                {!d.permissions.canViewPackages ? (
                  <NoPermission what="packages" />
                ) : d.packages.recent.length === 0 ? (
                  <EmptyState text="No packages purchased yet." />
                ) : (
                  <div className="space-y-2">
                    {d.packages.recent.map((p) => (
                      <div key={p.id} className={`rounded-lg border p-3 ${p.id === d.packages.active?.id ? "border-[#00B6D7]/60 bg-[#00B6D7]/5" : ""}`}>
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-white">{p.packageName}</span>
                          <Badge variant="outline" className="capitalize">{p.status.replace(/_/g, " ")}</Badge>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {p.remainingCredits}/{p.totalCredits} credits · Activated {formatDate(p.activatedAt)} · Expires {formatDate(p.expiresAt)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <p className="mt-3 text-xs text-muted-foreground">
                  Price / amount paid is not shown — package orders don't carry a reliable amount-paid field.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Credit Ledger</CardTitle></CardHeader>
              <CardContent>
                {!d.permissions.canViewCredits ? (
                  <NoPermission what="the credit ledger" />
                ) : d.creditTransactions.length === 0 ? (
                  <EmptyState text="No credit transactions yet." />
                ) : (
                  <div className="space-y-2">
                    {d.creditTransactions.map((c) => (
                      <div key={c.id} className="flex items-center justify-between gap-2 rounded-lg border p-3">
                        <div>
                          <div className="text-sm text-white capitalize">{c.type.replace(/_/g, " ")}</div>
                          <div className="text-xs text-muted-foreground">{c.notes ?? `by ${c.createdBy}`} · {formatDateTime(c.createdAt)}</div>
                        </div>
                        <span className={`text-sm font-semibold ${c.delta > 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {c.delta > 0 ? "+" : ""}{c.delta}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Timeline ------------------------------------------------------ */}
        <TabsContent value="timeline">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><CalendarClock className="h-4 w-4" /> Timeline</CardTitle></CardHeader>
            <CardContent>
              {d.timeline.length === 0 ? (
                <EmptyState text="No activity yet." />
              ) : (
                <div className="space-y-4">
                  {d.timeline.map((item, i) => {
                    const Icon = TIMELINE_ICONS[item.icon] ?? CalendarClock;
                    return (
                      <div key={i} className="flex gap-3">
                        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                        <div className="flex-1 border-b pb-3 last:border-b-0">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-sm font-medium text-white">{item.title}</span>
                            <span className="text-xs text-muted-foreground">{formatDateTime(item.timestamp)}</span>
                          </div>
                          <div className="text-xs text-muted-foreground">{item.description}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
