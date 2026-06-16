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
import { Loader2, ChevronLeft, Clock, User, ArrowRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Application {
  id: number;
  parentName: string;
  parentPhone: string;
  parentEmail: string;
  parentStudentId: number | null;
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

interface DetailResponse {
  application: Application;
  slot: Slot | null;
  level: Level | null;
  events: Event[];
}

interface LevelsResponse {
  levels: Level[];
}

// ─── Status config ────────────────────────────────────────────────────────────

const ALL_STATUSES = [
  { value: "submitted",         label: "Submitted" },
  { value: "pendingAssessment", label: "Pending Assessment" },
  { value: "accepted",          label: "Accepted" },
  { value: "rejected",          label: "Rejected" },
  { value: "needsFollowUp",     label: "Needs Follow-up" },
  { value: "assignedToLevel",   label: "Assigned to Level" },
  { value: "activeBallet",      label: "Active Ballet" },
];

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  submitted:         { label: "Submitted",          className: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  pendingAssessment: { label: "Pending Assessment", className: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
  accepted:          { label: "Accepted",           className: "bg-green-500/15 text-green-400 border-green-500/30" },
  rejected:          { label: "Rejected",           className: "bg-red-500/15 text-red-400 border-red-500/30" },
  needsFollowUp:     { label: "Needs Follow-up",    className: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" },
  assignedToLevel:   { label: "Assigned to Level",  className: "bg-purple-500/15 text-purple-400 border-purple-500/30" },
  activeBallet:      { label: "Active",             className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
};

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
  const { token } = useAdminAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [newStatus, setNewStatus]       = useState("");
  const [statusNote, setStatusNote]     = useState("");
  const [newLevelId, setNewLevelId]     = useState("");
  const [levelNote, setLevelNote]       = useState("");

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
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

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

  const { application: app, slot, level, events } = data;
  const levels = levelsData?.levels ?? [];

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
            <StatusBadge status={app.status} />
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

          {/* Assigned level (if any) */}
          {(level || app.assignedLevelId) && (
            <Section title="Assigned Level">
              <Field label="Level"       value={level?.name ?? `ID ${app.assignedLevelId}`} />
              <Field label="Assigned at" value={app.assignedAt ? new Date(app.assignedAt).toLocaleString() : null} />
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
          <div className="rounded-lg border bg-card p-5 space-y-4">
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
                {ALL_STATUSES.filter((s) => s.value !== app.status).map((s) => (
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
              style={{ background: "#8A5CFF", color: "#fff" }}
              className="w-full"
            >
              {statusMutation.isPending ? (
                <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Saving…</>
              ) : "Update Status"}
            </Button>
          </div>

          {/* Level assignment */}
          {levels.length > 0 && (
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
                style={{ background: "#8A5CFF", color: "#fff" }}
                className="w-full"
              >
                {levelMutation.isPending ? (
                  <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Assigning…</>
                ) : "Assign Level"}
              </Button>
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
                      style={{ background: "#8A5CFF" }}
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
