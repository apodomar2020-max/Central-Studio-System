/**
 * Ballet -> Schedules — /ballet/schedules
 *
 * Create and operate weekly Ballet schedule rows independently from Class
 * catalogue data. One Class may have several weekly sessions.
 */

import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { useToast } from "@/hooks/use-toast";
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
import { BranchRoomFields } from "@/components/schedules/BranchRoomFields";
import { useListScheduleLocationBranches, type ScheduleBranch, type ScheduleRoom } from "@workspace/api-client-react";
import { Trash2, Edit, Loader2, Plus } from "lucide-react";
import { adminFetch, scheduleErrorMessage } from "./balletScheduleApiClient";
import {
  BALLET_SCHEDULE_FORM_STATUSES,
  balletScheduleFormSchema,
  type BalletScheduleFormValues,
} from "./balletScheduleFormSchema";
import { TablePagination } from "@/components/shared/table-pagination";
import { fetchAllPages } from "@/lib/fetchAllPages";
import { TableToolbar } from "@/components/admin/table-toolbar";

const API_BASE = import.meta.env.VITE_API_URL as string | undefined ?? "";

const CATALOG_LIMIT = 100;
const PAGE_SIZE = 20;

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const STATUSES = BALLET_SCHEDULE_FORM_STATUSES;

type ScheduleSortOption = "default" | "start-time";
const SORT_LABELS: Record<ScheduleSortOption, string> = { default: "Default", "start-time": "Start time" };

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
  branchId: number | null;
  roomId: number | null;
  branch: ScheduleBranch | null;
  room: ScheduleRoom | null;
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

type FormValues = BalletScheduleFormValues;

