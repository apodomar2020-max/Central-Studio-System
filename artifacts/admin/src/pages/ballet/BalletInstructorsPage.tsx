/**
 * Ballet → Instructors — /ballet/instructors
 *
 * Standalone instructor roster for the Ballet system (independent of the
 * generic Instructors page / `instructors` table). Field set mirrors
 * pages/instructors.tsx, adapted to hit the ballet-specific endpoint.
 *
 * Uses the raw-fetch pattern established by the other Ballet admin pages
 * (ApplicationsPage.tsx, BalletLevelsPage.tsx) rather than the generated
 * @workspace/api-client-react hooks — the Ballet backend routes were never
 * run through the codegen step.
 */

import { useEffect, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Trash2, Edit, Loader2 } from "lucide-react";

// ─── API helpers (matches ApplicationsPage.tsx / BalletLevelsPage.tsx) ───────

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

// ─── Types ────────────────────────────────────────────────────────────────────

interface BalletInstructor {
  id: number;
  name: string;
  bio?: string | null;
  photoUrl?: string | null;
  specialties: string[];
  experienceYears: number;
  rating?: number | null;
  isActive: boolean;
  teachingLevel?: string | null;
  achievements: string[];
  teachingPhilosophy?: string | null;
  professionalExperience?: string[];
}

