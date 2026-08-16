import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useListInstructors,
  useCreateInstructor,
  useUpdateInstructor,
  useDeleteInstructor,
  getListInstructorsQueryKey,
  extractGoogleDriveFileId,
  normalizeMediaUrl,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2, Edit, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useAdminConfirm } from "@/components/admin/admin-confirm";
import { TableToolbar } from "@/components/admin/table-toolbar";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import "./admin2-studio.css";

type StatusFilter = "all" | "active" | "inactive";
type SortOption = "default" | "name" | "experience-desc" | "experience-asc";

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  bio: z.string().nullish(),
  photoUrl: z.string().url("Must be a valid URL").nullish().or(z.literal("")),
  specialties: z.string().min(1, "At least one specialty required"),
  experienceYears: z.coerce.number().int().min(0),
  rating: z.coerce.number().min(0).max(5).nullish(),
  isActive: z.boolean().default(true),
  teachingLevel: z.string().nullish(),
  instagramUrl: z.string().url("Must be a valid URL").nullish().or(z.literal("")),
  tiktokUrl: z.string().url("Must be a valid URL").nullish().or(z.literal("")),
  youtubeUrl: z.string().url("Must be a valid URL").nullish().or(z.literal("")),
  achievements: z.string().nullish(),
  teachingPhilosophy: z.string().max(600, "Keep it under 600 characters").nullish(),
  // One professional-experience entry per line.
  professionalExperience: z.string().nullish(),
});

type FormValues = z.infer<typeof formSchema>;

type Instructor = {
  id: number;
  name: string;
  bio?: string | null;
  photoUrl?: string | null;
  specialties: string[];
  experienceYears: number;
  rating?: number | null;
  isActive: boolean;
  instagramUrl?: string | null;
  tiktokUrl?: string | null;
  youtubeUrl?: string | null;
  teachingLevel?: string | null;
  achievements: string[];
  teachingPhilosophy?: string | null;
  professionalExperience?: string[];
};

function getInstructorPhotoPreviewUrl(url?: string | null): string | undefined {
  const driveId = extractGoogleDriveFileId(url);
  if (driveId) {
    return `https://drive.google.com/thumbnail?id=${encodeURIComponent(driveId)}&sz=w256`;
  }
  return normalizeMediaUrl(url, "image");
}

function InstructorPhoto({ url, name, preview = false }: { url?: string | null; name: string; preview?: boolean }) {
  const [failed, setFailed] = useState(false);
  const normalizedUrl = getInstructorPhotoPreviewUrl(url);

  useEffect(() => setFailed(false), [normalizedUrl]);

  const sizeClass = preview ? "w-16 h-16" : "w-10 h-10";
  if (!normalizedUrl || failed) {
    return (
      <div className={`${sizeClass} rounded-full bg-muted flex items-center justify-center text-xs font-bold`}>
        {name.trim().slice(0, 2).toUpperCase() || "?"}
      </div>
    );
  }
  return (
    <img
      src={normalizedUrl}
      alt={name}
      className={`${sizeClass} rounded-full object-cover border`}
      onError={() => setFailed(true)}
    />
  );
}

