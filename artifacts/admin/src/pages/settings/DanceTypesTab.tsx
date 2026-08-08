import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Pencil, Trash2, GripVertical, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import {
  API,
  adminFetch,
  danceTypeSchema,
  type DanceType,
  type DanceTypeForm,
} from "./types";

export function DanceTypesTab() {
  const { token, can } = useAdminAuth();
  const canEdit = can("settings", "edit");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DanceType | null>(null);

  // Pending uploaded SVG (file text) + flag to clear an existing stored SVG.
  const [iconSvgText, setIconSvgText] = useState<string | null>(null);
  const [iconCleared, setIconCleared] = useState(false);
  const [iconFileName, setIconFileName] = useState("");

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

  const form = useForm<DanceTypeForm>({
    resolver: zodResolver(danceTypeSchema),
    defaultValues: { name: "", description: "", color: "", iconUrl: "", coverImageUrl: "", sortOrder: 0, isActive: true },
  });

  const resetIconState = () => { setIconSvgText(null); setIconCleared(false); setIconFileName(""); };

  const openCreate = () => {
    setEditing(null);
    resetIconState();
    form.reset({ name: "", description: "", color: "", iconUrl: "", coverImageUrl: "", sortOrder: (danceTypes?.length ?? 0) + 1, isActive: true });
    setOpen(true);
  };

  const openEdit = (dt: DanceType) => {
    setEditing(dt);
    resetIconState();
    form.reset({
      name: dt.name,
      description: dt.description ?? "",
      color: dt.color ?? "",
      iconUrl: dt.iconUrl ?? "",
      coverImageUrl: dt.coverImageUrl ?? "",
      sortOrder: dt.sortOrder,
      isActive: dt.isActive,
    });
    setOpen(true);
  };

  const saveIconFor = async (id: number) => {
    if (iconSvgText) {
      await adminFetch<DanceType>(
        `${API}/api/admin/settings/dance-types/${id}/icon`,
        { method: "POST", body: JSON.stringify({ svg: iconSvgText }) },
        token,
      );
    } else if (iconCleared && editing?.hasIconSvg) {
      await adminFetch<DanceType>(
        `${API}/api/admin/settings/dance-types/${id}/icon`,
        { method: "DELETE" },
        token,
      );
    }
  };

  const onSubmit = async (values: DanceTypeForm) => {
    const payload = {
      ...values,
      description: values.description || undefined,
      color: values.color || undefined,
      iconUrl: values.iconUrl || undefined,
      coverImageUrl: values.coverImageUrl || undefined,
    };
    const saved = editing
      ? await updateMutation.mutateAsync({ id: editing.id, data: payload }).catch(() => null)
      : await createMutation.mutateAsync(payload).catch(() => null);
    if (!saved) return;
    try {
      await saveIconFor(saved.id);
      resetIconState();
      invalidate();
    } catch (e: unknown) {
      const err = e as { data?: { error?: string } };
      toast({ title: "Icon not saved", description: err?.data?.error ?? "SVG was rejected", variant: "destructive" });
    }
  };

  const onIconFile = async (file?: File) => {
    if (!file) return;
    const text = await file.text();
    setIconSvgText(text);
    setIconCleared(false);
    setIconFileName(file.name);
  };

  const handleToggleActive = (dt: DanceType) => {
    updateMutation.mutate({ id: dt.id, data: { isActive: !dt.isActive } });
  };

  const handleDelete = (id: number) => {
    if (confirm("Deactivate this dance type? It will no longer appear in the Classes dropdown.")) {
      deleteMutation.mutate(id);
    }
  };

  return (
    <div className="space-y-6">
      {/* Tab Header Toolbar with Relocated "Add Dance Type" Button */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Dance Types</h2>
          <p className="text-sm text-muted-foreground">
            The category list used in the Classes form and the student-facing app.
            Active types appear in dropdowns; inactive types are hidden but their existing classes are unaffected.
          </p>
        </div>
        {canEdit && (
          <Button
            data-testid="button-add-dance-type"
            onClick={openCreate}
            className="gap-2 self-start sm:self-auto shrink-0"
          >
            <Plus className="h-4 w-4" />
            Add Dance Type
          </Button>
        )}
      </div>

      {/* Dance Types Table */}
      <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
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
                      {canEdit && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggleActive(dt)}
                          data-testid={`button-toggle-dance-type-${dt.id}`}
                        >
                          {dt.isActive ? "Deactivate" : "Activate"}
                        </Button>
                      )}
                      {canEdit && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(dt)}
                          data-testid={`button-edit-dance-type-${dt.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      {canEdit && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(dt.id)}
                          data-testid={`button-delete-dance-type-${dt.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Create / Edit dialog */}
      <Dialog open={canEdit && open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
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
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea rows={2} placeholder="Short description (optional)" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="color"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Brand Color</FormLabel>
                    <FormControl>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          aria-label="Brand color"
                          value={field.value || "#00B6D7"}
                          onChange={(e) => field.onChange(e.target.value)}
                          className="h-9 w-10 shrink-0 rounded border bg-transparent p-0"
                        />
                        <Input placeholder="#00B6D7" {...field} value={field.value ?? ""} />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {/* Icon SVG upload + preview */}
              <FormItem>
                <Label>Icon (SVG)</Label>
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/30">
                    {iconSvgText ? (
                      <img src={`data:image/svg+xml;utf8,${encodeURIComponent(iconSvgText)}`} alt="" className="h-8 w-8" />
                    ) : !iconCleared && editing?.iconSvg ? (
                      <img src={`data:image/svg+xml;utf8,${encodeURIComponent(editing.iconSvg)}`} alt="" className="h-8 w-8" />
                    ) : form.watch("iconUrl") ? (
                      <img src={form.watch("iconUrl") || ""} alt="" className="h-8 w-8 object-contain" />
                    ) : (
                      <span className="text-[10px] text-muted-foreground">none</span>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    <Input
                      type="file"
                      accept=".svg,image/svg+xml"
                      onChange={(e) => onIconFile(e.target.files?.[0])}
                      className="text-xs"
                    />
                    {(iconFileName || (editing?.hasIconSvg && !iconCleared)) && (
                      <button
                        type="button"
                        onClick={() => { setIconSvgText(null); setIconFileName(""); setIconCleared(true); }}
                        className="self-start text-xs text-destructive"
                      >
                        Remove icon
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Sanitized &amp; stored on save. Falls back to Icon URL, then the first letter.</p>
              </FormItem>
              <FormField
                control={form.control}
                name="iconUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Icon URL (fallback)</FormLabel>
                    <FormControl>
                      <Input placeholder="https://… .svg or .png" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="coverImageUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cover Image URL</FormLabel>
                    <FormControl>
                      <Input placeholder="https://… (optional)" {...field} value={field.value ?? ""} />
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
