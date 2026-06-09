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
  photoUrl: z.string().nullish(),
  specialties: z.string().min(1, "At least one specialty required"),
  experienceYears: z.coerce.number().int().min(0),
  rating: z.coerce.number().min(0).max(5).nullish(),
  isActive: z.boolean().default(true),
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
    defaultValues: { name: "", bio: "", specialties: "", experienceYears: 0, rating: undefined, isActive: true },
  });

  const openCreate = () => {
    setEditing(null);
    form.reset({ name: "", bio: "", specialties: "", experienceYears: 0, rating: undefined, isActive: true });
    setOpen(true);
  };

  const openEdit = (instructor: Instructor) => {
    setEditing(instructor);
    form.reset({
      name: instructor.name,
      bio: instructor.bio ?? "",
      specialties: instructor.specialties.join(", "),
      experienceYears: instructor.experienceYears,
      rating: instructor.rating ?? undefined,
      isActive: instructor.isActive,
    });
    setOpen(true);
  };

  const onSubmit = (values: FormValues) => {
    const specialtiesArray = values.specialties.split(",").map((s) => s.trim()).filter(Boolean);
    const data = { ...values, specialties: specialtiesArray };
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

  return (
    <div className="space-y-6">
      <PageHeader title="Instructors" description="Manage your teaching staff" mode="studio" addLabel="Add Instructor" addTestId="button-add-instructor" onAdd={openCreate} />

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Specialties</TableHead>
              <TableHead>Experience</TableHead>
              <TableHead>Rating</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8">Loading...</TableCell></TableRow>
            ) : instructors?.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No instructors yet. Add one to get started.</TableCell></TableRow>
            ) : (
              instructors?.map((instructor) => (
                <TableRow key={instructor.id} data-testid={`row-instructor-${instructor.id}`}>
                  <TableCell className="font-medium">{instructor.name}</TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {instructor.specialties?.map((s) => <Badge variant="secondary" key={s}>{s}</Badge>)}
                    </div>
                  </TableCell>
                  <TableCell>{instructor.experienceYears} yrs</TableCell>
                  <TableCell>{instructor.rating ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={instructor.isActive ? "default" : "outline"}>
                      {instructor.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" data-testid={`button-edit-instructor-${instructor.id}`} onClick={() => openEdit(instructor)}>
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
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Instructor" : "Add Instructor"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl><Input data-testid="input-instructor-name" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="specialties" render={({ field }) => (
                <FormItem>
                  <FormLabel>Specialties (comma-separated)</FormLabel>
                  <FormControl><Input data-testid="input-instructor-specialties" placeholder="Contemporary, Ballet, Hip-Hop" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="experienceYears" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Years of Experience</FormLabel>
                    <FormControl><Input type="number" data-testid="input-instructor-experience" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="rating" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Rating (0–5)</FormLabel>
                    <FormControl><Input type="number" step="0.1" data-testid="input-instructor-rating" {...field} value={field.value ?? ""} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="bio" render={({ field }) => (
                <FormItem>
                  <FormLabel>Bio</FormLabel>
                  <FormControl><Textarea data-testid="input-instructor-bio" {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
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
