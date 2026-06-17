/**
 * Ballet → Assessment Slots
 *
 * Lists all assessment slots with live booked count.
 * Admins can create new slots, edit existing ones (date/time/capacity/notes),
 * and toggle active/inactive status.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, CalendarDays, Pencil, ToggleLeft, ToggleRight, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAdminAuth } from "@/contexts/AdminAuthContext";

const API     = import.meta.env.VITE_API_URL ?? "";
const API_KEY = (import.meta.env.VITE_API_KEY as string | undefined) ?? "";

/** Same pattern as ApplicationsPage — sends x-admin-token JWT, not Bearer. */
function makeHeaders(token: string | null): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(API_KEY ? { "x-api-key": API_KEY } : {}),
    ...(token   ? { "x-admin-token": token } : {}),
  };
}

async function adminFetch<T>(url: string, init: RequestInit, token: string | null): Promise<T> {
  const res = await fetch(url, { ...init, headers: makeHeaders(token) });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw { data };
  }
  return res.json() as Promise<T>;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Slot {
  id: number;
  date: string;
  startTime: string;
  endTime: string;
  capacity: number;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  bookedCount: number;
}

interface SlotForm {
  date: string;
  startTime: string;
  endTime: string;
  capacity: string;
  notes: string;
  isActive: boolean;
}

