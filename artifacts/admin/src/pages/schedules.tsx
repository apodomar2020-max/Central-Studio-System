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
import { Trash2, Edit } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const formSchema = z.object({
  classId: z.coerce.number().int().min(1, "Class is required"),
  dayOfWeek: z.coerce.number().int().min(0).max(6),
  startTime: z.string().min(1, "Start time required"),
  endTime: z.string().min(1, "End time required"),
  location: z.string().nullish(),
  isRecurring: z.boolean().default(true),
  effectiveFrom: z.string().nullish(),
  effectiveUntil: z.string().nullish(),
});

type FormValues = z.input<typeof formSchema>;
type Schedule = { id: number; classId: number; dayOfWeek: number; startTime: string; endTime: string; location?: string | null; isRecurring: boolean };

export default function Schedules() {
  const { data: schedules, isLoading } = useListSchedules();
  const { data: classes } = useListClasses();
  const createSchedule = useCreateSchedule();
  const updateSchedule = useUpdateSchedule();
  const deleteSchedule = useDeleteSchedule();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Schedule | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { dayOfWeek: 1, startTime: "10:00", endTime: "11:00", isRecurring: true },
  });

  const openCreate = () => {
    setEditing(null);
    form.reset({ dayOfWeek: 1, startTime: "10:00", endTime: "11:00", isRecurring: true });
    setOpen(true);
  };

  const openEdit = (s: Schedule) => {
    setEditing(s);
    form.reset({ classId: s.classId, dayOfWeek: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime, location: s.location ?? "", isRecurring: s.isRecurring });
    setOpen(true);
  };

  const onSubmit = (values: FormValues) => {
    const parsed = formSchema.parse(values);
    const invalidate = () => { queryClient.invalidateQueries({ queryKey: getListSchedulesQueryKey() }); setOpen(false); };
    if (editing) {
      updateSchedule.mutate({ id: editing.id, data: parsed }, { onSuccess: invalidate });
    } else {
      createSchedule.mutate({ data: parsed }, { onSuccess: invalidate });
    }
  };

  const handleDelete = (id: number) => {
    if (confirm("Delete this schedule?")) {
      deleteSchedule.mutate({ id }, { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListSchedulesQueryKey() }) });
    }
  };

  const getClassName = (id: number) => classes?.find((c) => c.id === id)?.title ?? `Class #${id}`;

  return (
    <div className="space-y-6">
      <PageHeader title="Schedules" description="Weekly class timetable" mode="studio" addLabel="Add Schedule" addTestId="button-add-schedule" onAdd={openCreate} />

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Class</TableHead>
              <TableHead>Day</TableHead>
              <TableHead>Time</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Recurring</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8">Loading...</TableCell></TableRow>
            ) : schedules?.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No schedules yet.</TableCell></TableRow>
            ) : (
              schedules?.map((schedule) => (
                <TableRow key={schedule.id} data-testid={`row-schedule-${schedule.id}`}>
                  <TableCell className="font-medium">{getClassName(schedule.classId)}</TableCell>
                  <TableCell>{DAY_SHORT[schedule.dayOfWeek]}</TableCell>
                  <TableCell>{schedule.startTime} – {schedule.endTime}</TableCell>
                  <TableCell>{schedule.location ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={schedule.isRecurring ? "default" : "outline"}>{schedule.isRecurring ? "Weekly" : "One-off"}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" data-testid={`button-edit-schedule-${schedule.id}`} onClick={() => openEdit(schedule)}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" data-testid={`button-delete-schedule-${schedule.id}`} onClick={() => handleDelete(schedule.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
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
              <FormField control={form.control} name="dayOfWeek" render={({ field }) => (
                <FormItem>
                  <FormLabel>Day of Week</FormLabel>
                  <Select onValueChange={(v) => field.onChange(Number(v))} value={String(field.value)}>
                    <FormControl><SelectTrigger data-testid="select-schedule-day"><SelectValue /></SelectTrigger></FormControl>
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
              <FormField control={form.control} name="location" render={({ field }) => (
                <FormItem>
                  <FormLabel>Location</FormLabel>
                  <FormControl><Input data-testid="input-schedule-location" placeholder="Studio A" {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="isRecurring" render={({ field }) => (
                <FormItem className="flex items-center gap-3">
                  <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  <FormLabel className="!mt-0">Recurring weekly</FormLabel>
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
