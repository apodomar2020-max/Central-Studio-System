/**
 * Ballet → Schedules — /ballet/schedules
 *
 * Read/edit view of the single weekly schedule owned by each Ballet Class.
 * New schedules are created atomically from the Ballet Classes page.
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
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Trash2, Edit, Loader2 } from "lucide-react";
import { adminFetch, scheduleErrorMessage } from "./balletScheduleApiClient";

// ─── API helpers ──────────────────────────────────────────────────────────────

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

// ─── Types ────────────────────────────────────────────────────────────────────

interface BalletSchedule {
  id: number;
  classId: number;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  status: "active" | "deactivated" | "cancelled";
  durationMins?: number | null;
}

interface BalletClass { id: number; title: string; isLegacy: boolean; }
interface ListResponse<T> { data: T[]; total: number; page: number; limit: number; totalPages: number; }

const formSchema = z.object({
  dayOfWeek: z.number({ required_error: "Day of week is required" }).int().min(0).max(6),
  startTime: z.string().min(1, "Start time is required"),
  endTime: z.string().min(1, "End time is required"),
  status: z.enum(STATUSES).default("active"),
});

type FormValues = z.input<typeof formSchema>;

const EMPTY_VALUES: FormValues = {
  dayOfWeek: 1,
  startTime: "16:00",
  endTime: "17:00",
  status: "active",
};

export default function BalletSchedulesPage() {
  const { token, can } = useAdminAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
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

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-ballet-schedules"] });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) => adminFetch(`${API_BASE}/api/admin/ballet/schedules/${id}`, { method: "PATCH", body: JSON.stringify(body) }, token, API_KEY),
    onSuccess: () => { invalidate(); toast({ title: "Schedule updated" }); setOpen(false); },
    onError: (e: unknown) => toast({ title: "Error", description: scheduleErrorMessage(e, "Failed to update schedule."), variant: "destructive" }),
  });

  const form = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: EMPTY_VALUES });

  const isLegacySchedule = (s: BalletSchedule) => classes.find((c) => c.id === s.classId)?.isLegacy ?? false;

  const openEdit = (s: BalletSchedule) => {
    if (isLegacySchedule(s)) {
      toast({ title: "Historical Schedule", description: "This Class uses the retired Ballet Class model. Create a new Class to resume the program.", variant: "destructive" });
      return;
    }
    setEditing(s);
    form.reset({
      dayOfWeek: s.dayOfWeek,
      startTime: s.startTime,
      endTime: s.endTime,
      status: s.status,
    });
    setOpen(true);
  };

  const onSubmit = (values: FormValues) => {
    const parsed = formSchema.parse(values);
    if (editing) updateMutation.mutate({ id: editing.id, body: parsed });
  };

  const getClassTitle = (id: number) => classes.find((c) => c.id === id)?.title ?? `Class #${id}`;
  const isSaving = updateMutation.isPending;

  return (
    <div className="space-y-6">
      <PageHeader title="Ballet Schedules" description="Read and edit the one weekly schedule owned by each Ballet Class. Create schedules from Add Class." mode="stage" />

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Class</TableHead>
              <TableHead>Day</TableHead>
              <TableHead>Time</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></TableCell></TableRow>
            ) : schedules.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No ballet schedules yet.</TableCell></TableRow>
            ) : (
              schedules.map((s) => (
                <TableRow key={s.id} data-testid={`row-ballet-schedule-${s.id}`}>
                  <TableCell className="font-medium">
                    {getClassTitle(s.classId)}
                    {isLegacySchedule(s) && <div className="mt-1"><Badge variant="secondary" data-testid={`badge-legacy-schedule-${s.id}`}>Historical Class</Badge></div>}
                  </TableCell>
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
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Ballet Schedule</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-2"><Label>Class</Label><Input readOnly value={editing ? getClassTitle(editing.classId) : ""} /></div>

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

              <div className="space-y-2"><Label>Duration</Label><Input readOnly value={editing?.durationMins ? `${editing.durationMins} minutes (recalculated on save)` : "Derived from start and end time"} /></div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" data-testid="button-submit-ballet-schedule" disabled={isSaving}>
                  {isSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Save Changes
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