interface BalletLevel {
  id: number;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

interface ListResponse {
  data: BalletInstructor[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface LevelsResponse {
  levels: BalletLevel[];
}

// Catalog-sized list — fetch a single generous page rather than build
// pagination UI, matching the un-paginated feel of the generic Instructors page.
const CATALOG_LIMIT = 100;

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  bio: z.string().nullish(),
  photoUrl: z.string().url("Must be a valid URL").nullish().or(z.literal("")),
  specialties: z.string().min(1, "At least one specialty required"),
  experienceYears: z.coerce.number().int().min(0),
  rating: z.coerce.number().min(0).max(5).nullish(),
  isActive: z.boolean().default(true),
  teachingLevel: z.string().nullish(),
  achievements: z.string().nullish(),
  teachingPhilosophy: z.string().max(600, "Keep it under 600 characters").nullish(),
  professionalExperience: z.string().nullish(),
});

type FormValues = z.infer<typeof formSchema>;

const EMPTY_VALUES: FormValues = {
  name: "", bio: "", photoUrl: "", specialties: "",
  experienceYears: 0, rating: undefined, isActive: true,
  teachingLevel: "", achievements: "",
  teachingPhilosophy: "", professionalExperience: "",
};

function InstructorPhoto({ url, name }: { url?: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (!url || failed) {
    return (
      <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-xs font-bold">
        {name.trim().slice(0, 2).toUpperCase() || "?"}
      </div>
    );
  }
  return (
    <img src={url} alt={name} className="w-10 h-10 rounded-full object-cover border" onError={() => setFailed(true)} />
  );
}

export default function BalletInstructorsPage() {
  const { token, can } = useAdminAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const canCreate = can("ballet.instructors", "create");
  const canEdit = can("ballet.instructors", "edit");
  const canDelete = can("ballet.instructors", "delete");

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<BalletInstructor | null>(null);
  const form = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: EMPTY_VALUES });

  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-ballet-instructors", token],
    queryFn: () => adminFetch<ListResponse>(`${API_BASE}/api/admin/ballet/instructors?limit=${CATALOG_LIMIT}`, {}, token),
    refetchOnWindowFocus: false,
  });
  const instructors = data?.data ?? [];

  const { data: levelsData, isLoading: isLevelsLoading } = useQuery({
    queryKey: ["admin-ballet-levels", token],
    queryFn: () => adminFetch<LevelsResponse>(`${API_BASE}/api/admin/ballet/levels`, {}, token),
    refetchOnWindowFocus: true,
  });
  const activeLevelNames = (levelsData?.levels ?? [])
    .filter((level) => level.isActive)
    .map((level) => level.name);
  const selectedTeachingLevel = form.watch("teachingLevel")?.trim() ?? "";
  const levelOptions = selectedTeachingLevel && !activeLevelNames.includes(selectedTeachingLevel)
    ? [...activeLevelNames, selectedTeachingLevel]
    : activeLevelNames;

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-ballet-instructors"] });

  const createMutation = useMutation({
    mutationFn: (body: object) => adminFetch(`${API_BASE}/api/admin/ballet/instructors`, { method: "POST", body: JSON.stringify(body) }, token),
    onSuccess: () => { invalidate(); toast({ title: "Instructor created" }); setOpen(false); },
    onError: (e: any) => toast({ title: "Error", description: e?.data?.error ?? "Failed to create instructor", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) => adminFetch(`${API_BASE}/api/admin/ballet/instructors/${id}`, { method: "PATCH", body: JSON.stringify(body) }, token),
    onSuccess: () => { invalidate(); toast({ title: "Instructor updated" }); setOpen(false); },
    onError: (e: any) => toast({ title: "Error", description: e?.data?.error ?? "Failed to update instructor", variant: "destructive" }),
  });

  const openCreate = () => {
    setEditing(null);
    form.reset(EMPTY_VALUES);
    setOpen(true);
  };

  const openEdit = (instructor: BalletInstructor) => {
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
      achievements: instructor.achievements?.join(", ") ?? "",
      teachingPhilosophy: instructor.teachingPhilosophy ?? "",
      professionalExperience: instructor.professionalExperience?.join("\n") ?? "",
    });
    setOpen(true);
  };

  const nullIfEmpty = (v?: string | null) => (v?.trim() ? v.trim() : null);

  const onSubmit = (values: FormValues) => {
    const body = {
      ...values,
      specialties: values.specialties.split(",").map((s) => s.trim()).filter(Boolean),
      achievements: values.achievements?.split(",").map((s) => s.trim()).filter(Boolean) ?? [],
      professionalExperience: values.professionalExperience?.split("\n").map((s) => s.trim()).filter(Boolean) ?? [],
      teachingPhilosophy: nullIfEmpty(values.teachingPhilosophy),
      photoUrl: nullIfEmpty(values.photoUrl),
      teachingLevel: nullIfEmpty(values.teachingLevel),
    };
    if (editing) {
      updateMutation.mutate({ id: editing.id, body });
    } else {
      createMutation.mutate(body);
    }
  };

  const photoValue = form.watch("photoUrl");
  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="admin2-ballet-page admin2-ballet-registry space-y-6">
      <PageHeader title="Ballet Instructors" description="Teaching staff for the Ballet program" mode="stage" addLabel="Add Instructor" addTestId="button-add-ballet-instructor" onAdd={canCreate ? openCreate : undefined} />

      <div className="border rounded-md">
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
              <TableRow><TableCell colSpan={7} className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></TableCell></TableRow>
            ) : isError ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-destructive">Ballet instructors could not be loaded.</TableCell></TableRow>
            ) : instructors.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No ballet instructors yet. Add one to get started.</TableCell></TableRow>
            ) : (
              instructors.map((instructor) => (
                <TableRow key={instructor.id} data-testid={`row-ballet-instructor-${instructor.id}`}>
                  <TableCell><InstructorPhoto url={instructor.photoUrl} name={instructor.name} /></TableCell>
                  <TableCell className="font-medium">{instructor.name}</TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {instructor.specialties?.map((s) => <Badge variant="secondary" key={s}>{s}</Badge>)}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{instructor.teachingLevel ?? "—"}</TableCell>
                  <TableCell>{instructor.experienceYears} yrs</TableCell>
                  <TableCell>
                    <Badge variant={instructor.isActive ? "default" : "outline"}>{instructor.isActive ? "Active" : "Inactive"}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {canEdit && (
                      <Button variant="ghost" size="icon" data-testid={`button-edit-ballet-instructor-${instructor.id}`} onClick={() => openEdit(instructor)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        variant="ghost" size="icon"
                        data-testid={`button-deactivate-ballet-instructor-${instructor.id}`}
                        title={instructor.isActive ? "Deactivate" : "Activate"}
                        onClick={() => updateMutation.mutate({ id: instructor.id, body: { isActive: !instructor.isActive } })}
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
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Ballet Instructor" : "Add Ballet Instructor"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name *</FormLabel>
                    <FormControl><Input data-testid="input-ballet-instructor-name" {...field} /></FormControl>
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
                        disabled={isLevelsLoading}
                      >
                        <option value="">All Levels</option>
                        {isLevelsLoading && <option value="" disabled>Loading levels...</option>}
                        {!isLevelsLoading && activeLevelNames.length === 0 && <option value="" disabled>No active levels</option>}
                        {levelOptions.map((levelName) => (
                          <option key={levelName} value={levelName}>
                            {activeLevelNames.includes(levelName) ? levelName : `${levelName} (inactive)`}
                          </option>
                        ))}
                      </select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <FormField control={form.control} name="specialties" render={({ field }) => (
                <FormItem>
                  <FormLabel>Specialties (comma-separated)</FormLabel>
                  <FormControl><Input data-testid="input-ballet-instructor-specialties" placeholder="Classical, Pointe, Contemporary" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="experienceYears" render={({ field }) => (
                <FormItem>
                  <FormLabel>Years of Experience</FormLabel>
                  <FormControl><Input type="number" data-testid="input-ballet-instructor-experience" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="bio" render={({ field }) => (
                <FormItem>
                  <FormLabel>Bio</FormLabel>
                  <FormControl><Textarea rows={3} data-testid="input-ballet-instructor-bio" {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="achievements" render={({ field }) => (
                <FormItem>
                  <FormLabel>Achievements (comma-separated)</FormLabel>
                  <FormControl><Input placeholder="National Champion 2022, RAD Certified" {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="teachingPhilosophy" render={({ field }) => (
                <FormItem>
                  <FormLabel>Teaching Philosophy</FormLabel>
                  <FormControl><Textarea rows={3} maxLength={600} placeholder="A short statement about how this instructor teaches." {...field} value={field.value ?? ""} /></FormControl>
                  <div className="text-xs text-muted-foreground text-right">{(field.value ?? "").length}/600</div>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="professionalExperience" render={({ field }) => (
                <FormItem>
                  <FormLabel>Professional Experience (one per line)</FormLabel>
                  <FormControl><Textarea rows={4} placeholder={"Senior Ballet Instructor · Central Studio · 2019–Present"} {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="photoUrl" render={({ field }) => (
                <FormItem>
                  <FormLabel>Photo URL</FormLabel>
                  <FormControl><Input placeholder="https://example.com/photo.jpg" {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                  {photoValue && (
                    <div className="mt-2"><InstructorPhoto url={photoValue} name="Preview" /></div>
                  )}
                </FormItem>
              )} />

              <FormField control={form.control} name="isActive" render={({ field }) => (
                <FormItem className="flex items-center gap-3">
                  <FormControl><Switch data-testid="switch-ballet-instructor-active" checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  <FormLabel className="!mt-0">Active</FormLabel>
                </FormItem>
              )} />

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" data-testid="button-submit-ballet-instructor" disabled={isSaving}>
                  {isSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
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
import "./admin2-ballet.css";
