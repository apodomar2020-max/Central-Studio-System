import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useListInstructors,
  useCreateInstructor,
  useUpdateInstructor,
  useDeleteInstructor,
  getListInstructorsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
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
import { Trash2, Edit } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/page-header";

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
};

export default function Instructors() {
  const { data: instructors, isLoading } = useListInstructors();
  const createInstructor = useCreateInstructor();
  const updateInstructor = useUpdateInstructor();
  const deleteInstructor = useDeleteInstructor();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Instructor | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "", bio: "", photoUrl: "", specialties: "",
      experienceYears: 0, rating: undefined, isActive: true,
      teachingLevel: "", instagramUrl: "", tiktokUrl: "", youtubeUrl: "", achievements: "",
    },
  });

  const openCreate = () => {
    setEditing(null);
    form.reset({
      name: "", bio: "", photoUrl: "", specialties: "",
      experienceYears: 0, rating: undefined, isActive: true,
      teachingLevel: "", instagramUrl: "", tiktokUrl: "", youtubeUrl: "", achievements: "",
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
    });
    setOpen(true);
  };

  const nullIfEmpty = (v?: string | null) => (v?.trim() ? v.trim() : null);

  const onSubmit = (values: FormValues) => {
    const specialtiesArray = values.specialties.split(",").map((s) => s.trim()).filter(Boolean);
    const achievementsArray = values.achievements?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
    const data = {
      ...values,
      specialties: specialtiesArray,
      achievements: achievementsArray,
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

  const handleDelete = (id: number) => {
    if (confirm("Delete this instructor?")) {
      deleteInstructor.mutate({ id }, {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getListInstructorsQueryKey() }),
      });
    }
  };

  const photoValue = form.watch("photoUrl");

  return (
    <div className="space-y-6">
      <PageHeader title="Instructors" description="Manage your teaching staff" mode="studio" addLabel="Add Instructor" addTestId="button-add-instructor" onAdd={openCreate} />

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
              <TableRow><TableCell colSpan={7} className="text-center py-8">Loading...</TableCell></TableRow>
            ) : instructors?.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No instructors yet. Add one to get started.</TableCell></TableRow>
            ) : (
              instructors?.map((instructor) => (
                <TableRow key={instructor.id} data-testid={`row-instructor-${instructor.id}`}>
                  <TableCell>
                    {instructor.photoUrl ? (
                      <img src={instructor.photoUrl} alt={instructor.name} className="w-10 h-10 rounded-full object-cover" />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-xs font-bold">
                        {instructor.name.slice(0, 2).toUpperCase()}
                      </div>
                    )}
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
                    <Button variant="ghost" size="icon" data-testid={`button-edit-instructor-${instructor.id}`} onClick={() => openEdit(instructor as Instructor)}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" data-testid={`button-delete-instructor-${instructor.id}`} onClick={() => handleDelete(instructor.id)}>
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
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Instructor" : "Add Instructor"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">

              {/* Basic Info */}
              <div className="grid grid-cols-2 gap-4">
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

              {/* Photo */}
              <FormField control={form.control} name="photoUrl" render={({ field }) => (
                <FormItem>
                  <FormLabel>Photo URL</FormLabel>
                  <FormControl><Input placeholder="https://example.com/photo.jpg" {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                  {photoValue && (
                    <img src={photoValue} alt="Preview" className="mt-2 w-16 h-16 rounded-full object-cover border" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  )}
                </FormItem>
              )} />

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
