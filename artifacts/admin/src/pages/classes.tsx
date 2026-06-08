import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useListClasses,
  useCreateClass,
  useUpdateClass,
  useDeleteClass,
  useListInstructors,
  getListClassesQueryKey,
} from "@workspace/api-client-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2, Edit } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";

const LEVELS = ["Beginner", "Intermediate", "Advanced", "All Levels"];

const formSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().nullish(),
  instructorId: z.coerce.number().int().nullish(),
  category: z.string().min(1, "Category is required"),
  level: z.string().min(1, "Level is required"),
  durationMins: z.coerce.number().int().min(1),
  capacity: z.coerce.number().int().min(1),
  isActive: z.boolean().default(true),
});

type FormValues = z.input<typeof formSchema>;
type Class = { id: number; title: string; description?: string | null; instructorId?: number | null; category: string; level: string; durationMins: number; capacity: number; isActive: boolean };

export default function Classes() {
  const { data: classes, isLoading } = useListClasses();
  const { data: instructors } = useListInstructors();
  const createClass = useCreateClass();
  const updateClass = useUpdateClass();
  const deleteClass = useDeleteClass();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Class | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { title: "", category: "", level: "All Levels", durationMins: 60, capacity: 20, isActive: true },
  });

  const openCreate = () => {
    setEditing(null);
    form.reset({ title: "", description: "", category: "", level: "All Levels", durationMins: 60, capacity: 20, isActive: true });
    setOpen(true);
  };

  const openEdit = (cls: Class) => {
    setEditing(cls);
    form.reset({ title: cls.title, description: cls.description ?? "", instructorId: cls.instructorId ?? undefined, category: cls.category, level: cls.level, durationMins: cls.durationMins, capacity: cls.capacity, isActive: cls.isActive });
    setOpen(true);
  };

  const onSubmit = (values: FormValues) => {
    const parsed = formSchema.parse(values);
    const invalidate = () => { queryClient.invalidateQueries({ queryKey: getListClassesQueryKey() }); setOpen(false); };
    if (editing) {
      updateClass.mutate({ id: editing.id, data: parsed }, { onSuccess: invalidate });
    } else {
      createClass.mutate({ data: parsed }, { onSuccess: invalidate });
    }
  };

  const handleDelete = (id: number) => {
    if (confirm("Delete this class?")) {
      deleteClass.mutate({ id }, { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListClassesQueryKey() }) });
    }
  };

  const getInstructorName = (id?: number | null) => instructors?.find((i) => i.id === id)?.name ?? "—";

  return (
    <div className="space-y-6">
      <PageHeader title="Classes" description="Manage your class catalog" mode="studio" addLabel="Add Class" addTestId="button-add-class" onAdd={openCreate} />

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Instructor</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Level</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Capacity</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8">Loading...</TableCell></TableRow>
            ) : classes?.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No classes yet.</TableCell></TableRow>
            ) : (
              classes?.map((cls) => (
                <TableRow key={cls.id} data-testid={`row-class-${cls.id}`}>
                  <TableCell className="font-medium">{cls.title}</TableCell>
                  <TableCell>{getInstructorName(cls.instructorId)}</TableCell>
                  <TableCell>{cls.category}</TableCell>
                  <TableCell>{cls.level}</TableCell>
                  <TableCell>{cls.durationMins} min</TableCell>
                  <TableCell>{cls.capacity}</TableCell>
                  <TableCell>
                    <Badge variant={cls.isActive ? "default" : "outline"}>{cls.isActive ? "Active" : "Inactive"}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" data-testid={`button-edit-class-${cls.id}`} onClick={() => openEdit(cls)}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" data-testid={`button-delete-class-${cls.id}`} onClick={() => handleDelete(cls.id)}>
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
            <DialogTitle>{editing ? "Edit Class" : "Add Class"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="title" render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl><Input data-testid="input-class-title" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="category" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <FormControl><Input data-testid="input-class-category" placeholder="Contemporary" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="level" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Level</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger data-testid="select-class-level"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {LEVELS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="instructorId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Instructor</FormLabel>
                  <Select onValueChange={(v) => field.onChange(v === "none" ? null : Number(v))} value={field.value ? String(field.value) : "none"}>
                    <FormControl><SelectTrigger data-testid="select-class-instructor"><SelectValue placeholder="Select instructor" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="none">No instructor</SelectItem>
                      {instructors?.map((i) => <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="durationMins" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Duration (min)</FormLabel>
                    <FormControl><Input type="number" data-testid="input-class-duration" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="capacity" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Capacity</FormLabel>
                    <FormControl><Input type="number" data-testid="input-class-capacity" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl><Textarea data-testid="input-class-description" {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="isActive" render={({ field }) => (
                <FormItem className="flex items-center gap-3">
                  <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  <FormLabel className="!mt-0">Active</FormLabel>
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" data-testid="button-submit-class" disabled={createClass.isPending || updateClass.isPending}>
                  {editing ? "Save Changes" : "Create Class"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
