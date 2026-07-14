import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ChevronLeft, Download, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const API_BASE = import.meta.env.VITE_API_URL as string | undefined ?? "";
const API_KEY = import.meta.env.VITE_API_KEY as string | undefined ?? "";
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function makeHeaders(token: string | null): HeadersInit {
  return { "Content-Type": "application/json", ...(API_KEY ? { "x-api-key": API_KEY } : {}), ...(token ? { "x-admin-token": token } : {}) };
}

interface DetailResponse {
  student: {
    assignmentId: number;
    applicationId: number;
    applicationStatus: string;
    studentStage: "Pending Payment" | "Active" | "Renewed" | "Expired";
    childId: number | null;
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
  groupSchedules: { id: number; dayOfWeek: number; startTime: string; endTime: string; status: string; classTitle: string | null; instructorName: string | null }[];
  attendanceSummary: { billingMonth: string; monthlyHours: number | null; attendedHours: number; absentHours: number; consumedHours: number; remainingHours: number | null; hasActiveSubscription: boolean } | null;
  attendanceHistory: { id: number; classDate: string | null; status: string; durationMinutes: number | null; notes: string | null; balletScheduleId: number | null; createdAt: string }[];
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
  return <div className="rounded-lg border bg-card p-5 space-y-3"><h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{title}</h3>{children}</div>;
}
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="grid grid-cols-[150px_1fr] gap-2 text-sm"><span className="text-muted-foreground">{label}</span><span>{value ?? <span className="italic text-muted-foreground">—</span>}</span></div>;
}
function StageBadge({ stage }: { stage: DetailResponse["student"]["studentStage"] }) {
  const className = stage === "Active" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : stage === "Renewed" ? "bg-cyan-500/15 text-cyan-400 border-cyan-500/30" : stage === "Expired" ? "bg-red-500/15 text-red-400 border-red-500/30" : "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
  return <Badge variant="outline" className={className}>{stage}</Badge>;
}

