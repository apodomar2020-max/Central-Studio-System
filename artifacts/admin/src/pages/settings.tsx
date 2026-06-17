/**
 * Admin → Settings
 *
 * Sections:
 *   - Dance Types  — manage the canonical list of dance categories.
 *     Changes here propagate to the Classes page category dropdown and (via
 *     the mobile API) to the student-facing Classes screen.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Pencil, Trash2, GripVertical, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/page-header";
import { useToast } from "@/hooks/use-toast";
import { useAdminAuth } from "@/contexts/AdminAuthContext";

// ─── API helpers ──────────────────────────────────────────────────────────────

const API = import.meta.env.VITE_API_URL ?? "";
const API_KEY = (import.meta.env.VITE_API_KEY as string | undefined) ?? "";

function makeHeaders(token: string | null): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(API_KEY ? { "x-api-key": API_KEY } : {}),
    ...(token ? { "x-admin-token": token } : {}),
  };
}

async function adminFetch<T>(url: string, init: RequestInit, token: string | null): Promise<T> {
  const res = await fetch(url, { ...init, headers: makeHeaders(token) });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw data;
  }
  return res.json() as Promise<T>;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface DanceType {
  id: number;
  name: string;
  slug: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Form schema ──────────────────────────────────────────────────────────────

const danceTypeSchema = z.object({
  name: z.string().min(1, "Name is required"),
  sortOrder: z.coerce.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});
type DanceTypeForm = z.input<typeof danceTypeSchema>;

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { token } = useAdminAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DanceType | null>(null);

  // ── Data ──────────────────────────────────────────────────────────────────
  const { data: danceTypes, isLoading } = useQuery<DanceType[]>({
    queryKey: ["admin-dance-types"],
    queryFn: () =>
      adminFetch<DanceType[]>(
        `${API}/api/admin/settings/dance-types`,
        { method: "GET" },
        token,
      ),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["admin-dance-types"] });

  // ── Mutations ─────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (data: DanceTypeForm) =>
      adminFetch<DanceType>(
        `${API}/api/admin/settings/dance-types`,
        { method: "POST", body: JSON.stringify(data) },
        token,
      ),
    onSuccess: () => { invalidate(); setOpen(false); toast({ title: "Dance type created" }); },
    onError: (e: { data?: { error?: string } }) =>
      toast({ title: "Error", description: e?.data?.error ?? "Failed to create", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<DanceTypeForm> }) =>
      adminFetch<DanceType>(
        `${API}/api/admin/settings/dance-types/${id}`,
        { method: "PATCH", body: JSON.stringify(data) },
        token,
      ),
    onSuccess: () => { invalidate(); setOpen(false); toast({ title: "Dance type updated" }); },
    onError: (e: { data?: { error?: string } }) =>
      toast({ title: "Error", description: e?.data?.error ?? "Failed to update", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      adminFetch<{ success: boolean }>(
        `${API}/api/admin/settings/dance-types/${id}`,
        { method: "DELETE" },
        token,
      ),
    onSuccess: () => { invalidate(); toast({ title: "Dance type deactivated" }); },
    onError: () =>
      toast({ title: "Error", description: "Failed to deactivate", variant: "destructive" }),
  });

  // ── Form ──────────────────────────────────────────────────────────────────
  const form = useForm<DanceTypeForm>({
    resolver: zodResolver(danceTypeSchema),
    defaultValues: { name: "", sortOrder: 0, isActive: true },
  });

  const openCreate = () => {
    setEditing(null);
    form.reset({ name: "", sortOrder: (danceTypes?.length ?? 0) + 1, isActive: true });
    setOpen(true);
  };

  const openEdit = (dt: DanceType) => {
    setEditing(dt);
    form.reset({ name: dt.name, sortOrder: dt.sortOrder, isActive: dt.isActive });
    setOpen(true);
  };

  const onSubmit = (values: DanceTypeForm) => {
    if (editing) {
      updateMutation.mutate({ id: editing.id, data: values });
    } else {
      createMutation.mutate(values);
    }
  };

  const handleToggleActive = (dt: DanceType) => {
    updateMutation.mutate({ id: dt.id, data: { isActive: !dt.isActive } });
  };

  const handleDelete = (id: number) => {
    if (confirm("Deactivate this dance type? It will no longer appear in the Classes dropdown.")) {
      deleteMutation.mutate(id);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-8">
      <PageHeader
        title="Settings"
        description="Manage studio-wide configuration"
        mode="studio"
        addLabel="Add Dance Type"
        addTestId="button-add-dance-type"
        onAdd={openCreate}
      />

      {/* ── Dance Types section ──────────────────────────────────────────── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Dance Types</h2>
          <p className="text-sm text-muted-foreground">
            The category list used in the Classes form and the student-facing app.
            Active types appear in dropdowns; inactive types are hidden but their
            existing classes are unaffected.
          </p>
        </div>

        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">Loading…</TableCell>
                </TableRow>
              ) : !danceTypes?.length ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    No dance types configured. Add one above to populate the Classes dropdown.
                  </TableCell>
                </TableRow>
              ) : (
                [...danceTypes]
                  .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
                  .map((dt) => (
                    <TableRow key={dt.id} data-testid={`row-dance-type-${dt.id}`}>
                      <TableCell className="text-muted-foreground">
                        <GripVertical className="h-4 w-4" />
                      </TableCell>
                      <TableCell className="font-medium">{dt.name}</TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">{dt.slug}</TableCell>
                      <TableCell>{dt.sortOrder}</TableCell>
                      <TableCell>
                        {dt.isActive ? (
                          <Badge variant="default" className="flex w-fit items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" /> Active
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="flex w-fit items-center gap-1 text-muted-foreground">
                            <XCircle className="h-3 w-3" /> Inactive
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggleActive(dt)}
                          data-testid={`button-toggle-dance-type-${dt.id}`}
                        >
                          {dt.isActive ? "Deactivate" : "Activate"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(dt)}
                          data-testid={`button-edit-dance-type-${dt.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(dt.id)}
                          data-testid={`button-delete-dance-type-${dt.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      {/* ── Create / Edit dialog ─────────────────────────────────────────── */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Dance Type" : "Add Dance Type"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input
                        data-testid="input-dance-type-name"
                        placeholder="e.g. Hip Hop"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="sortOrder"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sort Order</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        data-testid="input-dance-type-sort-order"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="isActive"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-3">
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                    <FormLabel className="!mt-0">Active</FormLabel>
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  data-testid="button-submit-dance-type"
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  {editing ? "Save Changes" : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
