/** Ballet Classes: catalogue and relationship fields only. */
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Trash2, Edit, Loader2, Plus } from "lucide-react";
import { TablePagination } from "@/components/shared/table-pagination";
import { fetchAllPages } from "@/lib/fetchAllPages";
import { TableToolbar } from "@/components/admin/table-toolbar";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

const API_BASE = import.meta.env.VITE_API_URL as string | undefined ?? "";
const CATALOG_LIMIT = 100;
const PAGE_SIZE = 20;

type StatusFilter = "all" | "active" | "inactive";
type SortOption = "default" | "title" | "title-desc";
const SORT_LABELS: Record<SortOption, string> = { default: "Default", title: "Title (A–Z)", "title-desc": "Title (Z–A)" };
function makeHeaders(token: string | null): HeadersInit {
  return { "Content-Type": "application/json", ...(token ? { "x-admin-token": token } : {}) };
}
async function adminFetch<T>(url: string, init: RequestInit, token: string | null): Promise<T> {
  const res = await fetch(url, { ...init, headers: makeHeaders(token) });
  if (!res.ok) throw { data: await res.json().catch(() => ({})) };
  return res.json() as Promise<T>;
}

interface Schedule { id: number; dayOfWeek: number; startTime: string; endTime: string; durationMins: number; status: "active" | "deactivated" | "cancelled"; }
interface BalletClass { id: number; title: string; isLegacy: boolean; levelId: number | null; groupId: number | null; instructorId: number | null; classImageUrl?: string | null; classVideoUrl?: string | null; isActive: boolean; schedules?: Schedule[]; /** @deprecated Use schedules[] instead. */ schedule?: Schedule | null; }
interface BalletInstructor { id: number; name: string; isActive: boolean; }
interface BalletGroup { id: number; name: string; levelId: number; isActive: boolean; }
interface BalletLevel { id: number; name: string; isActive: boolean; }
interface ListResponse<T> { data: T[]; total: number; page: number; limit: number; totalPages: number; }

const formSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  levelId: z.number().int().positive("Level is required"),
  groupId: z.number().int().positive("Group is required"),
  instructorId: z.number().int().positive("Instructor is required"),
  classImageUrl: z.string().url("Must be a valid URL").nullish().or(z.literal("")),
  classVideoUrl: z.string().url("Must be a valid URL").nullish().or(z.literal("")),
  isActive: z.boolean(),
});
type FormValues = z.infer<typeof formSchema>;
const EMPTY_VALUES: FormValues = { title: "", levelId: 0, groupId: 0, instructorId: 0, classImageUrl: "", classVideoUrl: "", isActive: true };

