/**
 * Ballet → Packages — /ballet/packages
 *
 * Monthly Ballet tuition packages — distinct from the generic per-class /
 * per-session credit packages on the Packages page (packages.tsx, untouched
 * here). levelIds is a plain number array on the wire.
 *
 * Uses the raw-fetch pattern established by the other Ballet admin pages
 * rather than the generated @workspace/api-client-react hooks.
 */

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Trash2, Edit, Loader2 } from "lucide-react";

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

async function adminFetch<T>(url: string, init: RequestInit, token: string | null): Promise<T> {
  const res = await fetch(url, { ...init, headers: makeHeaders(token) });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw { data };
  }
  return res.json() as Promise<T>;
}

const CATALOG_LIMIT = 100;

// ─── Types ────────────────────────────────────────────────────────────────────

interface BalletPackage {
  id: number;
  name: string;
  monthlyClasses: number;
  monthlyHours: number;
  priceEgp: number;
  levelIds: number[];
  isActive: boolean;
}

interface BalletLevel { id: number; name: string; }
interface ListResponse<T> { data: T[]; total: number; page: number; limit: number; totalPages: number; }

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  monthlyClasses: z.coerce.number().int().positive("Must be at least 1"),
  monthlyHours: z.coerce.number().int().positive("Must be at least 1"),
  priceEgp: z.coerce.number().int().positive("Price required"),
  levelIds: z.array(z.number().int().positive()).default([]),
  isActive: z.boolean().default(true),
});

type FormValues = z.input<typeof formSchema>;

const EMPTY_VALUES: FormValues = {
  name: "", monthlyClasses: 8, monthlyHours: 8, priceEgp: 0, levelIds: [], isActive: true,
};

