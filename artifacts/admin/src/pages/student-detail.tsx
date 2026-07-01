import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import {
  ArrowLeft,
  BadgeCheck,
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  Mail,
  Package,
  Phone,
  QrCode,
  Star,
  UserCog,
  UserPlus,
  Users,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAdminAuth } from "@/contexts/AdminAuthContext";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
const API_KEY = (import.meta.env.VITE_API_KEY as string | undefined) ?? "";

function makeHeaders(token?: string | null): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(API_KEY ? { "x-api-key": API_KEY } : {}),
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
  howDidYouKnowUs: string | null;
}
interface OverviewCompletion {
  emailVerified: boolean;
  profileCompleted: boolean;
  profileCompletedAt: string | null;
  profileCompletionPercent: number;
  verificationBadge: boolean;
  note: string;
  fieldsNotYetCollected: string[];
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
}
type MembershipStatus = "Active" | "Inactive" | "Needs Profile" | "No Active Package" | "New" | "At Risk";

interface StudentOverview {
  user: OverviewUser;
  completion: OverviewCompletion;
  membershipStatus: MembershipStatus;
  stats: OverviewStats;
  children: OverviewChild[];
  packages: { active: OverviewStats["activePackage"]; recent: OverviewPackage[] };
  bookings: OverviewBooking[];
  attendance: OverviewAttendance[];
  feedback: OverviewFeedback[];
  creditTransactions: OverviewCreditTx[];
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

export default function StudentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const studentId = Number(id);
  const { token, can } = useAdminAuth();

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

  if (query.isLoading) {
    return (
      <div className="space-y-6">
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
  const isParent = d.user.accountType === "parent";
  const listBackHref = isParent ? "/parents" : "/students";
  const bookingsHref = `/bookings?studentEmail=${encodeURIComponent(d.user.email)}`;
  const attendanceHref = `/attendance?studentEmail=${encodeURIComponent(d.user.email)}`;
  const feedbackHref = `/feedback?studentEmail=${encodeURIComponent(d.user.email)}`;

  return (
    <div className="space-y-6">
      <Link href={listBackHref}>
        <Button variant="ghost" size="sm" className="gap-1"><ArrowLeft className="h-4 w-4" /> Back to {isParent ? "Parents" : "Students"}</Button>
      </Link>

      <PageHeader
        title={d.user.name}
        description={isParent ? "Parent Profile · 360° View" : "Student Profile · 360° View"}
        mode="studio"
      />

      {/* ---------------------------------------------------------------- */}
      {/* Header card                                                      */}
      {/* ---------------------------------------------------------------- */}
      <Card>
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
                <Badge variant="outline" className={MEMBERSHIP_STATUS_STYLE[d.membershipStatus]}>{d.membershipStatus}</Badge>
                {d.completion.verificationBadge ? (
                  <Badge className="gap-1 border-transparent bg-emerald-500/15 text-emerald-400">
                    <BadgeCheck className="h-3 w-3" /> Verified
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">Not verified</Badge>
                )}
                <Badge variant="outline">{d.completion.profileCompletionPercent}% profile complete</Badge>
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
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
      <Tabs defaultValue="profile" className="w-full">
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
              <DetailRow label="How Did You Know Us" value={d.user.howDidYouKnowUs} notCollected={!d.user.howDidYouKnowUs} />
              <DetailRow label="Email Verified" value={d.user.emailVerified ? `Yes (${formatDate(d.user.emailVerifiedAt)})` : "No"} />
              <DetailRow label="Profile Completed" value={d.completion.profileCompleted ? "Yes" : "No"} />
              <DetailRow label="Profile Completed Date" value={formatDate(d.completion.profileCompletedAt)} />
            </CardContent>
            <CardContent className="pt-0">
              <p className="text-xs text-muted-foreground">{d.completion.note}</p>
            </CardContent>
          </Card>
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