const EMPTY_FORM: SlotForm = {
  date: "",
  startTime: "",
  endTime: "",
  capacity: "10",
  notes: "",
  isActive: true,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function dayLabel(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  return DAY_NAMES[d.getUTCDay()] ?? "";
}

function availabilityBadge(slot: Slot) {
  const available = slot.capacity - slot.bookedCount;
  if (!slot.isActive) return <Badge variant="outline" className="text-muted-foreground">Inactive</Badge>;
  if (available <= 0)  return <Badge className="bg-red-500/20 text-red-400">Full</Badge>;
  if (available <= 3)  return <Badge className="bg-amber-500/20 text-amber-400">{available} left</Badge>;
  return <Badge className="bg-green-500/20 text-green-400">Available</Badge>;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AssessmentSlotsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { token } = useAdminAuth();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSlot, setEditingSlot] = useState<Slot | null>(null);
  const [form, setForm] = useState<SlotForm>(EMPTY_FORM);

  // ── Data ────────────────────────────────────────────────────────────────────

  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-ballet-slots", token],
    queryFn: () => adminFetch<{ slots: Slot[] }>(`${API}/api/admin/ballet/slots`, {}, token),
    refetchOnWindowFocus: false,
  });

  const slots = data?.slots ?? [];

  // ── Mutations ───────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (body: object) =>
      adminFetch(`${API}/api/admin/ballet/slots`, { method: "POST", body: JSON.stringify(body) }, token),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-ballet-slots"] });
      toast({ title: "Slot created" });
      closeDialog();
    },
    onError: (e: any) => toast({ title: "Error", description: e?.data?.error ?? "Failed to create slot", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) =>
      adminFetch(`${API}/api/admin/ballet/slots/${id}`, { method: "PATCH", body: JSON.stringify(body) }, token),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-ballet-slots"] });
      toast({ title: "Slot updated" });
      closeDialog();
    },
    onError: (e: any) => toast({ title: "Error", description: e?.data?.error ?? "Failed to update slot", variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      adminFetch(`${API}/api/admin/ballet/slots/${id}`, { method: "PATCH", body: JSON.stringify({ isActive }) }, token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-ballet-slots"] }),
    onError: (e: any) => toast({ title: "Error", description: e?.data?.error ?? "Failed to update slot", variant: "destructive" }),
  });

  // ── Dialog helpers ──────────────────────────────────────────────────────────

  function openCreate() {
    setEditingSlot(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(slot: Slot) {
    setEditingSlot(slot);
    setForm({
      date:      slot.date,
      startTime: slot.startTime,
      endTime:   slot.endTime,
      capacity:  String(slot.capacity),
      notes:     slot.notes ?? "",
      isActive:  slot.isActive,
    });
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingSlot(null);
    setForm(EMPTY_FORM);
  }

  function handleSubmit() {
    const capacity = parseInt(form.capacity, 10);
    if (!form.date || !form.startTime || !form.endTime) {
      toast({ title: "Required", description: "Date, start time, and end time are required.", variant: "destructive" });
      return;
    }
    if (isNaN(capacity) || capacity < 1) {
      toast({ title: "Invalid", description: "Capacity must be a positive number.", variant: "destructive" });
      return;
    }
    const body = {
      date:      form.date,
      startTime: form.startTime,
      endTime:   form.endTime,
      capacity,
      notes:     form.notes.trim() || null,
      isActive:  form.isActive,
    };
    if (editingSlot) {
      updateMutation.mutate({ id: editingSlot.id, body });
    } else {
      createMutation.mutate(body);
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Assessment Slots</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage available ballet assessment appointment slots.
          </p>
        </div>
        <Button onClick={openCreate} className="bg-[#8A5CFF] hover:bg-[#7A4CEF] text-white gap-2">
          <Plus className="h-4 w-4" />
          New Slot
        </Button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-[#8A5CFF]" />
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-red-400">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span className="text-sm">Failed to load slots. Please refresh.</span>
        </div>
      )}

      {/* Empty */}
      {!isLoading && !isError && slots.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
          <div className="rounded-full bg-[#8A5CFF]/10 p-4">
            <CalendarDays className="h-8 w-8 text-[#8A5CFF]" />
          </div>
          <p className="text-sm text-muted-foreground">No assessment slots yet. Create your first one.</p>
        </div>
      )}

      {/* Slots table */}
      {!isLoading && slots.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/30">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Date</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Time</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Booked</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Notes</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {slots.map((slot) => (
                <tr key={slot.id} className="border-b border-border last:border-0 hover:bg-muted/10 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-white">{slot.date}</div>
                    <div className="text-xs text-muted-foreground">{dayLabel(slot.date)}</div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {slot.startTime} – {slot.endTime}
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-white">{slot.bookedCount}</span>
                    <span className="text-muted-foreground"> / {slot.capacity}</span>
                  </td>
                  <td className="px-4 py-3">{availabilityBadge(slot)}</td>
                  <td className="px-4 py-3 text-muted-foreground max-w-[200px] truncate">
                    {slot.notes ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-white"
                        onClick={() => openEdit(slot)}
                        title="Edit slot"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className={`h-8 w-8 p-0 ${slot.isActive ? "text-green-400 hover:text-green-300" : "text-muted-foreground hover:text-white"}`}
                        onClick={() => toggleMutation.mutate({ id: slot.id, isActive: !slot.isActive })}
                        title={slot.isActive ? "Deactivate slot" : "Activate slot"}
                        disabled={toggleMutation.isPending}
                      >
                        {slot.isActive
                          ? <ToggleRight className="h-4 w-4" />
                          : <ToggleLeft className="h-4 w-4" />}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) closeDialog(); }}>
        <DialogContent className="bg-[#0F1923] border-border text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">{editingSlot ? "Edit Slot" : "New Assessment Slot"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">Date <span className="text-red-400">*</span></Label>
              <Input
                type="date"
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                className="bg-[#1A2535] border-border text-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-muted-foreground">Start Time <span className="text-red-400">*</span></Label>
                <Input
                  value={form.startTime}
                  onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))}
                  placeholder="10:00 AM"
                  className="bg-[#1A2535] border-border text-white"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-muted-foreground">End Time <span className="text-red-400">*</span></Label>
                <Input
                  value={form.endTime}
                  onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))}
                  placeholder="10:30 AM"
                  className="bg-[#1A2535] border-border text-white"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-muted-foreground">Capacity</Label>
              <Input
                type="number"
                min={1}
                value={form.capacity}
                onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))}
                className="bg-[#1A2535] border-border text-white"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-muted-foreground">Notes</Label>
              <Textarea
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Optional notes for this slot"
                rows={2}
                className="bg-[#1A2535] border-border text-white resize-none"
              />
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, isActive: !f.isActive }))}
                className={`flex items-center gap-2 text-sm transition-colors ${form.isActive ? "text-green-400" : "text-muted-foreground"}`}
              >
                {form.isActive ? <ToggleRight className="h-5 w-5" /> : <ToggleLeft className="h-5 w-5" />}
                {form.isActive ? "Active (visible to parents)" : "Inactive (hidden from parents)"}
              </button>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={isSaving} className="border-border text-muted-foreground hover:text-white">
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isSaving}
              className="bg-[#8A5CFF] hover:bg-[#7A4CEF] text-white"
            >
              {isSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {editingSlot ? "Save Changes" : "Create Slot"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