const EMPTY_VALUES: FormValues = {
  classId: 0,
  branchId: null,
  roomId: null,
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
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<"all" | (typeof STATUSES)[number]>("all");
  const [classFilter, setClassFilter] = useState<number | "all">("all");
  const [dayFilter, setDayFilter] = useState<number | "all">("all");
  const [branchFilter, setBranchFilter] = useState<number | "all">("all");
  const [sort, setSort] = useState<ScheduleSortOption>("default");

  const onStatusChange = (value: "all" | (typeof STATUSES)[number]) => { setStatusFilter(value); setPage(1); };
  const onClassFilterChange = (value: number | "all") => { setClassFilter(value); setPage(1); };
  const onDayFilterChange = (value: number | "all") => { setDayFilter(value); setPage(1); };
  const onBranchFilterChange = (value: number | "all") => { setBranchFilter(value); setPage(1); };
  const onSortChange = (value: ScheduleSortOption) => { setSort(value); setPage(1); };
  const activeFilterCount = [statusFilter !== "all", classFilter !== "all", dayFilter !== "all", branchFilter !== "all"].filter(Boolean).length;
  const hasActiveControls = activeFilterCount > 0 || sort !== "default";
  const clearControls = () => { setStatusFilter("all"); setClassFilter("all"); setDayFilter("all"); setBranchFilter("all"); setSort("default"); setPage(1); };

  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-ballet-schedules", token, page, statusFilter, classFilter, dayFilter, branchFilter, sort],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE), sort });
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (classFilter !== "all") params.set("classId", String(classFilter));
      if (dayFilter !== "all") params.set("dayOfWeek", String(dayFilter));
      if (branchFilter !== "all") params.set("branchId", String(branchFilter));
      return adminFetch<ListResponse<BalletSchedule>>(`${API_BASE}/api/admin/ballet/schedules?${params}`, {}, token);
    },
    refetchOnWindowFocus: false,
  });
  const schedules = data?.data ?? [];
  const branchesQuery = useListScheduleLocationBranches();
  const branches = branchesQuery.data ?? [];

  // Reference lists resolve every schedule row's Class/Level/Group/Instructor
  // and populate the Create dialog's Class dropdown — they must reflect the
  // full catalogue, not just the first CATALOG_LIMIT rows.
  const { data: classes = [] } = useQuery({
    queryKey: ["admin-ballet-classes-ref", token],
    queryFn: () => fetchAllPages<BalletClass>((p) => adminFetch<ListResponse<BalletClass>>(`${API_BASE}/api/admin/ballet/classes?page=${p}&limit=${CATALOG_LIMIT}`, {}, token)),
    refetchOnWindowFocus: false,
  });

  const { data: instructors = [] } = useQuery({
    queryKey: ["admin-ballet-instructors-ref", token],
    queryFn: () => fetchAllPages<BalletInstructor>((p) => adminFetch<ListResponse<BalletInstructor>>(`${API_BASE}/api/admin/ballet/instructors?page=${p}&limit=${CATALOG_LIMIT}`, {}, token)),
    refetchOnWindowFocus: false,
  });

  const { data: groups = [] } = useQuery({
    queryKey: ["admin-ballet-groups-ref", token],
    queryFn: () => fetchAllPages<BalletGroup>((p) => adminFetch<ListResponse<BalletGroup>>(`${API_BASE}/api/admin/ballet/groups?page=${p}&limit=${CATALOG_LIMIT}`, {}, token)),
    refetchOnWindowFocus: false,
  });

  const { data: levelsData } = useQuery({
    queryKey: ["admin-ballet-levels-ref", token],
    queryFn: () => adminFetch<{ levels: BalletLevel[] }>(`${API_BASE}/api/admin/ballet/levels`, {}, token),
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
    mutationFn: (body: object) => adminFetch(`${API_BASE}/api/admin/ballet/schedules`, { method: "POST", body: JSON.stringify(body) }, token),
    onSuccess: async () => { await invalidate(); toast({ title: "Schedule created" }); setOpen(false); },
    onError: (e: unknown) => toast({ title: "Error", description: scheduleErrorMessage(e, "Failed to create schedule."), variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) => adminFetch(`${API_BASE}/api/admin/ballet/schedules/${id}`, { method: "PATCH", body: JSON.stringify(body) }, token),
    onSuccess: async () => { await invalidate(); toast({ title: "Schedule updated" }); setOpen(false); },
    onError: (e: unknown) => toast({ title: "Error", description: scheduleErrorMessage(e, "Failed to update schedule."), variant: "destructive" }),
  });

  const form = useForm<FormValues>({ resolver: zodResolver(balletScheduleFormSchema), defaultValues: EMPTY_VALUES, mode: "onChange", reValidateMode: "onChange" });

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
      branchId: s.branchId,
      roomId: s.roomId,
      dayOfWeek: s.dayOfWeek,
      startTime: s.startTime,
      endTime: s.endTime,
      status: s.status,
    });
    setOpen(true);
  };

  const onSubmit = (values: FormValues) => {
    if (!editing && !values.branchId) { form.setError("branchId", { message: "Branch is required" }); return; }
    if (!editing && !values.roomId) { form.setError("roomId", { message: "Room is required" }); return; }
    if (values.branchId && !values.roomId) { form.setError("roomId", { message: "Room is required after selecting a Branch" }); return; }
    const parsed = balletScheduleFormSchema.parse(values);
    if (editing) {
      updateMutation.mutate({
        id: editing.id,
        body: {
          dayOfWeek: parsed.dayOfWeek,
          branchId: parsed.branchId,
          roomId: parsed.roomId,
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
    <div className="admin2-ballet-page admin2-ballet-registry space-y-6">
      <TableToolbar
        searchValue=""
        onSearchChange={() => {}}
        className="admin2-ballet-schedules-toolbar"
        activeFilterCount={activeFilterCount}
        onClear={hasActiveControls ? clearControls : undefined}
        activeSortLabel={sort !== "default" ? SORT_LABELS[sort] : undefined}
        filtersContent={
          <>
            <div className="admin2-table-toolbar-panel-group">
              <span>Status</span>
              <div className="admin2-filter-pills">
                <Button type="button" variant="outline" size="compact" aria-pressed={statusFilter === "all"} className={statusFilter === "all" ? "is-selected" : undefined} onClick={() => onStatusChange("all")}>All</Button>
                {STATUSES.map((s) => (
                  <Button key={s} type="button" variant="outline" size="compact" aria-pressed={statusFilter === s} className={statusFilter === s ? "is-selected" : undefined} onClick={() => onStatusChange(s)}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </Button>
                ))}
              </div>
            </div>
            <div className="admin2-table-toolbar-panel-group">
              <span>Day</span>
              <div className="admin2-filter-pills">
                <Button type="button" variant="outline" size="compact" aria-pressed={dayFilter === "all"} className={dayFilter === "all" ? "is-selected" : undefined} onClick={() => onDayFilterChange("all")}>All</Button>
                {DAY_SHORT.map((d, i) => (
                  <Button key={i} type="button" variant="outline" size="compact" aria-pressed={dayFilter === i} className={dayFilter === i ? "is-selected" : undefined} onClick={() => onDayFilterChange(i)}>
                    {d}
                  </Button>
                ))}
              </div>
            </div>
            {eligibleClasses.length > 0 && (
              <div className="admin2-table-toolbar-panel-group">
                <span>Class</span>
                <div className="admin2-filter-pills">
                  <Button type="button" variant="outline" size="compact" aria-pressed={classFilter === "all"} className={classFilter === "all" ? "is-selected" : undefined} onClick={() => onClassFilterChange("all")}>All</Button>
                  {eligibleClasses.map((c) => (
                    <Button key={c.id} type="button" variant="outline" size="compact" aria-pressed={classFilter === c.id} className={classFilter === c.id ? "is-selected" : undefined} onClick={() => onClassFilterChange(c.id)}>
                      {c.title}
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {branches.length > 0 && (
              <div className="admin2-table-toolbar-panel-group">
                <span>Branch</span>
                <div className="admin2-filter-pills">
                  <Button type="button" variant="outline" size="compact" aria-pressed={branchFilter === "all"} className={branchFilter === "all" ? "is-selected" : undefined} onClick={() => onBranchFilterChange("all")}>All</Button>
                  {branches.map((b) => (
                    <Button key={b.id} type="button" variant="outline" size="compact" aria-pressed={branchFilter === b.id} className={branchFilter === b.id ? "is-selected" : undefined} onClick={() => onBranchFilterChange(b.id)}>
                      {b.name}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </>
        }
        sortContent={
          <div className="admin2-table-toolbar-panel-group">
            <span>Sort by</span>
            <div className="admin2-filter-pills">
              {(Object.keys(SORT_LABELS) as ScheduleSortOption[]).map((value) => (
                <Button key={value} type="button" variant="outline" size="compact" aria-pressed={sort === value} className={sort === value ? "is-selected" : undefined} onClick={() => onSortChange(value)}>
                  {SORT_LABELS[value]}
                </Button>
              ))}
            </div>
          </div>
        }
      >
        {canCreate && (
          <div className="admin2-table-toolbar-add">
            <Button data-testid="button-add-ballet-schedule" onClick={openCreate} className="gap-2 shrink-0" data-program-accent="ballet">
              <Plus className="h-4 w-4" />
              Add Schedule
            </Button>
          </div>
        )}
      </TableToolbar>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Class</TableHead>
              <TableHead>Level</TableHead>
              <TableHead>Group</TableHead>
              <TableHead>Instructor</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Day</TableHead>
              <TableHead>Time</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={10} className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></TableCell></TableRow>
            ) : isError ? (
              <TableRow><TableCell colSpan={10} className="text-center py-8 text-destructive">Ballet schedules could not be loaded.</TableCell></TableRow>
            ) : schedules.length === 0 ? (
              <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">{hasActiveControls ? "No schedules match your filters." : "No ballet schedules yet."}</TableCell></TableRow>
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
                    <TableCell>{s.branch && s.room ? `${s.branch.name} · ${s.room.name}` : "—"}</TableCell>
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

      {data && data.total > 0 && (
        <TablePagination page={page} totalPages={data.totalPages} total={data.total} pageSize={PAGE_SIZE} isLoading={isLoading} itemLabel="schedules" onPageChange={setPage} />
      )}

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
import "./admin2-ballet.css";
