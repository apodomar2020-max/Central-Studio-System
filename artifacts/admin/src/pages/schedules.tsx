import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useListSchedules,
  useListClasses,
  useCreateSchedule,
  useUpdateSchedule,
  useDeleteSchedule,
  getListSchedulesQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
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
import { useQueryClient } from "@tanstack/react-query";
import { Edit, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { BranchRoomFields } from "@/components/schedules/BranchRoomFields";
import type { ScheduleBranch, ScheduleRoom } from "@workspace/api-client-react";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SCHEDULE_STATUSES = ["active", "completed", "expired", "cancelled"] as const;

const formSchema = z.object({
  classId: z.coerce.number().int().min(1, "Class is required"),
  branchId: z.number().int().positive().nullable().optional(),
  roomId: z.number().int().positive().nullable().optional(),
  type: z.enum(["weekly", "one_time"]).default("weekly"),
  status: z.enum(SCHEDULE_STATUSES).default("active"),
  dayOfWeek: z.coerce.number().int().min(0).max(6).nullish(),
  date: z.string().nullish(),
  startTime: z.string().min(1, "Start time required"),
  endTime: z.string().min(1, "End time required"),
  priceEgp: z.preprocess(
    (value) => value === "" || value == null ? null : Number(value),
    z.number().int().min(0).nullish(),
  ),
  packageEligible: z.boolean().default(true),
  location: z.string().nullish(),
  isRecurring: z.boolean().default(true),
  effectiveFrom: z.string().nullish(),
  effectiveUntil: z.string().nullish(),
}).superRefine((value, ctx) => {
  if (value.type === "weekly" && value.dayOfWeek == null) {
    ctx.addIssue({ code: "custom", path: ["dayOfWeek"], message: "Day of week is required" });
  }
  if (value.type === "one_time" && !value.date) {
    ctx.addIssue({ code: "custom", path: ["date"], message: "Date is required" });
  }
});

type FormValues = z.input<typeof formSchema>;
type Schedule = {
  id: number;
  classId: number;
  branchId?: number | null;
  roomId?: number | null;
  branch?: ScheduleBranch | null;
  room?: ScheduleRoom | null;
  type: "weekly" | "one_time";
  status: "active" | "completed" | "expired" | "cancelled";
  dayOfWeek?: number | null;
  date?: string | null;
  startTime: string;
  endTime: string;
  priceEgp?: number | null;
  packageEligible: boolean;
  location?: string | null;
  isRecurring: boolean;
};

function statusLabel(status: Schedule["status"]) {
  switch (status) {
    case "active": return "Active";
    case "completed": return "Completed";
    case "expired": return "Expired";
    case "cancelled": return "Cancelled";
  }
}

function statusBadgeClass(status: Schedule["status"]) {
  switch (status) {
    case "active": return "bg-emerald-500/15 text-emerald-300 border-emerald-400/30";
    case "completed": return "bg-cyan-500/15 text-cyan-300 border-cyan-400/30";
    case "expired": return "bg-slate-500/15 text-slate-300 border-slate-400/30";
    case "cancelled": return "bg-red-500/15 text-red-300 border-red-400/30";
  }
}

function formatScheduleLocation(schedule: Schedule): string {
  const branchName = schedule.branch?.name?.trim();
  const roomName = schedule.room?.name?.trim();
  const legacyLocation = schedule.location?.trim();

  if (branchName && roomName) return `${branchName} · ${roomName}`;
  if (branchName) return branchName;
  if (legacyLocation) return legacyLocation;
  return "—";
}

export default function Schedules() {
  const { can } = useAdminAuth();
  const canCreate = can("schedules", "create");
  const canEdit = can("schedules", "edit");
  const canDelete = can("schedules", "delete");
  const { data: schedules, isLoading } = useListSchedules();
  const { data: classes } = useListClasses();
  const createSchedule = useCreateSchedule();
  const updateSchedule = useUpdateSchedule();
  const deleteSchedule = useDeleteSchedule();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Schedule | null>(null);

  const handleDeleteSchedule = (id: number) => {
    if (confirm("Permanently delete this schedule? (Schedules with existing bookings or attendance cannot be deleted and should be cancelled instead.)")) {
      deleteSchedule.mutate(
        { id },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListSchedulesQueryKey() });
            toast({ title: "Schedule deleted successfully" });
          },
          onError: (err: unknown) => {
            const errMsg = err instanceof Error ? err.message : String(err);
            const isBlocked = /SCHEDULE_DELETE_NOT_ALLOWED|existing bookings|attendance|credit records/i.test(errMsg);
            toast({
              title: "Cannot delete schedule",
              description: isBlocked
                ? "This schedule has existing bookings or attendance records and cannot be permanently deleted. Change its status to 'Cancelled' instead."
                : errMsg || "Failed to delete schedule.",
              variant: "destructive",
            });
          },
        },
      );
    }
  };

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      type: "weekly",
      branchId: null,
      roomId: null,
      status: "active",
      dayOfWeek: 1,
      date: "",
      startTime: "10:00",
      endTime: "11:00",
      priceEgp: null,
      packageEligible: true,
      isRecurring: true,
    },
  });
  const selectedType = form.watch("type");

  const openCreate = () => {
    setEditing(null);
    form.reset({
      type: "weekly",
      branchId: null,
      roomId: null,
      status: "active",
      dayOfWeek: 1,
      date: "",
      startTime: "10:00",
      endTime: "11:00",
      priceEgp: null,
      packageEligible: true,
      isRecurring: true,
    });
    setOpen(true);
  };

  const openEdit = (s: Schedule) => {
    setEditing(s);
    form.reset({
      classId: s.classId,
      branchId: s.branchId ?? null,
      roomId: s.roomId ?? null,
      type: s.type ?? (s.isRecurring ? "weekly" : "one_time"),
      status: s.status ?? "active",
      dayOfWeek: s.dayOfWeek ?? 1,
      date: s.date ?? "",
      startTime: s.startTime,
      endTime: s.endTime,
      priceEgp: s.priceEgp ?? null,
      packageEligible: s.packageEligible ?? true,
      location: s.location ?? "",
      isRecurring: s.isRecurring,
    });
    setOpen(true);
  };

  const { toast } = useToast();

  const onSubmit = (values: FormValues) => {
    if (!values.branchId) { form.setError("branchId", { message: "Branch is required" }); return; }
    if (!values.roomId) { form.setError("roomId", { message: "Room is required" }); return; }
    const parsed = formSchema.parse(values);
    const payload = {
      ...parsed,
      branchId: values.branchId,
      roomId: values.roomId,
      dayOfWeek: parsed.type === "weekly" ? parsed.dayOfWeek : parsed.dayOfWeek ?? undefined,
      date: parsed.type === "one_time" ? parsed.date : null,
      isRecurring: parsed.type === "weekly",
      priceEgp: parsed.priceEgp ?? null,
      packageEligible: parsed.packageEligible,
    };
    const invalidate = () => { queryClient.invalidateQueries({ queryKey: getListSchedulesQueryKey() }); setOpen(false); };
    if (editing) {
      updateSchedule.mutate(
        { id: editing.id, data: payload },
        {
          onSuccess: invalidate,
          onError: (err: unknown) => {
            const errMsg = err instanceof Error ? err.message : String(err);
            const errCode = (err as { code?: string })?.code;
            const isImmutable = errCode === "SCHEDULE_LOCATION_IMMUTABLE" || /SCHEDULE_LOCATION_IMMUTABLE|cannot be changed after schedule activity/i.test(errMsg);
            toast({
              title: "Schedule update failed",
              description: isImmutable
                ? "This schedule location cannot be changed because it has existing bookings or attendance."
                : errMsg || "Failed to update schedule. Please try again.",
              variant: "destructive",
            });
          },
        },
      );
    } else {
      createSchedule.mutate({ data: { ...payload, branchId: values.branchId!, roomId: values.roomId! } }, { onSuccess: invalidate });
    }
  };

  const getClassName = (id: number) => classes?.find((c) => c.id === id)?.title ?? `Class #${id}`;

  return (
    <div className="space-y-6">
      <PageHeader title="Schedules" description="Weekly classes and one-time workshops" mode="studio" addLabel="Add Schedule" addTestId="button-add-schedule" onAdd={canCreate ? openCreate : undefined} />

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Class</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Date / Day</TableHead>
              <TableHead>Time</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Package</TableHead>
              <TableHead>Location</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={9} className="text-center py-8">Loading...</TableCell></TableRow>
            ) : schedules?.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No schedules yet.</TableCell></TableRow>
            ) : (
              schedules?.map((schedule) => (
                <TableRow key={schedule.id} data-testid={`row-schedule-${schedule.id}`}>
                  <TableCell className="font-medium">{getClassName(schedule.classId)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={statusBadgeClass((schedule.status ?? "active") as Schedule["status"])}>
                      {statusLabel((schedule.status ?? "active") as Schedule["status"])}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={schedule.type === "one_time" ? "secondary" : "default"}>
                      {schedule.type === "one_time" ? "One-time" : "Weekly"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {schedule.type === "one_time"
                      ? schedule.date ?? "Date not set"
                      : schedule.dayOfWeek != null ? DAY_SHORT[schedule.dayOfWeek] : "Day not set"}
                  </TableCell>
                  <TableCell>{schedule.startTime} – {schedule.endTime}</TableCell>
                  <TableCell>{schedule.priceEgp != null ? `EGP ${schedule.priceEgp}` : "Default"}</TableCell>
                  <TableCell>
                    <Badge variant={schedule.packageEligible ? "default" : "outline"}>
                      {schedule.packageEligible ? "Eligible" : "Pay only"}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatScheduleLocation(schedule)}</TableCell>
                  <TableCell className="text-right space-x-1">
                    {canEdit && (
                      <Button variant="ghost" size="icon" data-testid={`button-edit-schedule-${schedule.id}`} onClick={() => openEdit(schedule)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                    )}
                    {canDelete && (
                      <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" data-testid={`button-delete-schedule-${schedule.id}`} onClick={() => handleDeleteSchedule(schedule.id)}>
                        <Trash2 className="h-4 w-4" />
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
            <DialogTitle>{editing ? "Edit Schedule" : "Add Schedule"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="classId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Class</FormLabel>
                  <Select onValueChange={(v) => field.onChange(Number(v))} value={field.value ? String(field.value) : ""}>
                    <FormControl><SelectTrigger data-testid="select-schedule-class"><SelectValue placeholder="Select class" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {classes?.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.title}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <BranchRoomFields
                branchId={form.watch("branchId")}
                roomId={form.watch("roomId")}
                currentBranch={editing?.branch}
                currentRoom={editing?.room}
                onBranchChange={(id) => { form.setValue("branchId", id, { shouldValidate: true }); form.setValue("roomId", null, { shouldValidate: true }); }}
                onRoomChange={(id) => form.setValue("roomId", id, { shouldValidate: true })}
                branchError={form.formState.errors.branchId?.message}
                roomError={form.formState.errors.roomId?.message}
              />
              <FormField control={form.control} name="type" render={({ field }) => (
                <FormItem>
                  <FormLabel>Schedule Type</FormLabel>
                  <Select
                    onValueChange={(value) => {
                      field.onChange(value);
                      form.setValue("isRecurring", value === "weekly");
                    }}
                    value={field.value ?? "weekly"}
                  >
                    <FormControl><SelectTrigger data-testid="select-schedule-type"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="weekly">Regular weekly class</SelectItem>
                      <SelectItem value="one_time">One-time workshop / class</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="status" render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? "active"}>
                    <FormControl><SelectTrigger data-testid="select-schedule-status"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="completed">Completed / Full</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                      <SelectItem value="expired">Expired</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              {selectedType === "weekly" ? (
                <FormField control={form.control} name="dayOfWeek" render={({ field }) => (
                <FormItem>
                  <FormLabel>Day of Week</FormLabel>
                  <Select onValueChange={(v) => field.onChange(Number(v))} value={field.value == null ? "" : String(field.value)}>
                    <FormControl><SelectTrigger data-testid="select-schedule-day"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {DAYS.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
                )} />
              ) : (
                <FormField control={form.control} name="date" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date</FormLabel>
                    <FormControl><Input type="date" data-testid="input-schedule-date" {...field} value={field.value ?? ""} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              )}
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="startTime" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start Time</FormLabel>
                    <FormControl><Input type="time" data-testid="input-schedule-start" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="endTime" render={({ field }) => (
                  <FormItem>
                    <FormLabel>End Time</FormLabel>
                    <FormControl><Input type="time" data-testid="input-schedule-end" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="priceEgp" render={({ field }) => (
                <FormItem>
                  <FormLabel>Custom Price (EGP)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      data-testid="input-schedule-price"
                      placeholder="Use default class price"
                      {...field}
                      value={field.value == null ? "" : String(field.value)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="location" render={({ field }) => (
                <FormItem>
                  <FormLabel>Location</FormLabel>
                  <FormControl><Input data-testid="input-schedule-location" placeholder="Studio A" {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="isRecurring" render={({ field }) => (
                <FormItem className="hidden">
                  <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="packageEligible" render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <FormLabel className="!mt-0">Package credit eligible</FormLabel>
                    <p className="text-sm text-muted-foreground">Allow this schedule to be booked and checked in with package credits.</p>
                  </div>
                  <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" data-testid="button-submit-schedule" disabled={createSchedule.isPending || updateSchedule.isPending}>
                  {editing ? "Save Changes" : "Add Schedule"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