export default function BalletPackagesPage() {
  const { token, can } = useAdminAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const canCreate = can("ballet.packages", "create");
  const canEdit = can("ballet.packages", "edit");
  const canDelete = can("ballet.packages", "delete");

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<BalletPackage | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-ballet-packages", token],
    queryFn: () => adminFetch<ListResponse<BalletPackage>>(`${API_BASE}/api/admin/ballet/packages?limit=${CATALOG_LIMIT}`, {}, token),
    refetchOnWindowFocus: false,
  });
  const packages = data?.data ?? [];

  const { data: levelsData } = useQuery({
    queryKey: ["admin-ballet-levels-ref", token],
    queryFn: () => adminFetch<{ levels: BalletLevel[] }>(`${API_BASE}/api/admin/ballet/levels`, {}, token),
    refetchOnWindowFocus: false,
  });
  const levels = levelsData?.levels ?? [];

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-ballet-packages"] });

  const createMutation = useMutation({
    mutationFn: (body: object) => adminFetch(`${API_BASE}/api/admin/ballet/packages`, { method: "POST", body: JSON.stringify(body) }, token),
    onSuccess: () => { invalidate(); toast({ title: "Package created" }); setOpen(false); },
    onError: (e: any) => toast({ title: "Error", description: e?.data?.error ?? "Failed to create package", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) => adminFetch(`${API_BASE}/api/admin/ballet/packages/${id}`, { method: "PATCH", body: JSON.stringify(body) }, token),
    onSuccess: () => { invalidate(); toast({ title: "Package updated" }); setOpen(false); },
    onError: (e: any) => toast({ title: "Error", description: e?.data?.error ?? "Failed to update package", variant: "destructive" }),
  });

  const form = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: EMPTY_VALUES });

  const openCreate = () => {
    setEditing(null);
    form.reset(EMPTY_VALUES);
    setOpen(true);
  };

  const openEdit = (pkg: BalletPackage) => {
    setEditing(pkg);
    form.reset({
      name: pkg.name,
      monthlyClasses: pkg.monthlyClasses,
      monthlyHours: pkg.monthlyHours,
      priceEgp: pkg.priceEgp,
      levelIds: pkg.levelIds ?? [],
      isActive: pkg.isActive,
    });
    setOpen(true);
  };

  const onSubmit = (values: FormValues) => {
    const parsed = formSchema.parse(values);
    if (editing) {
      updateMutation.mutate({ id: editing.id, body: parsed });
    } else {
      createMutation.mutate(parsed);
    }
  };

  const getLevelNames = (ids: number[]) => ids.map((id) => levels.find((l) => l.id === id)?.name ?? `#${id}`);
  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="admin2-ballet-page admin2-ballet-registry space-y-6">
      <PageHeader
        title="Ballet Packages"
        description="Monthly Ballet tuition packages — distinct from the generic per-class/session credit packages"
        mode="stage"
        addLabel="Add Package"
        addTestId="button-add-ballet-package"
        onAdd={canCreate ? openCreate : undefined}
      />

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Classes / month</TableHead>
              <TableHead>Hours / month</TableHead>
              <TableHead>Price (EGP)</TableHead>
              <TableHead>Levels</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></TableCell></TableRow>
            ) : isError ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-destructive">Ballet packages could not be loaded.</TableCell></TableRow>
            ) : packages.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No ballet packages yet.</TableCell></TableRow>
            ) : (
              packages.map((pkg) => (
                <TableRow key={pkg.id} data-testid={`row-ballet-package-${pkg.id}`}>
                  <TableCell className="font-medium">{pkg.name}</TableCell>
                  <TableCell>{pkg.monthlyClasses}</TableCell>
                  <TableCell>{pkg.monthlyHours}</TableCell>
                  <TableCell>{pkg.priceEgp.toLocaleString()} EGP</TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {getLevelNames(pkg.levelIds).map((n, i) => <Badge variant="secondary" key={i}>{n}</Badge>)}
                      {pkg.levelIds.length === 0 && <span className="text-sm text-muted-foreground">—</span>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={pkg.isActive ? "default" : "outline"}>{pkg.isActive ? "Active" : "Inactive"}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {canEdit && (
                      <Button variant="ghost" size="icon" data-testid={`button-edit-ballet-package-${pkg.id}`} onClick={() => openEdit(pkg)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        variant="ghost" size="icon"
                        data-testid={`button-deactivate-ballet-package-${pkg.id}`}
                        title={pkg.isActive ? "Deactivate" : "Activate"}
                        onClick={() => updateMutation.mutate({ id: pkg.id, body: { isActive: !pkg.isActive } })}
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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Ballet Package" : "Add Ballet Package"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Package Name</FormLabel>
                  <FormControl><Input data-testid="input-ballet-package-name" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField control={form.control} name="monthlyClasses" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Classes / month</FormLabel>
                    <FormControl><Input type="number" min={1} data-testid="input-ballet-package-classes" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="monthlyHours" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Hours / month</FormLabel>
                    <FormControl><Input type="number" min={1} data-testid="input-ballet-package-hours" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <FormField control={form.control} name="priceEgp" render={({ field }) => (
                <FormItem>
                  <FormLabel>Price (EGP / month)</FormLabel>
                  <FormControl><Input type="number" min={0} data-testid="input-ballet-package-price" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="levelIds" render={({ field }) => (
                <FormItem>
                  <FormLabel>Applicable Levels</FormLabel>
                  <FormControl>
                    <div className="max-h-36 overflow-y-auto rounded-md border p-3 space-y-2">
                      {levels.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No levels configured.</p>
                      ) : levels.map((l) => (
                        <label key={l.id} className="flex items-center gap-2 text-sm cursor-pointer">
                          <Checkbox
                            checked={field.value?.includes(l.id) ?? false}
                            onCheckedChange={(checked) => {
                              const next = checked
                                ? [...(field.value ?? []), l.id]
                                : (field.value ?? []).filter((id) => id !== l.id);
                              field.onChange(next);
                            }}
                          />
                          {l.name}
                        </label>
                      ))}
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="isActive" render={({ field }) => (
                <FormItem className="flex items-center gap-3">
                  <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  <FormLabel className="!mt-0">Active</FormLabel>
                </FormItem>
              )} />

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" data-testid="button-submit-ballet-package" disabled={isSaving}>
                  {isSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  {editing ? "Save Changes" : "Create Package"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
import "./admin2-ballet.css";
