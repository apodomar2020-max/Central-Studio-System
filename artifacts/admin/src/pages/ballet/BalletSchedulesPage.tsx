/**
 * Ballet -> Schedules — /ballet/schedules
 *
 * Create and operate weekly Ballet schedule rows independently from Class
 * catalogue data. One Class may have several weekly sessions.
 */

import { useMemo, useState } from "react";
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
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Trash2, Edit, Loader2 } from "lucide-react";
import { adminFetch, scheduleErrorMessage } from "./balletScheduleApiClient";

const API_BASE = import.meta.env.VITE_API_URL as string | undefined ?? "";
const API_KEY  = import.meta.env.VITE_API_KEY  as string | undefined ?? "";

const CATALOG_LIMIT = 100;

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const STATUSES = ["active", "deactivated", "cancelled"] as const;

function statusBadgeClass(status: string) {
  switch (status) {
    case "active": return "bg-emerald-500/15 text-emerald-300 border-emerald-400/30";
    case "deactivated": return "bg-slate-500/15 text-slate-300 border-slate-400/30";
    case "cancelled": return "bg-red-500/15 text-red-300 border-red-400/30";
    default: return "bg-gray-500/15 text-gray-400 border-gray-500/30";
  }
}

interface BalletSchedule {
  id: number;
  classId: number;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  status: "active" | "deactivated" | "cancelled";
  durationMins?: number | null;
}

interface BalletClass {
  id: number;
  title: string;
  isLegacy: boolean;
  isActive: boolean;
  levelId: number | null;
  groupId: number | null;
  instructorId: number | null;
  schedules?: BalletSchedule[];
  /** @deprecated Use schedules[] instead. */
  schedule?: BalletSchedule | null;
}
interface BalletInstructor { id: number; name: string; isActive: boolean; }
interface BalletGroup { id: number; name: string; levelId: number; isActive: boolean; }
interface BalletLevel { id: number; name: string; isActive: boolean; }
interface ListResponse<T> { data: T[]; total: number; page: number; limit: number; totalPages: number; }

const formSchema = z.object({
  classId: z.number({ required_error: "Class is required" }).int().positive("Class is required"),
  dayOfWeek: z.number({ required_error: "Day of week is required" }).int().min(0).max(6),
  startTime: z.string().min(1, "Start time is required"),
  endTime: z.string().min(1, "End time is required"),
  status: z.enum(STATUSES).default("active"),
});

type FormValues = z.input<typeof formSchema>;

const EMPTY_VALUES: FormValues = {
  classId: 0,
  dayOfWeek: 1,
  startTime: "16:00",
  endTime: "17:00",
  status: "active",
};