export default function BalletStudentDetailPage() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const { token } = useAdminAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [renewPackageId, setRenewPackageId] = useState("");
  const [renewAmount, setRenewAmount] = useState("");
  const [renewMethod, setRenewMethod] = useState("");
  const [renewStatus, setRenewStatus] = useState("pending");
  const [renewStartDate, setRenewStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [renewExpiresAt, setRenewExpiresAt] = useState(() => addDays(new Date().toISOString().slice(0, 10), 30));
  const [extensionDays, setExtensionDays] = useState("");
  const [extensionReason, setExtensionReason] = useState("studio_holiday");
  const [extensionNote, setExtensionNote] = useState("");
  const [confirmExpiredExtension, setConfirmExpiredExtension] = useState(false);
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

  const renewMutation = useMutation({
    mutationFn: async (payment: BalletPayment) => {
      const res = await fetch(`${API_BASE}/api/admin/ballet/applications/${data!.student.applicationId}/subscriptions/renew`, {
        method: "POST",
        headers: makeHeaders(token),
        body: JSON.stringify({
          renewedFromId: payment.id,
          packageId: parseInt(renewPackageId || String(payment.packageId ?? ""), 10),
          amountEgp: parseInt(renewAmount || String(payment.amountEgp), 10),
          paymentMethod: renewMethod || payment.paymentMethod || data!.student.preferredPaymentMethod,
          status: renewStatus,
          startDate: renewStartDate,
          expiresAt: renewExpiresAt,
          billingMonth: payment.billingMonth ?? undefined,
        }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Failed to renew subscription");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Subscription renewed" });
      queryClient.invalidateQueries({ queryKey: ["ballet-student", id] });
      queryClient.invalidateQueries({ queryKey: ["ballet-students"] });
    },
    onError: (e: Error) => toast({ title: "Renewal failed", description: e.message, variant: "destructive" }),
  });

  const extendMutation = useMutation({
    mutationFn: async (payment: BalletPayment) => {
      const res = await fetch(`${API_BASE}/api/admin/ballet/applications/${data!.student.applicationId}/payments/${payment.id}/extend`, {
        method: "PATCH",
        headers: makeHeaders(token),
        body: JSON.stringify({
          additionalDays: parseInt(extensionDays, 10),
          reason: extensionReason,
          note: extensionNote || null,
          confirmExpiredExtension,
        }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Failed to extend subscription");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Subscription extended" });
      setExtensionDays("");
      setExtensionNote("");
      setConfirmExpiredExtension(false);
      queryClient.invalidateQueries({ queryKey: ["ballet-student", id] });
      queryClient.invalidateQueries({ queryKey: ["ballet-students"] });
    },
    onError: (e: Error) => toast({ title: "Extension failed", description: e.message, variant: "destructive" }),
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
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/ballet/students")} className="mt-1 -ml-2 text-muted-foreground"><ChevronLeft className="mr-1 h-4 w-4" /> Back</Button>
        <div className="flex-1">
          <PageHeader title={`${student.studentName} — Ballet Student`} description={`Application #${student.applicationId} · Assignment #${student.assignmentId}`} mode="stage">
            <div className="flex flex-wrap gap-2"><StageBadge stage={student.studentStage} /><Button variant="outline" size="sm" onClick={() => navigate(`/ballet/applications/${student.applicationId}`)}><FileText className="mr-2 h-3.5 w-3.5" />Open Application</Button><Button variant="outline" size="sm" onClick={handleExportPdf} disabled={isExportingPdf}>{isExportingPdf ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-2 h-3.5 w-3.5" />}Export PDF</Button></div>
          </PageHeader>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="Student"><Field label="Name" value={student.studentName} /><Field label="Birthday" value={student.birthday} /><Field label="Age" value={student.age != null ? `${student.age} years` : null} /><Field label="Gender" value={student.gender} /><Field label="Date joined" value={student.dateJoined ? new Date(student.dateJoined).toLocaleString() : null} /><Field label="Child profile ID" value={student.childId != null ? `#${student.childId}` : null} /></Section>
        <Section title="Parent"><Field label="Name" value={student.parentName} /><Field label="Phone" value={student.parentPhone} /><Field label="Email" value={student.parentEmail} /><Field label="Emergency contact" value={[student.emergencyContactName, student.emergencyContactPhone].filter(Boolean).join(" · ") || null} /></Section>
        <Section title="Enrollment"><Field label="Application ID" value={`#${student.applicationId}`} /><Field label="Application status" value={student.applicationStatus} /><Field label="Student stage" value={<StageBadge stage={student.studentStage} />} /><Field label="Level" value={student.levelName} /><Field label="Group" value={student.groupName} /><Field label="Class schedules" value={data.groupSchedules.length ? data.groupSchedules.map((s) => `${s.classTitle ?? "Class"}: ${DAY_NAMES[s.dayOfWeek] ?? "?"} ${s.startTime}-${s.endTime}`).join("; ") : null} /><Field label="Instructor" value={data.groupSchedules.map((s) => s.instructorName).filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join(", ") || null} /></Section>
        <Section title="Payment"><Field label="Preferred method" value={student.preferredPaymentMethod} /><Field label="Actual method" value={currentPayment?.paymentMethod} /><Field label="Package" value={currentPayment?.packageName} /><Field label="Billing month" value={currentPayment?.billingMonth} /><Field label="Amount" value={currentPayment ? `${currentPayment.amountEgp} EGP` : null} /><Field label="Payment status" value={currentPayment?.status} /><Field label="Subscription" value={student.subscriptionDisplayStatus} /><Field label="Start" value={student.subscriptionStartDate} /><Field label="Expiry" value={student.subscriptionExpiresAt} /><Field label="Days remaining" value={student.daysRemaining != null ? `${student.daysRemaining}` : null} />
          {currentPayment && <div className="pt-3 space-y-2 border-t">
            <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Renew Subscription</h4>
            <div className="grid grid-cols-2 gap-2">
              <input className="h-8 rounded-md border bg-background px-2 text-sm" type="number" placeholder="Package ID" value={renewPackageId} onChange={(e) => setRenewPackageId(e.target.value)} />
              <input className="h-8 rounded-md border bg-background px-2 text-sm" type="number" placeholder="Amount EGP" value={renewAmount} onChange={(e) => setRenewAmount(e.target.value)} />
              <input className="h-8 rounded-md border bg-background px-2 text-sm" placeholder="Method" value={renewMethod} onChange={(e) => setRenewMethod(e.target.value)} />
              <select className="h-8 rounded-md border bg-background px-2 text-sm" value={renewStatus} onChange={(e) => setRenewStatus(e.target.value)}><option value="pending">Pending</option><option value="paid">Paid</option><option value="rejected">Rejected</option><option value="refunded">Refunded</option></select>
              <input className="h-8 rounded-md border bg-background px-2 text-sm" type="date" value={renewStartDate} onChange={(e) => { setRenewStartDate(e.target.value); setRenewExpiresAt(addDays(e.target.value, 30)); }} />
              <input className="h-8 rounded-md border bg-background px-2 text-sm" type="date" value={renewExpiresAt} onChange={(e) => setRenewExpiresAt(e.target.value)} />
            </div>
            <Button size="sm" variant="outline" disabled={renewMutation.isPending} onClick={() => renewMutation.mutate(currentPayment)}>{renewMutation.isPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}Renew Subscription</Button>
          </div>}
          {currentPayment?.subscriptionExpiresAt && <div className="pt-3 space-y-2 border-t">
            <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Extend Subscription</h4>
            <Field label="Current expiry" value={currentPayment.subscriptionExpiresAt} />
            <div className="grid grid-cols-2 gap-2">
              <input className="h-8 rounded-md border bg-background px-2 text-sm" type="number" min={1} placeholder="Additional days" value={extensionDays} onChange={(e) => setExtensionDays(e.target.value)} />
              <select className="h-8 rounded-md border bg-background px-2 text-sm" value={extensionReason} onChange={(e) => setExtensionReason(e.target.value)}><option value="studio_holiday">Studio holiday</option><option value="emergency_closure">Emergency closure</option><option value="class_suspension">Class suspension</option><option value="instructor_unavailability">Instructor unavailability</option><option value="other">Other</option></select>
            </div>
            <textarea className="w-full min-h-[58px] rounded-md border bg-background px-2 py-1 text-sm" placeholder="Internal note (optional)" value={extensionNote} onChange={(e) => setExtensionNote(e.target.value)} />
            {currentPayment.subscriptionStatus === "expired" && <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={confirmExpiredExtension} onChange={(e) => setConfirmExpiredExtension(e.target.checked)} />Confirm extending expired subscription</label>}
            <Button size="sm" variant="outline" disabled={!extensionDays || extendMutation.isPending} onClick={() => extendMutation.mutate(currentPayment)}>{extendMutation.isPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}Extend Subscription</Button>
          </div>}
          {data.payments.length > 1 && <div className="pt-2 space-y-2"><h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Payment History</h4>{data.payments.map((payment) => <div key={payment.id} className="rounded-md border p-3 text-sm"><div className="font-medium">#{payment.id} · {payment.packageName ?? "No package"} · {payment.status} · {payment.subscriptionDisplayStatus}</div><p className="text-xs text-muted-foreground">{payment.amountEgp} EGP · {payment.billingMonth ?? "No billing month"} · {payment.paymentMethod ?? "No method"} · {payment.subscriptionStartDate ?? "No start"} → {payment.subscriptionExpiresAt ?? "No expiry"} · {new Date(payment.updatedAt).toLocaleString()}</p>{payment.extensionHistory.map((extension, index) => <p key={`${payment.id}-${index}`} className="text-xs text-muted-foreground">Extended {extension.previousExpiresAt} → {extension.newExpiresAt} (+{extension.daysAdded}d) · {extension.reason}</p>)}</div>)}</div>}</Section>
        <Section title="Attendance"><Field label="Billing month" value={data.attendanceSummary?.billingMonth} /><Field label="Monthly hours" value={data.attendanceSummary?.monthlyHours} /><Field label="Attended hours" value={data.attendanceSummary?.attendedHours} /><Field label="Absent hours" value={data.attendanceSummary?.absentHours} /><Field label="Consumed hours" value={data.attendanceSummary?.consumedHours} /><Field label="Remaining hours" value={data.attendanceSummary?.remainingHours} /></Section>
        <Section title="Attendance History">{data.attendanceHistory.length ? <div className="space-y-2">{data.attendanceHistory.map((row) => <div key={row.id} className="rounded-md border p-3 text-sm"><div className="font-medium">{row.classDate ?? "—"} · {row.status} · {row.durationMinutes ?? "—"} min</div>{row.notes && <p className="text-xs text-muted-foreground">{row.notes}</p>}</div>)}</div> : <p className="text-sm italic text-muted-foreground">No attendance recorded yet.</p>}</Section>
      </div>
    </div>
  );
}
