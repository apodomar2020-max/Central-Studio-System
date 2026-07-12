/**
 * Ballet → Classes — /ballet/classes
 *
 * Class catalogue for the Ballet system, independent of the generic Classes
 * page / `classes` table. groupIds/levelIds are plain number arrays on the
 * wire (backed by join tables server-side — irrelevant here).
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

interface BalletClass {
  id: number;
  title: string;
  instructorId?: number | null;
  groupIds: number[];
  levelIds: number[];
  classImageUrl?: string | null;
  classVideoUrl?: string | null;
  isActive: boolean;
}

interface BalletInstructor { id: number; name: string; }
interface BalletGroup { id: number; name: string; }
interface BalletLevel { id: number; name: string; }

interface ListResponse<T> { data: T[]; total: number; page: number; limit: number; totalPages: number; }

const formSchema = z.object({
  title: z.string().min(1, "Title is required"),
  instructorId: z.number().int().positive().nullish(),
  groupIds: z.array(z.number().int().positive()).default([]),
  levelIds: z.array(z.number().int().positive()).default([]),
  classImageUrl: z.string().url("Must be a valid URL").nullish().or(z.literal("")),
  classVideoUrl: z.string().url("Must be a valid URL").nullish().or(z.literal("")),
  isActive: z.boolean().default(true),
});

type FormValues = z.infer<typeof formSchema>;

const EMPTY_VALUES: FormValues = {
  title: "", instructorId: undefined, groupIds: [], levelIds: [],
  classImageUrl: "", classVideoUrl: "", isActive: true,
};

export default function BalletClassesPage() {
  const { token, can } = useAdminAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const canCreate = can("ballet.classes", "create");
  const canEdit = can("ballet.classes", "edit");
  const canDelete = can("ballet.classes", "delete");

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<BalletClass | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-ballet-classes", token],
    queryFn: () => adminFetch<ListResponse<BalletClass>>(`${API_BASE}/api/admin/ballet/classes?limit=${CATALOG_LIMIT}`, {}, token),
    refetchOnWindowFocus: false,
  });
  const classes = data?.data ?? [];

  const { data: instructorsData } = useQuery({
    queryKey: ["admin-ballet-instructors-ref", token],
    queryFn: () => adminFetch<ListResponse<BalletInstructor>>(`${API_BASE}/api/admin/ballet/instructors?limit=${CATALOG_LIMIT}`, {}, token),
    refetchOnWindowFocus: false,
  });
  const instructors = instructorsData?.data ?? [];

  const { data: groupsData } = useQuery({
    queryKey: ["admin-ballet-groups-ref", token],
    queryFn: () => adminFetch<ListResponse<BalletGroup>>(`${API_BASE}/api/admin/ballet/groups?limit=${CATALOG_LIMIT}`, {}, token),
    refetchOnWindowFocus: false,
  });
  const groups = groupsData?.data ?? [];

  const { data: levelsData } = useQuery({
    queryKey: ["admin-ballet-levels-ref", token],
    queryFn: () => adminFetch<{ levels: BalletLevel[] }>(`${API_BASE}/api/admin/ballet/levels`, {}, token),
    refetchOnWindowFocus: false,
  });
  const levels = levelsData?.levels ?? [];

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-ballet-classes"] });

  const createMutation = useMutation({
    mutationFn: (body: object) => adminFetch(`${API_BASE}/api/admin/ballet/classes`, { method: "POST", body: JSON.stringify(body) }, token),
    onSuccess: () => { invalidate(); toast({ title: "Class created" }); setOpen(false); },
    onError: (e: any) => toast({ title: "Error", description: e?.data?.error ?? "Failed to create class", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) => adminFetch(`${API_BASE}/api/admin/ballet/classes/${id}`, { method: "PATCH", body: JSON.stringify(body) }, token),
    onSuccess: () => { invalidate(); toast({ title: "Class updated" }); setOpen(false); },
    onError: (e: any) => toast({ title: "Error", description: e?.data?.error ?? "Failed to update class", variant: "destructive" }),
  });

  const form = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: EMPTY_VALUES });

  const openCreate = () => {
    setEditing(null);
    form.reset(EMPTY_VALUES);
    setOpen(true);
  };

  const openEdit = (cls: BalletClass) => {
    setEditing(cls);
    form.reset({
      title: cls.title,
      instructorId: cls.instructorId ?? undefined,
      groupIds: cls.groupIds ?? [],
      levelIds: cls.levelIds ?? [],
      classImageUrl: cls.classImageUrl ?? "",
      classVideoUrl: cls.classVideoUrl ?? "",
      isActive: cls.isActive,
    });
    setOpen(true);
  };

  const onSubmit = (values: FormValues) => {
    const body = {
      ...values,
      classImageUrl: values.classImageUrl || null,
      classVideoUrl: values.classVideoUrl || null,
    };
    if (editing) {
      updateMutation.mutate({ id: editing.id, body });
    } else {
      createMutation.mutate(body);
    }
  };

  const getInstructorName = (id?: number | null) => instructors.find((i) => i.id === id)?.name ?? "—";
  const getGroupNames = (ids: number[]) =>
    ids.map((id) => groups.find((g) => g.id === id)?.name ?? `#${id}`);
  const getLevelNames = (ids: number[]) =>
    ids.map((id) => levels.find((l) => l.id === id)?.name ?? `#${id}`);

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      <PageHeader title="Ballet Classes" description="Class catalogue for the Ballet program" mode="stage" addLabel="Add Class" addTestId="button-add-ballet-class" onAdd={canCreate ? openCreate : undefined} />

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Instructor</TableHead>
              <TableHead>Groups</TableHead>
              <TableHead>Levels</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></TableCell></TableRow>
            ) : classes.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No ballet classes yet.</TableCell></TableRow>
            ) : (
              classes.map((cls) => (
                <TableRow key={cls.id} data-testid={`row-ballet-class-${cls.id}`}>
                  <TableCell className="font-medium">{cls.title}</TableCell>
                  <TableCell>{getInstructorName(cls.instructorId)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {getGroupNames(cls.groupIds).map((n, i) => <Badge variant="secondary" key={i}>{n}</Badge>)}
                      {cls.groupIds.length === 0 && <span className="text-sm text-muted-foreground">—</span>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {getLevelNames(cls.levelIds).map((n, i) => <Badge variant="secondary" key={i}>{n}</Badge>)}
                      {cls.levelIds.length === 0 && <span className="text-sm text-muted-foreground">—</span>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={cls.isActive ? "default" : "outline"}>{cls.isActive ? "Active" : "Inactive"}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {canEdit && (
                      <Button variant="ghost" size="icon" data-testid={`button-edit-ballet-class-${cls.id}`} onClick={() => openEdit(cls)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        variant="ghost" size="icon"
                        data-testid={`button-deactivate-ballet-class-${cls.id}`}
                        title={cls.isActive ? "Deactivate" : "Activate"}
                        onClick={() => updateMutation.mutate({ id: cls.id, body: { isActive: !cls.isActive } })}
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
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Ballet Class" : "Add Ballet Class"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="title" render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl><Input data-testid="input-ballet-class-title" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="instructorId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Instructor</FormLabel>
                  <Select
                    onValueChange={(v) => field.onChange(v === "none" ? null : Number(v))}
                    value={field.value ? String(field.value) : "none"}
                  >
                    <FormControl><SelectTrigger data-testid="select-ballet-class-instructor"><SelectValue placeholder="Select instructor" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="none">No instructor</SelectItem>
                      {instructors.map((i) => <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="groupIds" render={({ field }) => (
                <FormItem>
                  <FormLabel>Groups</FormLabel>
                  <FormControl>
                    <div className="max-h-36 overflow-y-auto rounded-md border p-3 space-y-2">
                      {groups.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No groups yet.</p>
                      ) : groups.map((g) => (
                        <label key={g.id} className="flex items-center gap-2 text-sm cursor-pointer">
                          <Checkbox
                            checked={field.value?.includes(g.id) ?? false}
                            onCheckedChange={(checked) => {
                              const next = checked
                                ? [...(field.value ?? []), g.id]
                                : (field.value ?? []).filter((id) => id !== g.id);
                              field.onChange(next);
                            }}
                          />
                          {g.name}
                        </label>
                      ))}
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="levelIds" render={({ field }) => (
                <FormItem>
                  <FormLabel>Levels</FormLabel>
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

              <FormField control={form.control} name="classImageUrl" render={({ field }) => (
                <FormItem>
                  <FormLabel>Class Image URL</FormLabel>
                  <FormControl><Input placeholder="https://example.com/image.jpg" {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="classVideoUrl" render={({ field }) => (
                <FormItem>
                  <FormLabel>Class Video URL</FormLabel>
                  <FormControl><Input placeholder="https://example.com/video.mp4" {...field} value={field.value ?? ""} /></FormControl>
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
                <Button type="submit" data-testid="button-submit-ballet-class" disabled={isSaving}>
                  {isSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  {editing ? "Save Changes" : "Create Class"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
