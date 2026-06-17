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
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Trash2, Edit } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { useAdminAuth } from "@/contexts/AdminAuthContext";

// ─── Dance types — loaded from Settings, replaces hardcoded CATEGORIES ────────

const API = import.meta.env.VITE_API_URL ?? "";
const API_KEY = (import.meta.env.VITE_API_KEY as string | undefined) ?? "";

function makeAdminHeaders(token: string | null): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(API_KEY ? { "x-api-key": API_KEY } : {}),
    ...(token ? { "x-admin-token": token } : {}),
  };
}

interface DanceTypeItem {
  id: number;
  name: string;
  slug: string;
  isActive: boolean;
  sortOrder: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LEVELS = ["Beginner", "Intermediate", "Advanced", "All Levels"];
const AGE_GROUPS = ["Kids", "Teens", "Adults"] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Normalize a category string for fuzzy matching — mirrors the mobile apiAdapters logic. */
function normalizeCat(s: string): string {
  return s.trim().toLowerCase().replace(/[\s\-_]+/g, "");
}

// ─── Form schema ──────────────────────────────────────────────────────────────

const formSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().nullish(),
  instructorId: z.coerce.number().int().nullish(),
  category: z.string().min(1, "Category is required"),
  level: z.string().min(1, "Level is required"),
  ageGroup: z.string().min(1, "Age Group is required"),
  durationMins: z.coerce.number().int().min(1),
  capacity: z.coerce.number().int().min(1),
  isActive: z.boolean().default(true),
});

type FormValues = z.input<typeof formSchema>;
type Class = {
  id: number;
  title: string;
  description?: string | null;
  instructorId?: number | null;
  category: string;
  level: string;
  ageGroup: string;
  durationMins: number;
  capacity: number;
  isActive: boolean;
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Classes() {
  const { token } = useAdminAuth();
  const { data: classes, isLoading } = useListClasses();
  const { data: instructors } = useListInstructors();
  const createClass = useCreateClass();
  const updateClass = useUpdateClass();
  const deleteClass = useDeleteClass();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Class | null>(null);

  // ── Dynamic dance types from Settings → Dance Types ───────────────────────
  const { data: danceTypes } = useQuery<DanceTypeItem[]>({
    queryKey: ["admin-dance-types"],
    queryFn: () =>
      fetch(`${API}/api/admin/settings/dance-types`, {
        headers: makeAdminHeaders(token),
      }).then((r) => r.json() as Promise<DanceTypeItem[]>),
  });

  /** Active dance types sorted for the dropdown */
  const activeCategories = (danceTypes ?? [])
    .filter((dt) => dt.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((dt) => dt.name);

  /**
   * Map a potentially dirty DB value (e.g. "Hiphop", "hip-hop") to the nearest
   * known category name. Falls back to the raw value so no data is lost.
   */
  function canonicalizeCategory(raw: string): string {
    const needle = normalizeCat(raw);
    return activeCategories.find((c) => normalizeCat(c) === needle) ?? raw;
  }

  // ── Form ──────────────────────────────────────────────────────────────────
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "", category: "", level: "All Levels", ageGroup: "Adults",
      durationMins: 60, capacity: 20, isActive: true,
    },
  });

  const openCreate = () => {
    setEditing(null);
    form.reset({
      title: "", description: "", category: "", level: "All Levels",
      ageGroup: "Adults", durationMins: 60, capacity: 20, isActive: true,
    });
    setOpen(true);
  };

  const openEdit = (cls: Class) => {
    setEditing(cls);
    form.reset({
      title: cls.title,
      description: cls.description ?? "",
      instructorId: cls.instructorId ?? undefined,
      category: canonicalizeCategory(cls.category),
      level: cls.level,
      ageGroup: cls.ageGroup || "Adults",
      durationMins: cls.durationMins,
      capacity: cls.capacity,
      isActive: cls.isActive,
    });
    setOpen(true);
  };

  const onSubmit = (values: FormValues) => {
    const parsed = formSchema.parse(values);
    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: getListClassesQueryKey() });
      setOpen(false);
    };
    if (editing) {
      updateClass.mutate({ id: editing.id, data: parsed }, { onSuccess: invalidate });
    } else {
      createClass.mutate({ data: parsed }, { onSuccess: invalidate });
    }
  };

  const handleDelete = (id: number) => {
    if (confirm("Delete this class?")) {
      deleteClass.mutate({ id }, {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getListClassesQueryKey() }),
      });
    }
  };

  const getInstructorName = (id?: number | null) =>
    instructors?.find((i) => i.id === id)?.name ?? "—";

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <PageHeader
        title="Classes"
        description="Manage your class catalog"
        mode="studio"
        addLabel="Add Class"
        addTestId="button-add-class"
        onAdd={openCreate}
      />

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Instructor</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Level</TableHead>
              <TableHead>Age Group</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Capacity</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8">Loading...</TableCell>
              </TableRow>
            ) : classes?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  No classes yet.
                </TableCell>
              </TableRow>
            ) : (
              classes?.map((cls) => (
                <TableRow key={cls.id} data-testid={`row-class-${cls.id}`}>
                  <TableCell className="font-medium">{cls.title}</TableCell>
                  <TableCell>{getInstructorName(cls.instructorId)}</TableCell>
                  <TableCell>{cls.category}</TableCell>
                  <TableCell>{cls.level}</TableCell>
                  <TableCell>{cls.ageGroup || "Adults"}</TableCell>
                  <TableCell>{cls.durationMins} min</TableCell>
                  <TableCell>{cls.capacity}</TableCell>
                  <TableCell>
                    <Badge variant={cls.isActive ? "default" : "outline"}>
                      {cls.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      data-testid={`button-edit-class-${cls.id}`}
                      onClick={() => openEdit(cls)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      data-testid={`button-delete-class-${cls.id}`}
                      onClick={() => handleDelete(cls.id)}
                    >
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
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Title</FormLabel>
                    <FormControl>
                      <Input data-testid="input-class-title" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Category</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-class-category">
                            <SelectValue placeholder={
                              activeCategories.length === 0
                                ? "No dance types configured"
                                : "Select category"
                            } />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {activeCategories.length === 0 ? (
                            <div className="px-3 py-2 text-sm text-muted-foreground">
                              No dance types configured.{" "}
                              <a href="/settings" className="underline">Go to Settings</a> to add some.
                            </div>
                          ) : (
                            activeCategories.map((c) => (
                              <SelectItem key={c} value={c}>{c}</SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="level"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Level</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-class-level">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {LEVELS.map((l) => (
                            <SelectItem key={l} value={l}>{l}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="ageGroup"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Age Group</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-class-age-group">
                          <SelectValue placeholder="Select age group" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {AGE_GROUPS.map((g) => (
                          <SelectItem key={g} value={g}>{g}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="instructorId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Instructor</FormLabel>
                    <Select
                      onValueChange={(v) => field.onChange(v === "none" ? null : Number(v))}
                      value={field.value ? String(field.value) : "none"}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-class-instructor">
                          <SelectValue placeholder="Select instructor" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">No instructor</SelectItem>
                        {instructors?.map((i) => (
                          <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="durationMins"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Duration (min)</FormLabel>
                      <FormControl>
                        <Input type="number" data-testid="input-class-duration" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="capacity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Capacity</FormLabel>
                      <FormControl>
                        <Input type="number" data-testid="input-class-capacity" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        data-testid="input-class-description"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="isActive"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-3">
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                    <FormLabel className="!mt-0">Active</FormLabel>
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  data-testid="button-submit-class"
                  disabled={createClass.isPending || updateClass.isPending}
                >
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
