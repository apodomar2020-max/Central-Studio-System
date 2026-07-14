import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, ChevronLeft, Download, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const API_BASE = import.meta.env.VITE_API_URL as string | undefined ?? "";
const API_KEY = import.meta.env.VITE_API_KEY as string | undefined ?? "";
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function makeHeaders(token: string | null): HeadersInit {
  return { "Content-Type": "application/json", ...(API_KEY ? { "x-api-key": API_KEY } : {}), ...(token ? { "x-admin-token": token } : {}) };
}

interface DetailResponse {
  student: {
    assignmentId: number;
    applicationId: number;
    applicationStatus: string;
    childId: number | null;
    levelId: number | null;
    groupId: number | null;
    studentName: string;
    birthday: string | null;
    age: number | null;
    gender: string | null;
    dateJoined: string | null;
    parentName: string;
    parentPhone: string;
    parentEmail: string;
    emergencyContactName: string | null;
    emergencyContactPhone: string | null;
    preferredPaymentMethod: string | null;
    levelName: string | null;
    groupName: string | null;
    paymentStatus: string | null;
    subscriptionStatus: "pending" | "active" | "renewed" | "expired";
    subscriptionDisplayStatus: string;
    subscriptionStartDate: string | null;
    subscriptionExpiresAt: string | null;
    daysRemaining: number | null;
  };
  currentPayment: BalletPayment | null;
  payments: BalletPayment[];
  enrollmentHistory: {
    assignmentId: number;
    applicationId: number;
    applicationStatus: string;
    assignmentStatus: string;
    levelId: number | null;
    levelName: string | null;
    groupId: number | null;
    groupName: string | null;
    enrolledAt: string | null;
    updatedAt: string | null;
  }[];
  groupSchedules: { id: number; dayOfWeek: number; startTime: string; endTime: string; status: string; classTitle: string | null; instructorName: string | null }[];
  attendanceSummary: { billingMonth: string; monthlyHours: number | null; attendedHours: number; absentHours: number; consumedHours: number; remainingHours: number | null; hasActiveSubscription: boolean } | null;
  attendanceHistory: { id: number; classDate: string | null; status: string; durationMinutes: number | null; notes: string | null; balletScheduleId: number | null; createdAt: string }[];
}

interface BalletGroup {
  id: number;
  name: string;
  levelId: number;
  isActive: boolean;
  capacity: number | null;
  activeAssignmentCount: number;
}

interface GroupsResponse {
  data: BalletGroup[];
}

