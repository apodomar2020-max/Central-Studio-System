/** Ballet Classes: one complete Class + weekly Schedule form. */
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Trash2, Edit, Loader2 } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_URL as string | undefined ?? "";
const API_KEY = import.meta.env.VITE_API_KEY as string | undefined ?? "";
const CATALOG_LIMIT = 100;
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function makeHeaders(token: string | null): HeadersInit {
  return { "Content-Type": "application/json", ...(API_KEY ? { "x-api-key": API_KEY } : {}), ...(token ? { "x-admin-token": token } : {}) };
}
async function adminFetch<T>(url: string, init: RequestInit, token: string | null): Promise<T> {
  const res = await fetch(url, { ...init, headers: makeHeaders(token) });
  if (!res.ok) throw { data: await res.json().catch(() => ({})) };
  return res.json() as Promise<T>;
}

interface Schedule { id: number; dayOfWeek: number; startTime: string; endTime: string; durationMins: number; status: "active" | "deactivated" | "cancelled"; }
interface BalletClass { id: number; title: string; isLegacy: boolean; levelId: number | null; groupId: number | null; instructorId: number | null; classImageUrl?: string | null; classVideoUrl?: string | null; isActive: boolean; schedule: Schedule | null; }
interface BalletInstructor { id: number; name: string; isActive: boolean; }
interface BalletGroup { id: number; name: string; levelId: number; isActive: boolean; }
interface BalletLevel { id: number; name: string; isActive: boolean; }
interface ListResponse<T> { data: T[]; total: number; page: number; limit: number; totalPages: number; }

const formSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  levelId: z.number().int().positive("Level is required"),
  groupId: z.number().int().positive("Group is required"),
  instructorId: z.number().int().positive("Instructor is required"),
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().min(1, "Start time is required"),
  endTime: z.string().min(1, "End time is required"),
  classImageUrl: z.string().url("Must be a valid URL").nullish().or(z.literal("")),
  classVideoUrl: z.string().url("Must be a valid URL").nullish().or(z.literal("")),
  isActive: z.boolean(),
});
type FormValues = z.infer<typeof formSchema>;
const EMPTY_VALUES: FormValues = { title: "", levelId: 0, groupId: 0, instructorId: 0, dayOfWeek: 0, startTime: "", endTime: "", classImageUrl: "", classVideoUrl: "", isActive: true };

function deriveDuration(start: string, end: string): number | null {
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return null;
  const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  const result = minutes(end) - minutes(start);
  return result > 0 ? result : null;
}