export default function BalletClassesPage() {
  const { token, can } = useAdminAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<BalletClass | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [levelFilter, setLevelFilter] = useState<number | "all">("all");
  const [groupFilter, setGroupFilter] = useState<number | "all">("all");
  const [instructorFilter, setInstructorFilter] = useState<number | "all">("all");
  const [sort, setSort] = useState<SortOption>("default");
  const form = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: EMPTY_VALUES, mode: "onChange", reValidateMode: "onChange" });
  const selectedLevelId = form.watch("levelId");

  const onSearchChange = (value: string) => { setSearch(value); setPage(1); };
  const onStatusChange = (value: StatusFilter) => { setStatusFilter(value); setPage(1); };
  const onLevelFilterChange = (value: number | "all") => { setLevelFilter(value); setPage(1); };
  const onGroupFilterChange = (value: number | "all") => { setGroupFilter(value); setPage(1); };
  const onInstructorFilterChange = (value: number | "all") => { setInstructorFilter(value); setPage(1); };
  const onSortChange = (value: SortOption) => { setSort(value); setPage(1); };
  const activeFilterCount = [statusFilter !== "all", levelFilter !== "all", groupFilter !== "all", instructorFilter !== "all"].filter(Boolean).length;
  const hasActiveControls = activeFilterCount > 0 || sort !== "default" || search.length > 0;
  const clearControls = () => { setSearch(""); setStatusFilter("all"); setLevelFilter("all"); setGroupFilter("all"); setInstructorFilter("all"); setSort("default"); setPage(1); };

  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-ballet-classes", token, page, debouncedSearch, statusFilter, levelFilter, groupFilter, instructorFilter, sort],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE), sort });
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (levelFilter !== "all") params.set("levelId", String(levelFilter));
      if (groupFilter !== "all") params.set("groupId", String(groupFilter));
      if (instructorFilter !== "all") params.set("instructorId", String(instructorFilter));
      return adminFetch<ListResponse<BalletClass>>(`${API_BASE}/api/admin/ballet/classes?${params}`, {}, token);
    },
    refetchOnWindowFocus: false,
  });
  // Reference lists (instructors/groups) feed Create/Edit dropdowns and must
  // never be silently truncated — fetch every page, not just the first.
  const { data: instructors = [] } = useQuery({ queryKey: ["admin-ballet-instructors-ref", token], queryFn: () => fetchAllPages<BalletInstructor>((p) => adminFetch<ListResponse<BalletInstructor>>(`${API_BASE}/api/admin/ballet/instructors?page=${p}&limit=${CATALOG_LIMIT}`, {}, token)), refetchOnWindowFocus: false });
  const { data: groups = [] } = useQuery({ queryKey: ["admin-ballet-groups-ref", token], queryFn: () => fetchAllPages<BalletGroup>((p) => adminFetch<ListResponse<BalletGroup>>(`${API_BASE}/api/admin/ballet/groups?page=${p}&limit=${CATALOG_LIMIT}`, {}, token)), refetchOnWindowFocus: false });
  const { data: levelsData } = useQuery({ queryKey: ["admin-ballet-levels-ref", token], queryFn: () => adminFetch<{ levels: BalletLevel[] }>(`${API_BASE}/api/admin/ballet/levels`, {}, token), refetchOnWindowFocus: false });
  const classes = data?.data ?? [];
  const levels = levelsData?.levels ?? [];
  const selectableLevels = levels.filter((item) => item.isActive || item.id === editing?.levelId);
  const selectableGroups = groups.filter((item) => item.levelId === selectedLevelId && (item.isActive || item.id === editing?.groupId));
  const selectableInstructors = instructors.filter((item) => item.isActive || item.id === editing?.instructorId);

  const invalidate = () => Promise.all([
    qc.invalidateQueries({ queryKey: ["admin-ballet-classes"] }),
    qc.invalidateQueries({ queryKey: ["admin-ballet-schedules"] }),
    qc.invalidateQueries({ queryKey: ["admin-ballet-groups"] }),
  ]);
  const createMutation = useMutation({ mutationFn: (body: object) => adminFetch(`${API_BASE}/api/admin/ballet/classes`, { method: "POST", body: JSON.stringify(body) }, token), onSuccess: async () => { await invalidate(); toast({ title: "Class created" }); setOpen(false); }, onError: (e: any) => toast({ title: "Error", description: e?.data?.error ?? "Failed to create class", variant: "destructive" }) });
  const updateMutation = useMutation({ mutationFn: ({ id, body }: { id: number; body: object }) => adminFetch(`${API_BASE}/api/admin/ballet/classes/${id}`, { method: "PATCH", body: JSON.stringify(body) }, token), onSuccess: async () => { await invalidate(); toast({ title: "Class updated" }); setOpen(false); }, onError: (e: any) => toast({ title: "Error", description: e?.data?.error ?? "Failed to update class", variant: "destructive" }) });

  const openCreate = () => { setEditing(null); form.reset(EMPTY_VALUES); setOpen(true); };
  const openEdit = (item: BalletClass) => {
    if (item.isLegacy) { toast({ title: "Historical Class", description: "This Class uses the retired Ballet Class model. Create a new Class to resume the program.", variant: "destructive" }); return; }
    if (item.levelId == null || item.groupId == null || item.instructorId == null) { toast({ title: "Class data requires review", description: "This class is missing a required relationship.", variant: "destructive" }); return; }
    setEditing(item);
    form.reset({ title: item.title, levelId: item.levelId, groupId: item.groupId, instructorId: item.instructorId, classImageUrl: item.classImageUrl ?? "", classVideoUrl: item.classVideoUrl ?? "", isActive: item.isActive });
    setOpen(true);
  };
  const onSubmit = (values: FormValues) => {
    const body = {
      ...values,
      classImageUrl: values.classImageUrl || null,
      classVideoUrl: values.classVideoUrl || null,
    };
    editing ? updateMutation.mutate({ id: editing.id, body }) : createMutation.mutate(body);
  };
  const setLevel = (value: string, onChange: (value: number) => void) => { onChange(Number(value)); form.setValue("groupId", 0, { shouldValidate: true }); };
  const isSaving = createMutation.isPending || updateMutation.isPending;
  const schedulesFor = (item: BalletClass) => item.schedules ?? (item.schedule ? [item.schedule] : []);
  const renderScheduleSummary = (item: BalletClass) => {
    const schedules = schedulesFor(item);
    if (schedules.length === 0) return <Badge variant="outline">No schedules</Badge>;
    const activeCount = schedules.filter((schedule) => schedule.status === "active").length;
    return <div className="space-y-1"><div>{schedules.length === 1 ? "1 schedule" : `${schedules.length} schedules`}</div>{activeCount !== schedules.length && <div className="text-xs text-muted-foreground">{activeCount} active</div>}</div>;
  };

  const canCreate = can("ballet.classes", "create");

  return <div className="admin2-ballet-page admin2-ballet-registry space-y-6">
    <TableToolbar
      searchValue={search}
      onSearchChange={onSearchChange}
      searchPlaceholder="Search classes by title"
      searchTestId="input-ballet-class-search"
      activeFilterCount={activeFilterCount}
      onClear={hasActiveControls ? clearControls : undefined}
      activeSortLabel={sort !== "default" ? SORT_LABELS[sort] : undefined}
      filtersContent={
        <>
          <div className="admin2-table-toolbar-panel-group">
            <span>Status</span>
            <div className="admin2-filter-pills">
              {(["all", "active", "inactive"] as const).map((value) => (
                <Button key={value} type="button" variant="outline" size="compact" aria-pressed={statusFilter === value} className={statusFilter === value ? "is-selected" : undefined} onClick={() => onStatusChange(value)}>
                  {value === "all" ? "All" : value === "active" ? "Active" : "Inactive"}
                </Button>
              ))}
            </div>
          </div>
          {levels.length > 0 && (
            <div className="admin2-table-toolbar-panel-group">
              <span>Level</span>
              <div className="admin2-filter-pills">
                <Button type="button" variant="outline" size="compact" aria-pressed={levelFilter === "all"} className={levelFilter === "all" ? "is-selected" : undefined} onClick={() => onLevelFilterChange("all")}>All</Button>
                {levels.filter((l) => l.isActive).map((l) => (
                  <Button key={l.id} type="button" variant="outline" size="compact" aria-pressed={levelFilter === l.id} className={levelFilter === l.id ? "is-selected" : undefined} onClick={() => onLevelFilterChange(l.id)}>
                    {l.name}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {groups.length > 0 && (
            <div className="admin2-table-toolbar-panel-group">
              <span>Group</span>
              <div className="admin2-filter-pills">
                <Button type="button" variant="outline" size="compact" aria-pressed={groupFilter === "all"} className={groupFilter === "all" ? "is-selected" : undefined} onClick={() => onGroupFilterChange("all")}>All</Button>
                {groups.filter((g) => g.isActive).map((g) => (
                  <Button key={g.id} type="button" variant="outline" size="compact" aria-pressed={groupFilter === g.id} className={groupFilter === g.id ? "is-selected" : undefined} onClick={() => onGroupFilterChange(g.id)}>
                    {g.name}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {instructors.length > 0 && (
            <div className="admin2-table-toolbar-panel-group">
              <span>Instructor</span>
              <div className="admin2-filter-pills">
                <Button type="button" variant="outline" size="compact" aria-pressed={instructorFilter === "all"} className={instructorFilter === "all" ? "is-selected" : undefined} onClick={() => onInstructorFilterChange("all")}>All</Button>
                {instructors.filter((i) => i.isActive).map((i) => (
                  <Button key={i.id} type="button" variant="outline" size="compact" aria-pressed={instructorFilter === i.id} className={instructorFilter === i.id ? "is-selected" : undefined} onClick={() => onInstructorFilterChange(i.id)}>
                    {i.name}
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
            {(Object.keys(SORT_LABELS) as SortOption[]).map((value) => (
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
          <Button data-testid="button-add-ballet-class" onClick={openCreate} className="gap-2 shrink-0" data-program-accent="ballet">
            <Plus className="h-4 w-4" />
            Add Class
          </Button>
        </div>
      )}
    </TableToolbar>
    <div className="border rounded-md"><Table><TableHeader><TableRow><TableHead>Title</TableHead><TableHead>Level / Group</TableHead><TableHead>Instructor</TableHead><TableHead>Schedules</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>
      {isLoading ? <TableRow><TableCell colSpan={6} className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></TableCell></TableRow> : isError ? <TableRow><TableCell colSpan={6} className="text-center py-8 text-destructive">Ballet classes could not be loaded.</TableCell></TableRow> : classes.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{hasActiveControls ? "No classes match your search or filters." : "No ballet classes yet."}</TableCell></TableRow> : classes.map((item) => <TableRow key={item.id} data-testid={`row-ballet-class-${item.id}`}>
        <TableCell className="font-medium">{item.title}{item.isLegacy && <div className="mt-1"><Badge variant="secondary" data-testid={`badge-legacy-class-${item.id}`}>Historical Class</Badge><p className="text-xs text-muted-foreground mt-1">This Class uses the retired Ballet Class model. Create a new Class to resume the program.</p></div>}</TableCell><TableCell>{item.levelId == null ? "—" : levels.find((x) => x.id === item.levelId)?.name ?? `#${item.levelId}`} · {item.groupId == null ? "—" : groups.find((x) => x.id === item.groupId)?.name ?? `#${item.groupId}`}</TableCell><TableCell>{item.instructorId == null ? "—" : instructors.find((x) => x.id === item.instructorId)?.name ?? `#${item.instructorId}`}</TableCell><TableCell>{renderScheduleSummary(item)}</TableCell><TableCell><Badge variant={item.isActive ? "default" : "outline"}>{item.isActive ? "Active" : "Inactive"}</Badge></TableCell><TableCell className="text-right">
          {!item.isLegacy && can("ballet.classes", "edit") && <Button variant="ghost" size="icon" onClick={() => openEdit(item)}><Edit className="h-4 w-4" /></Button>}
          {!item.isLegacy && can("ballet.classes", "delete") && <Button variant="ghost" size="icon" title={item.isActive ? "Deactivate" : "Activate"} onClick={() => updateMutation.mutate({ id: item.id, body: { isActive: !item.isActive } })}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
        </TableCell></TableRow>)}
    </TableBody></Table></div>
    {data && data.total > 0 && (
      <TablePagination page={page} totalPages={data.totalPages} total={data.total} pageSize={PAGE_SIZE} isLoading={isLoading} itemLabel="classes" onPageChange={setPage} />
    )}
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) { setEditing(null); form.reset(EMPTY_VALUES); } }}><DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{editing ? "Edit Ballet Class" : "Add Ballet Class"}</DialogTitle></DialogHeader><Form {...form}><form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <FormField control={form.control} name="title" render={({ field }) => <FormItem><FormLabel>Class title</FormLabel><FormControl><Input data-testid="input-ballet-class-title" {...field} /></FormControl><FormMessage /></FormItem>} />
      <FormField control={form.control} name="levelId" render={({ field }) => <FormItem><FormLabel>Level</FormLabel><Select value={field.value ? String(field.value) : ""} onValueChange={(value) => setLevel(value, field.onChange)}><FormControl><SelectTrigger data-testid="select-ballet-class-level"><SelectValue placeholder="Select active level" /></SelectTrigger></FormControl><SelectContent>{selectableLevels.map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>} />
      <FormField control={form.control} name="groupId" render={({ field }) => <FormItem><FormLabel>Group</FormLabel><Select value={field.value ? String(field.value) : ""} onValueChange={(value) => field.onChange(Number(value))} disabled={!selectedLevelId}><FormControl><SelectTrigger data-testid="select-ballet-class-group"><SelectValue placeholder={selectedLevelId ? "Select group in this level" : "Select a level first"} /></SelectTrigger></FormControl><SelectContent>{selectableGroups.map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>} />
      <FormField control={form.control} name="instructorId" render={({ field }) => <FormItem><FormLabel>Instructor</FormLabel><Select value={field.value ? String(field.value) : ""} onValueChange={(value) => field.onChange(Number(value))}><FormControl><SelectTrigger data-testid="select-ballet-class-instructor"><SelectValue placeholder="Select active instructor" /></SelectTrigger></FormControl><SelectContent>{selectableInstructors.map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>} />
      <FormField control={form.control} name="classImageUrl" render={({ field }) => <FormItem><FormLabel>Image URL (optional)</FormLabel><FormControl><Input {...field} value={field.value ?? ""} /></FormControl><FormMessage /></FormItem>} /><FormField control={form.control} name="classVideoUrl" render={({ field }) => <FormItem><FormLabel>Video URL (optional)</FormLabel><FormControl><Input {...field} value={field.value ?? ""} /></FormControl><FormMessage /></FormItem>} />
      <FormField control={form.control} name="isActive" render={({ field }) => <FormItem className="flex items-center gap-3"><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl><FormLabel className="!mt-0">Active</FormLabel></FormItem>} />
      <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" data-testid="button-submit-ballet-class" disabled={isSaving}>{isSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}{editing ? "Save Changes" : "Create Class"}</Button></DialogFooter>
    </form></Form></DialogContent></Dialog>
  </div>;
}
import "./admin2-ballet.css";