export default function Instructors() {
  const confirmAction = useAdminConfirm();
  const { can } = useAdminAuth();
  const canCreate = can("instructors", "create");
  const canEdit = can("instructors", "edit");
  const canDelete = can("instructors", "delete");
  const canMediaManage = can("instructors", "mediaManage");
  const { data: instructors, isLoading } = useListInstructors();
  const createInstructor = useCreateInstructor();
  const updateInstructor = useUpdateInstructor();
  const deleteInstructor = useDeleteInstructor();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Instructor | null>(null);

  // Data Tables Enhancement — client-side search/filter/sort over the
  // complete array useListInstructors() already fetches. No API change;
  // never mutates the query-cache array (sort operates on a copy).
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim().toLowerCase(), 200);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [specialtyFilter, setSpecialtyFilter] = useState<string>("all");
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [sort, setSort] = useState<SortOption>("default");

  const specialtyOptions = useMemo(() => {
    const set = new Set<string>();
    for (const instructor of instructors ?? []) for (const s of instructor.specialties) if (s.trim()) set.add(s.trim());
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [instructors]);
  const levelOptions = useMemo(() => {
    const set = new Set<string>();
    for (const instructor of instructors ?? []) if (instructor.teachingLevel?.trim()) set.add(instructor.teachingLevel.trim());
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [instructors]);

  const activeFilterCount = [statusFilter !== "all", specialtyFilter !== "all", levelFilter !== "all"].filter(Boolean).length;
  const hasActiveControls = activeFilterCount > 0 || sort !== "default" || search.length > 0;
  const clearControls = () => { setSearch(""); setStatusFilter("all"); setSpecialtyFilter("all"); setLevelFilter("all"); setSort("default"); };

  const filteredInstructors = useMemo(() => {
    let list = instructors ?? [];
    if (debouncedSearch) {
      list = list.filter((i) =>
        i.name.toLowerCase().includes(debouncedSearch)
        || i.specialties.some((s) => s.toLowerCase().includes(debouncedSearch))
        || (i.bio ?? "").toLowerCase().includes(debouncedSearch));
    }
    if (statusFilter !== "all") list = list.filter((i) => (statusFilter === "active" ? i.isActive : !i.isActive));
    if (specialtyFilter !== "all") list = list.filter((i) => i.specialties.includes(specialtyFilter));
    if (levelFilter !== "all") list = list.filter((i) => i.teachingLevel === levelFilter);
    if (sort !== "default") {
      list = [...list].sort((a, b) => {
        switch (sort) {
          case "name": return a.name.localeCompare(b.name);
          case "experience-desc": return b.experienceYears - a.experienceYears;
          case "experience-asc": return a.experienceYears - b.experienceYears;
          default: return 0;
        }
      });
    }
    return list;
  }, [instructors, debouncedSearch, statusFilter, specialtyFilter, levelFilter, sort]);

  const sortLabels: Record<SortOption, string> = {
    default: "Default", name: "Name", "experience-desc": "Experience ↓", "experience-asc": "Experience ↑",
  };

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "", bio: "", photoUrl: "", specialties: "",
      experienceYears: 0, rating: undefined, isActive: true,
      teachingLevel: "", instagramUrl: "", tiktokUrl: "", youtubeUrl: "", achievements: "",
      teachingPhilosophy: "", professionalExperience: "",
    },
  });

  const openCreate = () => {
    setEditing(null);
    form.reset({
      name: "", bio: "", photoUrl: "", specialties: "",
      experienceYears: 0, rating: undefined, isActive: true,
      teachingLevel: "", instagramUrl: "", tiktokUrl: "", youtubeUrl: "", achievements: "",
      teachingPhilosophy: "", professionalExperience: "",
    });
    setOpen(true);
  };

  const openEdit = (instructor: Instructor) => {
    setEditing(instructor);
    form.reset({
      name: instructor.name,
      bio: instructor.bio ?? "",
      photoUrl: instructor.photoUrl ?? "",
      specialties: instructor.specialties.join(", "),
      experienceYears: instructor.experienceYears,
      rating: instructor.rating ?? undefined,
      isActive: instructor.isActive,
      teachingLevel: instructor.teachingLevel ?? "",
      instagramUrl: instructor.instagramUrl ?? "",
      tiktokUrl: instructor.tiktokUrl ?? "",
      youtubeUrl: instructor.youtubeUrl ?? "",
      achievements: instructor.achievements?.join(", ") ?? "",
      teachingPhilosophy: instructor.teachingPhilosophy ?? "",
      professionalExperience: instructor.professionalExperience?.join("\n") ?? "",
    });
    setOpen(true);
  };

  const nullIfEmpty = (v?: string | null) => (v?.trim() ? v.trim() : null);

  const onSubmit = (values: FormValues) => {
    const specialtiesArray = values.specialties.split(",").map((s) => s.trim()).filter(Boolean);
    const achievementsArray = values.achievements?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
    // Professional experience: one entry per line.
    const experienceArray = values.professionalExperience?.split("\n").map((s) => s.trim()).filter(Boolean) ?? [];
    const data = {
      ...values,
      specialties: specialtiesArray,
      achievements: achievementsArray,
      professionalExperience: experienceArray,
      teachingPhilosophy: nullIfEmpty(values.teachingPhilosophy as string | null | undefined),
      photoUrl: nullIfEmpty(values.photoUrl as string | null | undefined),
      teachingLevel: nullIfEmpty(values.teachingLevel as string | null | undefined),
      instagramUrl: nullIfEmpty(values.instagramUrl as string | null | undefined),
      tiktokUrl: nullIfEmpty(values.tiktokUrl as string | null | undefined),
      youtubeUrl: nullIfEmpty(values.youtubeUrl as string | null | undefined),
    };
    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: getListInstructorsQueryKey() });
      setOpen(false);
    };
    if (editing) {
      updateInstructor.mutate({ id: editing.id, data }, { onSuccess: invalidate });
    } else {
      createInstructor.mutate({ data }, { onSuccess: invalidate });
    }
  };

  const handleDelete = async (id: number) => {
    if (await confirmAction({ title: "Delete instructor?", description: "This instructor will be removed. This action cannot be undone.", confirmLabel: "Delete instructor" })) {
      deleteInstructor.mutate({ id }, {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getListInstructorsQueryKey() }),
      });
    }
  };

  const photoValue = form.watch("photoUrl");

  return (
    <div className="admin2-studio-page admin2-studio-instructors">
      <TableToolbar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search instructors by name, specialty, or bio"
        searchTestId="input-instructor-search"
        activeFilterCount={activeFilterCount}
        onClear={hasActiveControls ? clearControls : undefined}
        activeSortLabel={sort !== "default" ? sortLabels[sort] : undefined}
        filtersContent={
          <>
            <div className="admin2-table-toolbar-panel-group">
              <span>Status</span>
              <div className="admin2-filter-pills">
                {(["all", "active", "inactive"] as const).map((value) => (
                  <Button key={value} type="button" variant="outline" size="compact" aria-pressed={statusFilter === value} className={statusFilter === value ? "is-selected" : undefined} onClick={() => setStatusFilter(value)}>
                    {value === "all" ? "All" : value === "active" ? "Active" : "Inactive"}
                  </Button>
                ))}
              </div>
            </div>
            {specialtyOptions.length > 0 && (
              <div className="admin2-table-toolbar-panel-group">
                <span>Specialty</span>
                <div className="admin2-filter-pills">
                  <Button type="button" variant="outline" size="compact" aria-pressed={specialtyFilter === "all"} className={specialtyFilter === "all" ? "is-selected" : undefined} onClick={() => setSpecialtyFilter("all")}>All</Button>
                  {specialtyOptions.map((s) => (
                    <Button key={s} type="button" variant="outline" size="compact" aria-pressed={specialtyFilter === s} className={specialtyFilter === s ? "is-selected" : undefined} onClick={() => setSpecialtyFilter(s)}>
                      {s}
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {levelOptions.length > 0 && (
              <div className="admin2-table-toolbar-panel-group">
                <span>Level</span>
                <div className="admin2-filter-pills">
                  <Button type="button" variant="outline" size="compact" aria-pressed={levelFilter === "all"} className={levelFilter === "all" ? "is-selected" : undefined} onClick={() => setLevelFilter("all")}>All</Button>
                  {levelOptions.map((l) => (
                    <Button key={l} type="button" variant="outline" size="compact" aria-pressed={levelFilter === l} className={levelFilter === l ? "is-selected" : undefined} onClick={() => setLevelFilter(l)}>
                      {l}
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
              {(Object.keys(sortLabels) as SortOption[]).map((value) => (
                <Button key={value} type="button" variant="outline" size="compact" aria-pressed={sort === value} className={sort === value ? "is-selected" : undefined} onClick={() => setSort(value)}>
                  {sortLabels[value]}
                </Button>
              ))}
            </div>
          </div>
        }
      >
        {canCreate && (
          <div className="admin2-table-toolbar-add">
            <Button data-testid="button-add-instructor" onClick={openCreate} className="gap-2 shrink-0">
              <Plus className="h-4 w-4" />
              Add Instructor
            </Button>
          </div>
        )}
      </TableToolbar>

      <div className="admin2-studio-registry">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Photo</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Specialties</TableHead>
              <TableHead>Level</TableHead>
              <TableHead>Experience</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8">Loading...</TableCell></TableRow>
            ) : instructors?.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No instructors yet. Add one to get started.</TableCell></TableRow>
            ) : filteredInstructors.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No instructors match your search or filters.</TableCell></TableRow>
            ) : (
              filteredInstructors.map((instructor) => (
                <TableRow key={instructor.id} data-testid={`row-instructor-${instructor.id}`}>
                  <TableCell>
                    <InstructorPhoto url={instructor.photoUrl} name={instructor.name} />
                  </TableCell>
                  <TableCell className="font-medium">{instructor.name}</TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {instructor.specialties?.map((s) => <Badge variant="secondary" key={s}>{s}</Badge>)}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{(instructor as Instructor).teachingLevel ?? "—"}</TableCell>
                  <TableCell>{instructor.experienceYears} yrs</TableCell>
                  <TableCell>
                    <Badge variant={instructor.isActive ? "default" : "outline"}>
                      {instructor.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {canEdit && (
                    <Button variant="ghost" size="icon" aria-label={`Edit ${instructor.name}`} title="Edit instructor" data-testid={`button-edit-instructor-${instructor.id}`} onClick={() => openEdit(instructor as Instructor)}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    )}
                    {canDelete && (
                    <Button variant="ghost" size="icon" aria-label={`Delete ${instructor.name}`} title="Delete instructor" data-testid={`button-delete-instructor-${instructor.id}`} onClick={() => handleDelete(instructor.id)}>
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
        <DialogContent className="admin2-studio-dialog max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Instructor" : "Add Instructor"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">

              {/* Basic Info */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name *</FormLabel>
                    <FormControl><Input data-testid="input-instructor-name" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="teachingLevel" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Teaching Level</FormLabel>
                    <FormControl>
                      <select
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                        {...field}
                        value={field.value ?? ""}
                      >
                        <option value="">All Levels</option>
                        <option value="Beginner">Beginner</option>
                        <option value="Intermediate">Intermediate</option>
                        <option value="Advanced">Advanced</option>
                        <option value="All Levels">All Levels</option>
                      </select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <FormField control={form.control} name="specialties" render={({ field }) => (
                <FormItem>
                  <FormLabel>Specialties (comma-separated)</FormLabel>
                  <FormControl><Input data-testid="input-instructor-specialties" placeholder="Contemporary, Ballet, Hip-Hop" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="experienceYears" render={({ field }) => (
                <FormItem>
                  <FormLabel>Years of Experience</FormLabel>
                  <FormControl><Input type="number" data-testid="input-instructor-experience" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="bio" render={({ field }) => (
                <FormItem>
                  <FormLabel>Bio</FormLabel>
                  <FormControl><Textarea data-testid="input-instructor-bio" rows={3} {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="achievements" render={({ field }) => (
                <FormItem>
                  <FormLabel>Achievements (comma-separated)</FormLabel>
                  <FormControl><Input placeholder="National Champion 2022, Certified ISTD" {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="teachingPhilosophy" render={({ field }) => (
                <FormItem>
                  <FormLabel>Teaching Philosophy</FormLabel>
                  <FormControl><Textarea rows={3} maxLength={600} placeholder="A short statement about how this instructor teaches." data-testid="input-instructor-philosophy" {...field} value={field.value ?? ""} /></FormControl>
                  <div className="text-xs text-muted-foreground text-right">{(field.value ?? "").length}/600</div>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="professionalExperience" render={({ field }) => (
                <FormItem>
                  <FormLabel>Professional Experience (one per line)</FormLabel>
                  <FormControl><Textarea rows={4} placeholder={"Senior Instructor · Central Studio · 2019–Present\nGuest Instructor · Cairo Dance Academy · 2017–2019"} data-testid="input-instructor-experience" {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              {/* Photo */}
              {canMediaManage && (
                <FormField control={form.control} name="photoUrl" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Photo URL</FormLabel>
                    <FormControl><Input placeholder="https://example.com/photo.jpg" {...field} value={field.value ?? ""} /></FormControl>
                    <FormMessage />
                    {photoValue && (
                      <div className="mt-2">
                        <InstructorPhoto url={photoValue} name="Preview" preview />
                      </div>
                    )}
                  </FormItem>
                )} />
              )}

              {/* Social Media */}
              <p className="text-sm font-medium text-muted-foreground pt-1">Social Media</p>
              <div className="grid grid-cols-1 gap-3">
                <FormField control={form.control} name="instagramUrl" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Instagram URL</FormLabel>
                    <FormControl><Input placeholder="https://instagram.com/username" {...field} value={field.value ?? ""} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="tiktokUrl" render={({ field }) => (
                  <FormItem>
                    <FormLabel>TikTok URL</FormLabel>
                    <FormControl><Input placeholder="https://tiktok.com/@username" {...field} value={field.value ?? ""} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="youtubeUrl" render={({ field }) => (
                  <FormItem>
                    <FormLabel>YouTube URL</FormLabel>
                    <FormControl><Input placeholder="https://youtube.com/@username" {...field} value={field.value ?? ""} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <FormField control={form.control} name="isActive" render={({ field }) => (
                <FormItem className="flex items-center gap-3">
                  <FormControl><Switch data-testid="switch-instructor-active" checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  <FormLabel className="!mt-0">Active</FormLabel>
                </FormItem>
              )} />

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" data-testid="button-submit-instructor" disabled={createInstructor.isPending || updateInstructor.isPending}>
                  {editing ? "Save Changes" : "Create Instructor"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
