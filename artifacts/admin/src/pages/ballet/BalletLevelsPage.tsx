/**
 * Ballet → Levels
 *
 * Lists all ballet levels with their sort order and active status.
 * Admins can add new levels, rename existing ones, adjust sort order,
 * and toggle active/inactive.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, ToggleLeft, ToggleRight, Loader2, AlertCircle, GripVertical } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAdminAuth } from "@/contexts/AdminAuthContext";

const API     = import.meta.env.VITE_API_URL ?? "";
const API_KEY = (import.meta.env.VITE_API_KEY as string | undefined) ?? "";

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

interface Level {
  id: number;
  name: string;
  sortOrder: number;
  isActive: boolean;
  description: string | null;
  requirements: string | null;
  ageMin: number | null;
  ageMax: number | null;
  totalStudents: number;
  createdAt: string;
}

interface LevelForm {
  name: string;
  sortOrder: string;
  isActive: boolean;
  description: string;
  requirements: string;
  ageMin: string;
  ageMax: string;
}

const EMPTY_FORM: LevelForm = { name: "", sortOrder: "0", isActive: true, description: "", requirements: "", ageMin: "", ageMax: "" };

function formatAgeRange(level: Level) {
  if (level.ageMin == null || level.ageMax == null) return "Not Set";
  return `${level.ageMin} - ${level.ageMax} years`;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BalletLevelsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { token, can } = useAdminAuth();
  const canEdit = can("ballet.levels", "edit");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLevel, setEditingLevel] = useState<Level | null>(null);
  const [form, setForm] = useState<LevelForm>(EMPTY_FORM);

  // ── Data ────────────────────────────────────────────────────────────────────

  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-ballet-levels", token],
    queryFn: () => adminFetch<{ levels: Level[] }>(`${API}/api/admin/ballet/levels`, {}, token),
    refetchOnWindowFocus: false,
  });

  const levels = data?.levels ?? [];

  // ── Mutations ───────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (body: object) =>
      adminFetch(`${API}/api/admin/ballet/levels`, { method: "POST", body: JSON.stringify(body) }, token),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-ballet-levels"] });
      toast({ title: "Level created" });
      closeDialog();
    },
    onError: (e: any) =>
      toast({ title: "Error", description: e?.data?.error ?? "Failed to create level", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) =>
      adminFetch(`${API}/api/admin/ballet/levels/${id}`, { method: "PATCH", body: JSON.stringify(body) }, token),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-ballet-levels"] });
      toast({ title: "Level updated" });
      closeDialog();
    },
    onError: (e: any) =>
      toast({ title: "Error", description: e?.data?.error ?? "Failed to update level", variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      adminFetch(`${API}/api/admin/ballet/levels/${id}`, { method: "PATCH", body: JSON.stringify({ isActive }) }, token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-ballet-levels"] }),
    onError: (e: any) =>
      toast({ title: "Error", description: e?.data?.error ?? "Failed to update level", variant: "destructive" }),
  });

  // ── Dialog helpers ──────────────────────────────────────────────────────────

  function openCreate() {
    // Default sort order = max + 10
    const maxSort = levels.reduce((m, l) => Math.max(m, l.sortOrder), 0);
    setEditingLevel(null);
    setForm({ ...EMPTY_FORM, sortOrder: String(maxSort + 10) });
    setDialogOpen(true);
  }

  function openEdit(level: Level) {
    setEditingLevel(level);
    setForm({
      name:         level.name,
      sortOrder:    String(level.sortOrder),
      isActive:     level.isActive,
      description:  level.description ?? "",
      requirements: level.requirements ?? "",
      ageMin:       level.ageMin != null ? String(level.ageMin) : "",
      ageMax:       level.ageMax != null ? String(level.ageMax) : "",
    });
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingLevel(null);
    setForm(EMPTY_FORM);
  }

  function handleSubmit() {
    if (!form.name.trim()) {
      toast({ title: "Required", description: "Level name is required.", variant: "destructive" });
      return;
    }
    const sortOrder = parseInt(form.sortOrder, 10);
    const ageMin = parseInt(form.ageMin, 10);
    const ageMax = parseInt(form.ageMax, 10);
    if (!isNaN(ageMin) && !isNaN(ageMax) && ageMin > ageMax) {
      toast({ title: "Invalid age range", description: "Age Min cannot be greater than Age Max.", variant: "destructive" });
      return;
    }
    const body = {
      name:      form.name.trim(),
      sortOrder: isNaN(sortOrder) ? 0 : sortOrder,
      isActive:  form.isActive,
      description:  form.description.trim(),
      requirements: form.requirements.trim(),
      // Age fields are optional — omit when blank so they aren't sent as 0.
      ...(isNaN(ageMin) ? {} : { ageMin }),
      ...(isNaN(ageMax) ? {} : { ageMax }),
    };
    if (editingLevel) {
      updateMutation.mutate({ id: editingLevel.id, body });
    } else {
      createMutation.mutate(body);
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-white">Ballet Levels</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage ballet level definitions, progression order, and visibility.
          </p>
        </div>
        {canEdit && (
          <Button onClick={openCreate} className="bg-[#00B6D6] hover:bg-[#0097B2] text-white gap-2 self-start shrink-0 sm:self-auto">
            <Plus className="h-4 w-4" />
            New Level
          </Button>
        )}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-[#00B6D6]" />
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-red-400">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span className="text-sm">Failed to load levels. Please refresh.</span>
        </div>
      )}

      {/* Empty */}
      {!isLoading && !isError && levels.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
          <div className="rounded-full bg-[#00B6D6]/10 p-4">
            <GripVertical className="h-8 w-8 text-[#00B6D6]" />
          </div>
          <p className="text-sm text-muted-foreground">No ballet levels found. Add your first level.</p>
        </div>
      )}

      {/* Levels list */}
      {!isLoading && levels.length > 0 && (
        <div className="rounded-lg border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/30">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-16">Order</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Level Name</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Age Range</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Total Students</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {levels.map((level) => (
                <tr key={level.id} className="border-b border-border last:border-0 hover:bg-muted/10 transition-colors">
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{level.sortOrder}</td>
                  <td className="px-4 py-3">
                    <span className={`font-medium ${level.isActive ? "text-white" : "text-muted-foreground line-through"}`}>
                      {level.name}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{formatAgeRange(level)}</td>
                  <td className="px-4 py-3 text-muted-foreground font-medium">{level.totalStudents}</td>
                  <td className="px-4 py-3">
                    {level.isActive
                      ? <Badge className="bg-green-500/20 text-green-400">Active</Badge>
                      : <Badge variant="outline" className="text-muted-foreground">Inactive</Badge>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {canEdit && <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-white"
                        onClick={() => openEdit(level)}
                        title="Edit level"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>}
                      {canEdit && <Button
                        size="sm"
                        variant="ghost"
                        className={`h-8 w-8 p-0 ${level.isActive ? "text-green-400 hover:text-green-300" : "text-muted-foreground hover:text-white"}`}
                        onClick={() => toggleMutation.mutate({ id: level.id, isActive: !level.isActive })}
                        title={level.isActive ? "Deactivate level" : "Activate level"}
                        disabled={toggleMutation.isPending}
                      >
                        {level.isActive
                          ? <ToggleRight className="h-4 w-4" />
                          : <ToggleLeft className="h-4 w-4" />}
                      </Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={canEdit && dialogOpen} onOpenChange={(o) => { if (!o) closeDialog(); }}>
        <DialogContent className="bg-[#0F1923] border-border text-white max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white">{editingLevel ? "Edit Level" : "New Ballet Level"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">Level Name <span className="text-red-400">*</span></Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Ballet Level 1"
                className="bg-[#1A2535] border-border text-white"
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-muted-foreground">Sort Order</Label>
              <Input
                type="number"
                min={0}
                value={form.sortOrder}
                onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))}
                className="bg-[#1A2535] border-border text-white"
              />
              <p className="text-xs text-muted-foreground">Lower numbers appear first in lists.</p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-muted-foreground">Description</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Short summary of what this level covers"
                className="bg-[#1A2535] border-border text-white min-h-[70px]"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-muted-foreground">Requirements</Label>
              <Textarea
                value={form.requirements}
                onChange={(e) => setForm((f) => ({ ...f, requirements: e.target.value }))}
                placeholder="Prerequisites or expectations for this level"
                className="bg-[#1A2535] border-border text-white min-h-[70px]"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-muted-foreground">Age Min</Label>
                <Input
                  type="number"
                  min={4}
                  max={14}
                  value={form.ageMin}
                  onChange={(e) => setForm((f) => ({ ...f, ageMin: e.target.value }))}
                  placeholder="4"
                  className="bg-[#1A2535] border-border text-white"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-muted-foreground">Age Max</Label>
                <Input
                  type="number"
                  min={4}
                  max={14}
                  value={form.ageMax}
                  onChange={(e) => setForm((f) => ({ ...f, ageMax: e.target.value }))}
                  placeholder="14"
                  className="bg-[#1A2535] border-border text-white"
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, isActive: !f.isActive }))}
                className={`flex items-center gap-2 text-sm transition-colors ${form.isActive ? "text-green-400" : "text-muted-foreground"}`}
              >
                {form.isActive ? <ToggleRight className="h-5 w-5" /> : <ToggleLeft className="h-5 w-5" />}
                {form.isActive ? "Active (available for assignment)" : "Inactive (hidden from dropdown)"}
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
              className="bg-[#00B6D6] hover:bg-[#0097B2] text-white"
            >
              {isSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {editingLevel ? "Save Changes" : "Create Level"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
