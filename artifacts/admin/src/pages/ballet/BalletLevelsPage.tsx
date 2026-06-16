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
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { customFetch } from "@workspace/api-client-react";

const API = import.meta.env.VITE_API_URL ?? "";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Level {
  id: number;
  name: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
}

interface LevelForm {
  name: string;
  sortOrder: string;
  isActive: boolean;
}

const EMPTY_FORM: LevelForm = { name: "", sortOrder: "0", isActive: true };

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BalletLevelsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLevel, setEditingLevel] = useState<Level | null>(null);
  const [form, setForm] = useState<LevelForm>(EMPTY_FORM);

  // ── Data ────────────────────────────────────────────────────────────────────

  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-ballet-levels"],
    queryFn: () => customFetch<{ levels: Level[] }>(`${API}/api/admin/ballet/levels`),
    refetchOnWindowFocus: false,
  });

  const levels = data?.levels ?? [];

  // ── Mutations ───────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (body: object) =>
      customFetch(`${API}/api/admin/ballet/levels`, { method: "POST", body: JSON.stringify(body) }),
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
      customFetch(`${API}/api/admin/ballet/levels/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
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
      customFetch(`${API}/api/admin/ballet/levels/${id}`, { method: "PATCH", body: JSON.stringify({ isActive }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-ballet-levels"] }),
    onError: (e: any) =>
      toast({ title: "Error", description: e?.data?.error ?? "Failed to update level", variant: "destructive" }),
  });

  // ── Dialog helpers ──────────────────────────────────────────────────────────

  function openCreate() {
    // Default sort order = max + 10
    const maxSort = levels.reduce((m, l) => Math.max(m, l.sortOrder), 0);
    setEditingLevel(null);
    setForm({ name: "", sortOrder: String(maxSort + 10), isActive: true });
    setDialogOpen(true);
  }

  function openEdit(level: Level) {
    setEditingLevel(level);
    setForm({ name: level.name, sortOrder: String(level.sortOrder), isActive: level.isActive });
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
    const body = {
      name:      form.name.trim(),
      sortOrder: isNaN(sortOrder) ? 0 : sortOrder,
      isActive:  form.isActive,
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Ballet Levels</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage ballet level definitions, progression order, and visibility.
          </p>
        </div>
        <Button onClick={openCreate} className="bg-[#8A5CFF] hover:bg-[#7A4CEF] text-white gap-2">
          <Plus className="h-4 w-4" />
          New Level
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
          <span className="text-sm">Failed to load levels. Please refresh.</span>
        </div>
      )}

      {/* Empty */}
      {!isLoading && !isError && levels.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
          <div className="rounded-full bg-[#8A5CFF]/10 p-4">
            <GripVertical className="h-8 w-8 text-[#8A5CFF]" />
          </div>
          <p className="text-sm text-muted-foreground">No ballet levels found. Add your first level.</p>
        </div>
      )}

      {/* Levels list */}
      {!isLoading && levels.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/30">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-16">Order</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Level Name</th>
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
                  <td className="px-4 py-3">
                    {level.isActive
                      ? <Badge className="bg-green-500/20 text-green-400">Active</Badge>
                      : <Badge variant="outline" className="text-muted-foreground">Inactive</Badge>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-white"
                        onClick={() => openEdit(level)}
                        title="Edit level"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
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
        <DialogContent className="bg-[#0F1923] border-border text-white max-w-sm">
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
              className="bg-[#8A5CFF] hover:bg-[#7A4CEF] text-white"
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