export default function BalletSchedulesPage() {
  const { token, can } = useAdminAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const canCreate = can("ballet.schedules", "create");
  const canEdit = can("ballet.schedules", "edit");
  const canDelete = can("ballet.schedules", "delete");

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<BalletSchedule | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-ballet-schedules", token],
    queryFn: () => adminFetch<ListResponse<BalletSchedule>>(`${API_BASE}/api/admin/ballet/schedules?limit=${CATALOG_LIMIT}`, {}, token, API_KEY),
    refetchOnWindowFocus: false,
  });
  const schedules = data?.data ?? [];

  const { data: classesData } = useQuery({
    queryKey: ["admin-ballet-classes-ref", token],
    queryFn: () => adminFetch<ListResponse<BalletClass>>(`${API_BASE}/api/admin/ballet/classes?limit=${CATALOG_LIMIT}`, {}, token, API_KEY),
    refetchOnWindowFocus: false,
  });
  const classes = classesData?.data ?? [];

  const { data: instructorsData } = useQuery({
    queryKey: ["admin-ballet-instructors-ref", token],
    queryFn: () => adminFetch<ListResponse<BalletInstructor>>(`${API_BASE}/api/admin/ballet/instructors?limit=${CATALOG_LIMIT}`, {}, token, API_KEY),
    refetchOnWindowFocus: false,
  });
  const instructors = instructorsData?.data ?? [];

  const { data: groupsData } = useQuery({
    queryKey: ["admin-ballet-groups-ref", token],
    queryFn: () => adminFetch<ListResponse<BalletGroup>>(`${API_BASE}/api/admin/ballet/groups?limit=${CATALOG_LIMIT}`, {}, token, API_KEY),
    refetchOnWindowFocus: false,
  });
  const groups = groupsData?.data ?? [];

  const { data: levelsData } = useQuery({
    queryKey: ["admin-ballet-levels-ref", token],
    queryFn: () => adminFetch<{ levels: BalletLevel[] }>(`${API_BASE}/api/admin/ballet/levels`, {}, token, API_KEY),
    refetchOnWindowFocus: false,
  });
  const levels = levelsData?.levels ?? [];

  const classById = useMemo(() => new Map(classes.map((item) => [item.id, item])), [classes]);
  const levelById = useMemo(() => new Map(levels.map((item) => [item.id, item])), [levels]);
  const groupById = useMemo(() => new Map(groups.map((item) => [item.id, item])), [groups]);
  const instructorById = useMemo(() => new Map(instructors.map((item) => [item.id, item])), [instructors]);
  const schedulesFor = (item: BalletClass) => item.schedules ?? (item.schedule ? [item.schedule] : []);

  const eligibleClasses = classes.filter((item) => {
    if (item.isLegacy || !item.isActive || item.levelId == null || item.groupId == null || item.instructorId == null) return false;
    const level = levelById.get(item.levelId);
    const group = groupById.get(item.groupId);
    const instructor = instructorById.get(item.instructorId);
    return level?.isActive === true
      && group?.isActive === true
      && group.levelId === item.levelId
      && instructor?.isActive === true;
  });

  const invalidate = () => Promise.all([
    qc.invalidateQueries({ queryKey: ["admin-ballet-schedules"] }),
    qc.invalidateQueries({ queryKey: ["admin-ballet-classes"] }),
    qc.invalidateQueries({ queryKey: ["admin-ballet-classes-ref"] }),
  ]);

  const createMutation = useMutation({
    mutationFn: (body: object) => adminFetch(`${API_BASE}/api/admin/ballet/schedules`, { method: "POST", body: JSON.stringify(body) }, token, API_KEY),
    onSuccess: async () => { await invalidate(); toast({ title: "Schedule created" }); setOpen(false); },
    onError: (e: unknown) => toast({ title: "Error", description: scheduleErrorMessage(e, "Failed to create schedule."), variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) => adminFetch(`${API_BASE}/api/admin/ballet/schedules/${id}`, { method: "PATCH", body: JSON.stringify(body) }, token, API_KEY),
    onSuccess: async () => { await invalidate(); toast({ title: "Schedule updated" }); setOpen(false); },
    onError: (e: unknown) => toast({ title: "Error", description: scheduleErrorMessage(e, "Failed to update schedule."), variant: "destructive" }),
  });

  const form = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: EMPTY_VALUES, mode: "onChange", reValidateMode: "onChange" });

  const isLegacySchedule = (s: BalletSchedule) => classById.get(s.classId)?.isLegacy ?? false;

  const describeClass = (id: number): string => {
    const item = classById.get(id);
    if (!item) return `Class #${id}`;
    const level = item.levelId == null ? null : levelById.get(item.levelId);
    const group = item.groupId == null ? null : groupById.get(item.groupId);
    const instructor = item.instructorId == null ? null : instructorById.get(item.instructorId);
    return [item.title, level?.name, group?.name, instructor?.name].filter(Boolean).join(" · ");
  };

  const openCreate = () => {
    setEditing(null);
    form.reset(EMPTY_VALUES);
    setOpen(true);
  };

  const openEdit = (s: BalletSchedule) => {
    if (isLegacySchedule(s)) {
      toast({ title: "Historical Schedule", description: "This Class uses the retired Ballet Class model. Create a new Class to resume the program.", variant: "destructive" });
      return;
    }
    setEditing(s);
    form.reset({
      classId: s.classId,
      dayOfWeek: s.dayOfWeek,
      startTime: s.startTime,
      endTime: s.endTime,
      status: s.status,
    });
    setOpen(true);
  };

  const onSubmit = (values: FormValues) => {
    const parsed = formSchema.parse(values);
    if (editing) {
      updateMutation.mutate({
        id: editing.id,
        body: {
          dayOfWeek: parsed.dayOfWeek,
          startTime: parsed.startTime,
          endTime: parsed.endTime,
          status: parsed.status,
        },
      });
    } else {
      createMutation.mutate(parsed);
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ballet Schedules"
        description="Create and manage weekly Ballet class sessions"
        mode="stage"
        addLabel="Add Schedule"
        addTestId="button-add-ballet-schedule"
        onAdd={canCreate ? openCreate : undefined}
      />

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Class</TableHead>
              <TableHead>Level</TableHead>
              <TableHead>Group</TableHead>
              <TableHead>Instructor</TableHead>
              <TableHead>Day</TableHead>
              <TableHead>Time</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={9} className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></TableCell></TableRow>
            ) : schedules.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No ballet schedules yet.</TableCell></TableRow>
            ) : (
              schedules.map((s) => {
                const item = classById.get(s.classId);
                const level = item?.levelId == null ? null : levelById.get(item.levelId);
                const group = item?.groupId == null ? null : groupById.get(item.groupId);
                const instructor = item?.instructorId == null ? null : instructorById.get(item.instructorId);
                return (
                  <TableRow key={s.id} data-testid={`row-ballet-schedule-${s.id}`}>
                    <TableCell className="font-medium">
                      {item?.title ?? `Class #${s.classId}`}
                      {isLegacySchedule(s) && <div className="mt-1"><Badge variant="secondary" data-testid={`badge-legacy-schedule-${s.id}`}>Historical Class</Badge></div>}
                    </TableCell>
                    <TableCell>{level?.name ?? "—"}</TableCell>
                    <TableCell>{group?.name ?? "—"}</TableCell>
                    <TableCell>{instructor?.name ?? "—"}</TableCell>
                    <TableCell>{DAY_SHORT[s.dayOfWeek] ?? "—"}</TableCell>
                    <TableCell>{s.startTime} – {s.endTime}</TableCell>
                    <TableCell>{s.durationMins != null ? `${s.durationMins} min` : "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusBadgeClass(s.status)}>
                        {s.status.charAt(0).toUpperCase() + s.status.slice(1)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {!isLegacySchedule(s) && canEdit && (
                        <Button variant="ghost" size="icon" data-testid={`button-edit-ballet-schedule-${s.id}`} onClick={() => openEdit(s)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                      )}
                      {!isLegacySchedule(s) && canDelete && (
                        <Button
                          variant="ghost" size="icon"
                          data-testid={`button-cancel-ballet-schedule-${s.id}`}
                          title={s.status === "cancelled" ? "Reactivate" : "Cancel"}
                          onClick={() => updateMutation.mutate({ id: s.id, body: { status: s.status === "cancelled" ? "active" : "cancelled" } })}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) { setEditing(null); form.reset(EMPTY_VALUES); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Ballet Schedule" : "Add Ballet Schedule"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              {editing ? (
                <div className="space-y-2"><Label>Class</Label><Input readOnly value={describeClass(editing.classId)} /></div>
              ) : (
                <FormField control={form.control} name="classId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Class</FormLabel>
                    <Select onValueChange={(v) => field.onChange(Number(v))} value={field.value ? String(field.value) : ""}>
                      <FormControl><SelectTrigger data-testid="select-ballet-schedule-class"><SelectValue placeholder="Select active Ballet Class" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {eligibleClasses.map((item) => {
                          const count = schedulesFor(item).length;
                          const suffix = count === 0 ? "No schedules" : count === 1 ? "1 schedule" : `${count} schedules`;
                          return <SelectItem key={item.id} value={String(item.id)}>{describeClass(item.id)} · {suffix}</SelectItem>;
                        })}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              )}

              <FormField control={form.control} name="dayOfWeek" render={({ field }) => (
                <FormItem>
                  <FormLabel>Day of Week</FormLabel>
                  <Select onValueChange={(v) => field.onChange(Number(v))} value={field.value == null ? "" : String(field.value)}>
                    <FormControl><SelectTrigger data-testid="select-ballet-schedule-day"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {DAYS.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="startTime" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start Time</FormLabel>
                    <FormControl><Input type="time" data-testid="input-ballet-schedule-start" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="endTime" render={({ field }) => (
                  <FormItem>
                    <FormLabel>End Time</FormLabel>
                    <FormControl><Input type="time" data-testid="input-ballet-schedule-end" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <FormField control={form.control} name="status" render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? "active"}>
                    <FormControl><SelectTrigger data-testid="select-ballet-schedule-status"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="deactivated">Deactivated</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="space-y-2"><Label>Duration</Label><Input readOnly value="Derived from start and end time on save" /></div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" data-testid="button-submit-ballet-schedule" disabled={isSaving}>
                  {isSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  {editing ? "Save Changes" : "Create Schedule"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