export default function BalletClassesPage() {
  const { token, can } = useAdminAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<BalletClass | null>(null);
  const form = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: EMPTY_VALUES, mode: "onChange", reValidateMode: "onChange" });
  const selectedLevelId = form.watch("levelId");
  const startTime = form.watch("startTime");
  const endTime = form.watch("endTime");

  const { data, isLoading } = useQuery({ queryKey: ["admin-ballet-classes", token], queryFn: () => adminFetch<ListResponse<BalletClass>>(`${API_BASE}/api/admin/ballet/classes?limit=${CATALOG_LIMIT}`, {}, token), refetchOnWindowFocus: false });
  const { data: instructorsData } = useQuery({ queryKey: ["admin-ballet-instructors-ref", token], queryFn: () => adminFetch<ListResponse<BalletInstructor>>(`${API_BASE}/api/admin/ballet/instructors?limit=${CATALOG_LIMIT}`, {}, token), refetchOnWindowFocus: false });
  const { data: groupsData } = useQuery({ queryKey: ["admin-ballet-groups-ref", token], queryFn: () => adminFetch<ListResponse<BalletGroup>>(`${API_BASE}/api/admin/ballet/groups?limit=${CATALOG_LIMIT}`, {}, token), refetchOnWindowFocus: false });
  const { data: levelsData } = useQuery({ queryKey: ["admin-ballet-levels-ref", token], queryFn: () => adminFetch<{ levels: BalletLevel[] }>(`${API_BASE}/api/admin/ballet/levels`, {}, token), refetchOnWindowFocus: false });
  const classes = data?.data ?? [];
  const instructors = instructorsData?.data ?? [];
  const groups = groupsData?.data ?? [];
  const levels = levelsData?.levels ?? [];
  const selectableLevels = levels.filter((item) => item.isActive || item.id === editing?.levelId);
  const selectableGroups = groups.filter((item) => item.levelId === selectedLevelId && (item.isActive || item.id === editing?.groupId));
  const selectableInstructors = instructors.filter((item) => item.isActive || item.id === editing?.instructorId);
  const duration = useMemo(() => deriveDuration(startTime, endTime), [startTime, endTime]);

  const invalidate = () => Promise.all([
    qc.invalidateQueries({ queryKey: ["admin-ballet-classes"] }),
    qc.invalidateQueries({ queryKey: ["admin-ballet-schedules"] }),
    qc.invalidateQueries({ queryKey: ["admin-ballet-groups"] }),
  ]);
  const createMutation = useMutation({ mutationFn: (body: object) => adminFetch(`${API_BASE}/api/admin/ballet/classes`, { method: "POST", body: JSON.stringify(body) }, token), onSuccess: async () => { await invalidate(); toast({ title: "Class and schedule created" }); setOpen(false); }, onError: (e: any) => toast({ title: "Error", description: e?.data?.error ?? "Failed to create class", variant: "destructive" }) });
  const updateMutation = useMutation({ mutationFn: ({ id, body }: { id: number; body: object }) => adminFetch(`${API_BASE}/api/admin/ballet/classes/${id}`, { method: "PATCH", body: JSON.stringify(body) }, token), onSuccess: async () => { await invalidate(); toast({ title: "Class and schedule updated" }); setOpen(false); }, onError: (e: any) => toast({ title: "Error", description: e?.data?.error ?? "Failed to update class", variant: "destructive" }) });

  const openCreate = () => { setEditing(null); form.reset(EMPTY_VALUES); setOpen(true); };
  const openEdit = (item: BalletClass) => {
    if (item.isLegacy) { toast({ title: "Historical Class", description: "This Class uses the retired Ballet Class model. Create a new Class to resume the program.", variant: "destructive" }); return; }
    if (!item.schedule || item.levelId == null || item.groupId == null || item.instructorId == null) { toast({ title: "Class data requires review", description: "This class has no weekly schedule.", variant: "destructive" }); return; }
    setEditing(item);
    form.reset({ title: item.title, levelId: item.levelId, groupId: item.groupId, instructorId: item.instructorId, dayOfWeek: item.schedule.dayOfWeek, startTime: item.schedule.startTime, endTime: item.schedule.endTime, classImageUrl: item.classImageUrl ?? "", classVideoUrl: item.classVideoUrl ?? "", isActive: item.isActive });
    setOpen(true);
  };
  const onSubmit = (values: FormValues) => {
    const unchangedHistoricalStatus = editing?.schedule && values.isActive === editing.isActive
      ? editing.schedule.status
      : null;
    const body = {
      ...values,
      scheduleStatus: unchangedHistoricalStatus ?? (values.isActive ? "active" : "deactivated"),
      classImageUrl: values.classImageUrl || null,
      classVideoUrl: values.classVideoUrl || null,
    };
    editing ? updateMutation.mutate({ id: editing.id, body }) : createMutation.mutate(body);
  };
  const setLevel = (value: string, onChange: (value: number) => void) => { onChange(Number(value)); form.setValue("groupId", 0, { shouldValidate: true }); };
  const isSaving = createMutation.isPending || updateMutation.isPending;

  return <div className="space-y-6">
    <PageHeader title="Ballet Classes" description="Each class has one level, group, instructor, and weekly schedule" mode="stage" addLabel="Add Class" addTestId="button-add-ballet-class" onAdd={can("ballet.classes", "create") ? openCreate : undefined} />
    <div className="border rounded-md"><Table><TableHeader><TableRow><TableHead>Title</TableHead><TableHead>Level / Group</TableHead><TableHead>Instructor</TableHead><TableHead>Weekly Schedule</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>
      {isLoading ? <TableRow><TableCell colSpan={6} className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></TableCell></TableRow> : classes.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No ballet classes yet.</TableCell></TableRow> : classes.map((item) => <TableRow key={item.id} data-testid={`row-ballet-class-${item.id}`}>
        <TableCell className="font-medium">{item.title}{item.isLegacy && <div className="mt-1"><Badge variant="secondary" data-testid={`badge-legacy-class-${item.id}`}>Historical Class</Badge><p className="text-xs text-muted-foreground mt-1">This Class uses the retired Ballet Class model. Create a new Class to resume the program.</p></div>}</TableCell><TableCell>{item.levelId == null ? "—" : levels.find((x) => x.id === item.levelId)?.name ?? `#${item.levelId}`} · {item.groupId == null ? "—" : groups.find((x) => x.id === item.groupId)?.name ?? `#${item.groupId}`}</TableCell><TableCell>{item.instructorId == null ? "—" : instructors.find((x) => x.id === item.instructorId)?.name ?? `#${item.instructorId}`}</TableCell><TableCell>{item.schedule ? `${DAYS[item.schedule.dayOfWeek]} ${item.schedule.startTime}–${item.schedule.endTime} (${item.schedule.durationMins} min)` : <Badge variant="destructive">Missing schedule</Badge>}</TableCell><TableCell><Badge variant={item.isActive ? "default" : "outline"}>{item.isActive ? "Active" : "Inactive"}</Badge></TableCell><TableCell className="text-right">
          {!item.isLegacy && can("ballet.classes", "edit") && <Button variant="ghost" size="icon" onClick={() => openEdit(item)}><Edit className="h-4 w-4" /></Button>}
          {!item.isLegacy && can("ballet.classes", "delete") && <Button variant="ghost" size="icon" title={item.isActive ? "Deactivate" : "Activate"} onClick={() => updateMutation.mutate({ id: item.id, body: { isActive: !item.isActive, scheduleStatus: item.isActive ? "deactivated" : "active" } })}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
        </TableCell></TableRow>)}
    </TableBody></Table></div>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{editing ? "Edit Ballet Class" : "Add Ballet Class"}</DialogTitle></DialogHeader><Form {...form}><form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <FormField control={form.control} name="title" render={({ field }) => <FormItem><FormLabel>Class title</FormLabel><FormControl><Input data-testid="input-ballet-class-title" {...field} /></FormControl><FormMessage /></FormItem>} />
      <FormField control={form.control} name="levelId" render={({ field }) => <FormItem><FormLabel>Level</FormLabel><Select value={field.value ? String(field.value) : ""} onValueChange={(value) => setLevel(value, field.onChange)}><FormControl><SelectTrigger data-testid="select-ballet-class-level"><SelectValue placeholder="Select active level" /></SelectTrigger></FormControl><SelectContent>{selectableLevels.map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>} />
      <FormField control={form.control} name="groupId" render={({ field }) => <FormItem><FormLabel>Group</FormLabel><Select value={field.value ? String(field.value) : ""} onValueChange={(value) => field.onChange(Number(value))} disabled={!selectedLevelId}><FormControl><SelectTrigger data-testid="select-ballet-class-group"><SelectValue placeholder={selectedLevelId ? "Select group in this level" : "Select a level first"} /></SelectTrigger></FormControl><SelectContent>{selectableGroups.map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>} />
      <FormField control={form.control} name="instructorId" render={({ field }) => <FormItem><FormLabel>Instructor</FormLabel><Select value={field.value ? String(field.value) : ""} onValueChange={(value) => field.onChange(Number(value))}><FormControl><SelectTrigger data-testid="select-ballet-class-instructor"><SelectValue placeholder="Select active instructor" /></SelectTrigger></FormControl><SelectContent>{selectableInstructors.map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>} />
      <FormField control={form.control} name="dayOfWeek" render={({ field }) => <FormItem><FormLabel>Day of Week</FormLabel><Select value={String(field.value)} onValueChange={(value) => field.onChange(Number(value))}><FormControl><SelectTrigger data-testid="select-ballet-class-day"><SelectValue /></SelectTrigger></FormControl><SelectContent>{DAYS.map((day, index) => <SelectItem key={day} value={String(index)}>{day}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>} />
      <div className="grid grid-cols-2 gap-4"><FormField control={form.control} name="startTime" render={({ field }) => <FormItem><FormLabel>Start Time</FormLabel><FormControl><Input type="time" data-testid="input-ballet-class-start" {...field} /></FormControl><FormMessage /></FormItem>} /><FormField control={form.control} name="endTime" render={({ field }) => <FormItem><FormLabel>End Time</FormLabel><FormControl><Input type="time" data-testid="input-ballet-class-end" {...field} /></FormControl><FormMessage /></FormItem>} /></div>
      <div className="space-y-2"><Label>Duration</Label><Input readOnly value={duration == null ? "Set a valid start and end time" : `${duration} minutes`} data-testid="input-ballet-class-duration" /></div>
      <FormField control={form.control} name="classImageUrl" render={({ field }) => <FormItem><FormLabel>Image URL (optional)</FormLabel><FormControl><Input {...field} value={field.value ?? ""} /></FormControl><FormMessage /></FormItem>} /><FormField control={form.control} name="classVideoUrl" render={({ field }) => <FormItem><FormLabel>Video URL (optional)</FormLabel><FormControl><Input {...field} value={field.value ?? ""} /></FormControl><FormMessage /></FormItem>} />
      <FormField control={form.control} name="isActive" render={({ field }) => <FormItem className="flex items-center gap-3"><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl><FormLabel className="!mt-0">Active</FormLabel></FormItem>} />
      <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" data-testid="button-submit-ballet-class" disabled={isSaving || duration == null}>{isSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}{editing ? "Save Changes" : "Create Class"}</Button></DialogFooter>
    </form></Form></DialogContent></Dialog>
  </div>;
}
