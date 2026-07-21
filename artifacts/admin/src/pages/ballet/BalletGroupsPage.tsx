/**
 * Ballet → Groups — /ballet/groups
 *
 * A cohort of children within one required level. Weekly schedules belong
 * to the separate classes owned by this group; this page never manages
 * schedule relationships directly.
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

interface BalletGroup {
  id: number;
  name: string;
  levelId: number;
  isActive: boolean;
  classCount: number;
  /** Count of Classes satisfying the shared assignment-ready invariant. */
  assignmentReadyClassCount: number;
  /** Null = uncapped (no enforced limit). */
  capacity: number | null;
  /** Count of status="active" ballet_level_assignments rows currently pointed at this group. */
  activeAssignmentCount: number;
}

interface BalletLevel { id: number; name: string; isActive: boolean; }
interface ListResponse<T> { data: T[]; total: number; page: number; limit: number; totalPages: number; }

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  levelId: z.number({ required_error: "Level is required" }).int().positive(),
  isActive: z.boolean().default(true),
  // Null = uncapped. A set value is enforced server-side against the count
  // of active ballet_level_assignments rows pointed at this group.
  capacity: z.number().int().positive().nullable().default(null),
});

type FormValues = z.infer<typeof formSchema>;

const EMPTY_VALUES: FormValues = {
  name: "", levelId: undefined as unknown as number, isActive: true, capacity: null,
};

export default function BalletGroupsPage() {
  const { token, can } = useAdminAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const canCreate = can("ballet.groups", "create");
  const canEdit = can("ballet.groups", "edit");
  const canDelete = can("ballet.groups", "delete");

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<BalletGroup | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-ballet-groups", token],
    queryFn: () => adminFetch<ListResponse<BalletGroup>>(`${API_BASE}/api/admin/ballet/groups?limit=${CATALOG_LIMIT}`, {}, token),
    refetchOnWindowFocus: false,
  });
  const groups = data?.data ?? [];

  const { data: levelsData } = useQuery({
    queryKey: ["admin-ballet-levels-ref", token],
    queryFn: () => adminFetch<{ levels: BalletLevel[] }>(`${API_BASE}/api/admin/ballet/levels`, {}, token),
    refetchOnWindowFocus: false,
  });
  const levels = levelsData?.levels ?? [];

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-ballet-groups"] });

  const createMutation = useMutation({
    mutationFn: (body: object) => adminFetch(`${API_BASE}/api/admin/ballet/groups`, { method: "POST", body: JSON.stringify(body) }, token),
    onSuccess: () => { invalidate(); toast({ title: "Group created" }); setOpen(false); },
    onError: (e: any) => toast({ title: "Error", description: e?.data?.error ?? "Failed to create group", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) => adminFetch(`${API_BASE}/api/admin/ballet/groups/${id}`, { method: "PATCH", body: JSON.stringify(body) }, token),
    onSuccess: () => { invalidate(); toast({ title: "Group updated" }); setOpen(false); },
    onError: (e: any) => toast({ title: "Error", description: e?.data?.error ?? "Failed to update group", variant: "destructive" }),
  });

  const form = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: EMPTY_VALUES });

  const openCreate = () => {
    setEditing(null);
    form.reset(EMPTY_VALUES);
    setOpen(true);
  };

  const openEdit = (group: BalletGroup) => {
    setEditing(group);
    form.reset({
      name: group.name,
      levelId: group.levelId,
      isActive: group.isActive,
      capacity: group.capacity,
    });
    setOpen(true);
  };

  const onSubmit = (values: FormValues) => {
    if (editing) {
      updateMutation.mutate({ id: editing.id, body: values });
    } else {
      createMutation.mutate(values);
    }
  };

  const getLevelName = (id: number) => levels.find((l) => l.id === id)?.name ?? `#${id}`;
  const selectableLevels = levels.filter((level) => level.isActive || (editing != null && level.id === editing.levelId));
  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      <PageHeader title="Ballet Groups" description="Cohorts of children within a level" mode="stage" addLabel="Add Group" addTestId="button-add-ballet-group" onAdd={canCreate ? openCreate : undefined} />

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Level</TableHead>
              <TableHead>Classes</TableHead>
              <TableHead>Capacity</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></TableCell></TableRow>
            ) : groups.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No ballet groups yet.</TableCell></TableRow>
            ) : (
              groups.map((group) => (
                <TableRow key={group.id} data-testid={`row-ballet-group-${group.id}`}>
                  <TableCell className="font-medium">{group.name}</TableCell>
                  <TableCell>{getLevelName(group.levelId)}</TableCell>
                  <TableCell>
                    {group.classCount} class{group.classCount === 1 ? "" : "es"}
                    {group.assignmentReadyClassCount === 0 && (
                      <span className="ml-2"><Badge variant="outline">Not assignment-ready</Badge></span>
                    )}
                  </TableCell>
                  <TableCell>
                    {group.capacity == null
                      ? <span className="text-sm text-muted-foreground">{group.activeAssignmentCount} / Uncapped</span>
                      : (
                        <Badge variant={group.activeAssignmentCount >= group.capacity ? "destructive" : "secondary"}>
                          {group.activeAssignmentCount} / {group.capacity}
                        </Badge>
                      )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={group.isActive ? "default" : "outline"}>{group.isActive ? "Active" : "Inactive"}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {canEdit && (
                      <Button variant="ghost" size="icon" data-testid={`button-edit-ballet-group-${group.id}`} onClick={() => openEdit(group)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        variant="ghost" size="icon"
                        data-testid={`button-deactivate-ballet-group-${group.id}`}
                        title={group.isActive ? "Deactivate" : "Activate"}
                        onClick={() => updateMutation.mutate({ id: group.id, body: { isActive: !group.isActive } })}
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
            <DialogTitle>{editing ? "Edit Ballet Group" : "Add Ballet Group"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl><Input data-testid="input-ballet-group-name" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="levelId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Level</FormLabel>
                  <Select onValueChange={(v) => field.onChange(Number(v))} value={field.value ? String(field.value) : ""}>
                    <FormControl><SelectTrigger data-testid="select-ballet-group-level"><SelectValue placeholder="Select level" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {selectableLevels.map((l) => <SelectItem key={l.id} value={String(l.id)}>{l.name}{l.isActive ? "" : " (Inactive — historical)"}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="capacity" render={({ field }) => (
                <FormItem>
                  <FormLabel>Capacity</FormLabel>
                  <FormControl>
                    <Input
                      data-testid="input-ballet-group-capacity"
                      type="number"
                      min={1}
                      placeholder="Uncapped"
                      value={field.value ?? ""}
                      onChange={(e) => field.onChange(e.target.value === "" ? null : Number(e.target.value))}
                    />
                  </FormControl>
                  {editing && (
                    <p className="text-xs text-muted-foreground">
                      Currently {editing.activeAssignmentCount} student{editing.activeAssignmentCount === 1 ? "" : "s"} assigned. Leave blank for no limit.
                    </p>
                  )}
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
                <Button type="submit" data-testid="button-submit-ballet-group" disabled={isSaving}>
                  {isSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  {editing ? "Save Changes" : "Create Group"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