interface BalletPayment {
  id: number;
  packageId: number | null;
  packageName: string | null;
  amountEgp: number;
  status: string;
  paymentMethod: string | null;
  billingMonth: string | null;
  subscriptionStartDate: string | null;
  subscriptionExpiresAt: string | null;
  originalExpiresAt: string | null;
  isRenewal: boolean;
  renewedFromId: number | null;
  extensionHistory: { previousExpiresAt: string; newExpiresAt: string; daysAdded: number; reason: string; note: string | null; actorId: number | null; extendedAt: string }[];
  subscriptionStatus: "pending" | "active" | "renewed" | "expired";
  subscriptionDisplayStatus: string;
  daysRemaining: number | null;
  updatedAt: string;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <Card><CardHeader className="pb-3"><CardTitle className="text-sm">{title}</CardTitle></CardHeader><CardContent className="space-y-3">{children}</CardContent></Card>;
}
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div><div className="mt-1 text-sm text-foreground">{value ?? <span className="italic text-muted-foreground">—</span>}</div></div>;
}
function SummaryCard({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return <Card><CardContent className="p-4"><div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div><div className="mt-1 text-lg font-semibold text-white">{value ?? "—"}</div>{sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}</CardContent></Card>;
}
function SubscriptionBadge({ status, display }: { status: string; display: string }) {
  const className = status === "expired"
    ? "bg-red-500/15 text-red-400 border-red-500/30"
    : status === "renewed"
      ? "bg-cyan-500/15 text-cyan-400 border-cyan-500/30"
      : status === "active"
        ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
        : "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
  return <Badge variant="outline" className={className}>{display}</Badge>;
}
function PaymentBadge({ status }: { status?: string | null }) {
  if (!status) return <span className="italic text-muted-foreground">—</span>;
  const className = status === "paid"
    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
    : status === "rejected"
      ? "bg-red-500/15 text-red-400 border-red-500/30"
      : status === "refunded"
        ? "bg-slate-500/15 text-slate-400 border-slate-500/30"
        : "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
  return <Badge variant="outline" className={className}>{status.replace(/^./, (c) => c.toUpperCase())}</Badge>;
}
export default function BalletStudentDetailPage() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const { token } = useAdminAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [groupNote, setGroupNote] = useState("");
  const id = parseInt(assignmentId ?? "", 10);

  const { data, isLoading, isError } = useQuery<DetailResponse>({
    queryKey: ["ballet-student", id],
    enabled: !isNaN(id),
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/admin/ballet/students/${id}`, { headers: makeHeaders(token) });
      if (!res.ok) throw new Error("Failed to load Ballet student");
      return res.json();
    },
  });

  const { data: groupsData, isLoading: isLoadingGroups } = useQuery<GroupsResponse>({
    queryKey: ["ballet-groups", token],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/admin/ballet/groups?limit=100`, { headers: makeHeaders(token) });
      if (!res.ok) throw new Error("Failed to load Ballet groups");
      return res.json();
    },
  });

  const groupMutation = useMutation({
    mutationFn: async () => {
      if (!data) throw new Error("Student data is not loaded");
      const res = await fetch(`${API_BASE}/api/admin/ballet/applications/${data.student.applicationId}/assign-group`, {
        method: "POST",
        headers: makeHeaders(token),
        body: JSON.stringify({ groupId: parseInt(selectedGroupId, 10), note: groupNote || undefined }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Failed to assign group");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Group updated" });
      setSelectedGroupId("");
      setGroupNote("");
      queryClient.invalidateQueries({ queryKey: ["ballet-student", id] });
      queryClient.invalidateQueries({ queryKey: ["ballet-students"] });
      if (data) queryClient.invalidateQueries({ queryKey: ["ballet-application", data.student.applicationId] });
    },
    onError: (e: Error) => toast({ title: "Group update failed", description: e.message, variant: "destructive" }),
  });

  async function handleExportPdf() {
    if (!data) return;
    setIsExportingPdf(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/ballet/applications/${data.student.applicationId}/export.pdf`, { headers: makeHeaders(token) });
      if (!res.ok) throw new Error("Failed to export PDF");
      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") ?? "";
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `Ballet-Application-${data.student.applicationId}.pdf`;
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

  if (isLoading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (isError || !data) return <div className="space-y-4"><Button variant="ghost" size="sm" onClick={() => navigate("/ballet/students")}><ChevronLeft className="mr-1 h-4 w-4" /> Back</Button><p className="text-sm text-destructive">Failed to load Ballet student.</p></div>;

  const { student, currentPayment } = data;
  const levelGroups = (groupsData?.data ?? []).filter((group) => (
    student.levelId != null
    && group.levelId === student.levelId
    && (group.isActive || group.id === student.groupId)
  ));
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/ballet/students")} className="mt-1 -ml-2 text-muted-foreground"><ChevronLeft className="mr-1 h-4 w-4" /> Back</Button>
        <div className="flex-1">
          <PageHeader title={student.studentName} description={`Ballet Student File · Application #${student.applicationId}`} mode="stage" />
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4 p-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-semibold text-white">{student.studentName}</span>
              <SubscriptionBadge status={student.subscriptionStatus} display={student.subscriptionDisplayStatus} />
              <Badge variant="secondary">{student.levelName ?? "No level"}</Badge>
              {student.groupName && <Badge variant="outline">{student.groupName}</Badge>}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span>Parent: {student.parentName}</span>
              <span>Application #{student.applicationId}</span>
              <span>Assignment #{student.assignmentId}</span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>Joined {student.dateJoined ? new Date(student.dateJoined).toLocaleString() : "—"}</span>
              <span>Phone {student.parentPhone}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate(`/ballet/applications/${student.applicationId}`)}><FileText className="mr-2 h-3.5 w-3.5" />Open Application</Button>
            <Button variant="outline" size="sm" onClick={handleExportPdf} disabled={isExportingPdf}>{isExportingPdf ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-2 h-3.5 w-3.5" />}Export PDF</Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Current Level" value={student.levelName ?? "Not assigned"} sub={student.groupName ? `Group: ${student.groupName}` : "No group yet"} />
        <SummaryCard label="Subscription" value={<SubscriptionBadge status={student.subscriptionStatus} display={student.subscriptionDisplayStatus} />} sub={student.subscriptionExpiresAt ? `Expires ${student.subscriptionExpiresAt}` : "No active period"} />
        <SummaryCard label="Payment Status" value={<PaymentBadge status={student.paymentStatus} />} sub={currentPayment ? `${currentPayment.amountEgp} EGP` : "No payment recorded"} />
        <SummaryCard label="Remaining Hours" value={data.attendanceSummary?.remainingHours ?? "—"} sub={data.attendanceSummary?.billingMonth ? `For ${data.attendanceSummary.billingMonth}` : undefined} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="Student"><Field label="Name" value={student.studentName} /><Field label="Birthday" value={student.birthday} /><Field label="Age" value={student.age != null ? `${student.age} years` : null} /><Field label="Gender" value={student.gender} /><Field label="Date joined" value={student.dateJoined ? new Date(student.dateJoined).toLocaleString() : null} /><Field label="Child profile ID" value={student.childId != null ? `#${student.childId}` : null} /></Section>
        <Section title="Parent"><Field label="Name" value={student.parentName} /><Field label="Phone" value={student.parentPhone} /><Field label="Email" value={student.parentEmail} /><Field label="Emergency contact" value={[student.emergencyContactName, student.emergencyContactPhone].filter(Boolean).join(" · ") || null} /></Section>
        <Section title="Enrollment"><Field label="Application ID" value={`#${student.applicationId}`} /><Field label="Application status" value={student.applicationStatus} /><Field label="Level" value={student.levelName} /><Field label="Group" value={student.groupName} /><Field label="Class schedules" value={data.groupSchedules.length ? data.groupSchedules.map((s) => `${s.classTitle ?? "Class"}: ${DAY_NAMES[s.dayOfWeek] ?? "?"} ${s.startTime}-${s.endTime}`).join("; ") : null} /><Field label="Instructor" value={data.groupSchedules.map((s) => s.instructorName).filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join(", ") || null} /></Section>
        <Section title="Assigned Group">
          <Field label="Current level" value={student.levelName} />
          <Field label="Current group" value={student.groupName} />
          {student.levelId == null ? (
            <p className="text-sm italic text-muted-foreground">Assign a Ballet level before choosing a group.</p>
          ) : (
            <div className="space-y-3">
              <Select value={selectedGroupId} onValueChange={setSelectedGroupId} disabled={isLoadingGroups}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder={isLoadingGroups ? "Loading groups…" : "Select a group for this level"} />
                </SelectTrigger>
                <SelectContent>
                  {levelGroups.length ? levelGroups.map((group) => (
                    <SelectItem key={group.id} value={String(group.id)}>
                      {group.name}{group.capacity == null ? "" : ` · ${group.activeAssignmentCount}/${group.capacity}`}
                    </SelectItem>
                  )) : <SelectItem value="none" disabled>No active groups for this level</SelectItem>}
                </SelectContent>
              </Select>
              <Textarea className="text-sm min-h-[58px] resize-none" placeholder="Optional internal note" value={groupNote} onChange={(e) => setGroupNote(e.target.value)} />
              <Button size="sm" variant="outline" disabled={!selectedGroupId || selectedGroupId === "none" || groupMutation.isPending} onClick={() => groupMutation.mutate()}>
                {groupMutation.isPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                Update Group
              </Button>
            </div>
          )}
        </Section>
        <Section title="Subscription">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Preferred method" value={student.preferredPaymentMethod} />
            <Field label="Actual method" value={currentPayment?.paymentMethod} />
            <Field label="Package" value={currentPayment?.packageName} />
            <Field label="Billing month" value={currentPayment?.billingMonth} />
            <Field label="Amount" value={currentPayment ? `${currentPayment.amountEgp} EGP` : null} />
            <Field label="Payment status" value={<PaymentBadge status={currentPayment?.status} />} />
            <Field label="Subscription" value={<SubscriptionBadge status={student.subscriptionStatus} display={student.subscriptionDisplayStatus} />} />
            <Field label="Start" value={student.subscriptionStartDate} />
            <Field label="Expiry" value={student.subscriptionExpiresAt} />
            <Field label="Days remaining" value={student.daysRemaining != null ? `${student.daysRemaining}` : null} />
          </div>
          <div className="pt-3 border-t">
            <Button size="sm" variant="outline" onClick={() => navigate(`/ballet/applications/${student.applicationId}`)}>
              Manage Payment in Application
            </Button>
          </div>
        </Section>
        <Section title="Payment History">
          {data.payments.length ? <div className="space-y-2">{data.payments.map((payment) => <div key={payment.id} className="rounded-md border p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">#{payment.id} · {payment.packageName ?? "No package"}</span><div className="flex flex-wrap gap-2"><PaymentBadge status={payment.status} /><SubscriptionBadge status={payment.subscriptionStatus} display={payment.subscriptionDisplayStatus} /></div></div><p className="mt-1 text-xs text-muted-foreground">{payment.amountEgp} EGP · {payment.billingMonth ?? "No billing month"} · {payment.paymentMethod ?? "No method"} · {payment.subscriptionStartDate ?? "No start"} → {payment.subscriptionExpiresAt ?? "No expiry"} · {new Date(payment.updatedAt).toLocaleString()}</p>{payment.extensionHistory.map((extension, index) => <p key={`${payment.id}-${index}`} className="text-xs text-muted-foreground">Extended {extension.previousExpiresAt} → {extension.newExpiresAt} (+{extension.daysAdded}d) · {extension.reason}</p>)}</div>)}</div> : <p className="text-sm italic text-muted-foreground">No payment history recorded yet.</p>}
        </Section>
        <Section title="Enrollment History">
          {data.enrollmentHistory.length ? (
            <div className="space-y-2">
              {data.enrollmentHistory.map((entry) => (
                <div key={entry.assignmentId} className="rounded-md border p-3 text-sm">
                  <div className="font-medium">Assignment #{entry.assignmentId} · {entry.levelName ?? "No level"} · {entry.assignmentStatus}</div>
                  <p className="text-xs text-muted-foreground">
                    {entry.groupName ?? "No group"} · Application #{entry.applicationId} ({entry.applicationStatus}) · {entry.enrolledAt ? new Date(entry.enrolledAt).toLocaleString() : "No date"}
                  </p>
                </div>
              ))}
            </div>
          ) : <p className="text-sm italic text-muted-foreground">No enrollment history recorded yet.</p>}
        </Section>
        <Section title="Attendance"><Field label="Billing month" value={data.attendanceSummary?.billingMonth} /><Field label="Monthly hours" value={data.attendanceSummary?.monthlyHours} /><Field label="Attended hours" value={data.attendanceSummary?.attendedHours} /><Field label="Absent hours" value={data.attendanceSummary?.absentHours} /><Field label="Consumed hours" value={data.attendanceSummary?.consumedHours} /><Field label="Remaining hours" value={data.attendanceSummary?.remainingHours} /></Section>
        <Section title="Attendance History">{data.attendanceHistory.length ? <div className="space-y-2">{data.attendanceHistory.map((row) => <div key={row.id} className="rounded-md border p-3 text-sm"><div className="font-medium">{row.classDate ?? "—"} · {row.status} · {row.durationMinutes ?? "—"} min</div>{row.notes && <p className="text-xs text-muted-foreground">{row.notes}</p>}</div>)}</div> : <p className="text-sm italic text-muted-foreground">No attendance recorded yet.</p>}</Section>
      </div>
    </div>
  );
}
