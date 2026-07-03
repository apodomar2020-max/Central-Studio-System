import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useListStudents,
  useCreateStudent,
  useUpdateStudent,
  getListStudentsQueryKey,
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useQueryClient } from "@tanstack/react-query";
import { Edit, BadgeCheck } from "lucide-react";
import { Link } from "wouter";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { useAdminAuth } from "@/contexts/AdminAuthContext";

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Valid email required"),
  phone: z.string().nullish(),
  notes: z.string().nullish(),
});

type FormValues = z.input<typeof formSchema>;
type Student = { id: number; name: string; email: string; phone?: string | null; notes?: string | null; avatarUrl?: string | null; totalBookings: number; joinedAt: string };
/**
 * Profile Completion Engine (Phase 4) fields — GET /students now returns
 * these (see routes/students.ts), but the generated api-client-react types
 * don't know about them since the response is no longer parsed through the
 * generated ListStudentsResponse schema. Widened locally instead of
 * regenerating/editing the generated client.
 */
type StudentRow = Student & {
  accountType?: string | null;
  authProvider?: string | null;
  howDidYouHearAboutUs?: string | null;
  childCount?: number;
  danceInterestCount?: number;
  verificationBadge?: boolean;
  profileCompletion?: {
    percent: number;
    isComplete: boolean;
    nextStep: string;
    missing: string[];
  } | null;
};
const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timeout);
  }, [value, delayMs]);

  return debounced;
}

function paginationRange(currentPage: number, totalPages: number): number[] {
  if (totalPages <= 0) return [];
  const pages = new Set<number>([1, totalPages]);
  for (let p = currentPage - 2; p <= currentPage + 2; p += 1) {
    if (p >= 1 && p <= totalPages) pages.add(p);
  }
  return Array.from(pages).sort((a, b) => a - b);
}

export default function Students() {
  const { can } = useAdminAuth();
  const canCreate = can("users", "create");
  const canEdit = can("students", "edit");
  // Student deletion removed from the admin UI (Phase 3). The backend
  // DELETE /students/:id endpoint is intentionally untouched.
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(50);
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const listParams = {
    accountType: "student" as const,
    page,
    pageSize,
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
  };
  const { data: studentsResponse, isLoading } = useListStudents(listParams);
  const students = (studentsResponse?.students ?? []) as StudentRow[];
  const total = studentsResponse?.total ?? 0;
  const currentPage = studentsResponse?.page ?? page;
  const totalPages = studentsResponse?.totalPages ?? 0;
  const responsePageSize = studentsResponse?.pageSize ?? pageSize;
  const startItem = total === 0 ? 0 : (currentPage - 1) * responsePageSize + 1;
  const endItem = total === 0 ? 0 : Math.min(currentPage * responsePageSize, total);
  const paginationPages = paginationRange(currentPage, totalPages);
  const createStudent = useCreateStudent();
  const updateStudent = useUpdateStudent();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Student | null>(null);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, pageSize]);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", email: "" },
  });

  const openCreate = () => {
    setEditing(null);
    form.reset({ name: "", email: "", phone: "", notes: "" });
    setOpen(true);
  };

  const openEdit = (s: Student) => {
    setEditing(s);
    form.reset({ name: s.name, email: s.email, phone: s.phone ?? "", notes: s.notes ?? "" });
    setOpen(true);
  };

  const onSubmit = (values: FormValues) => {
    const parsed = formSchema.parse(values);
    const invalidate = () => { queryClient.invalidateQueries({ queryKey: getListStudentsQueryKey() }); setOpen(false); };
    if (editing) {
      updateStudent.mutate({ id: editing.id, data: parsed }, { onSuccess: invalidate });
    } else {
      createStudent.mutate({ data: parsed }, { onSuccess: invalidate });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Students" description="Manage your community" mode="studio" addLabel="Add Student" addTestId="button-add-student" onAdd={canCreate ? openCreate : undefined} />

      <div className="flex flex-col gap-3 rounded-md border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search students by name, email, or phone"
          className="max-w-md"
          data-testid="input-student-search"
        />
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Rows</span>
          <Select value={String(pageSize)} onValueChange={(value) => setPageSize(Number(value) as (typeof PAGE_SIZE_OPTIONS)[number])}>
            <SelectTrigger className="w-24" data-testid="select-student-page-size">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((option) => (
                <SelectItem key={option} value={String(option)}>{option}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Total Bookings</TableHead>
              <TableHead>Profile</TableHead>
              <TableHead>Signup</TableHead>
              <TableHead>Interests</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8">Loading...</TableCell></TableRow>
            ) : students.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No students yet.</TableCell></TableRow>
            ) : (
              students.map((student) => (
                <TableRow key={student.id} data-testid={`row-student-${student.id}`}>
                  <TableCell className="font-medium">
                    <Link href={`/students/${student.id}`} className="hover:underline flex items-center gap-2">
                      <Avatar className="h-7 w-7">
                        {student.avatarUrl ? <AvatarImage src={student.avatarUrl} alt={student.name} /> : null}
                        <AvatarFallback>{student.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <span>{student.name}</span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div>{student.email}</div>
                    <div className="text-xs text-muted-foreground">{student.phone}</div>
                  </TableCell>
                  <TableCell>{student.totalBookings}</TableCell>
                  <TableCell>
                    {student.profileCompletion ? (
                      <div className="flex items-center gap-1.5">
                        <Badge variant={student.profileCompletion.isComplete ? "default" : "outline"}>
                          {student.profileCompletion.percent}%
                        </Badge>
                        {student.verificationBadge && (
                          <BadgeCheck className="h-4 w-4 text-emerald-400" aria-label="Verified" />
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="capitalize text-sm">{student.authProvider ?? "manual"}</div>
                    {student.howDidYouHearAboutUs && (
                      <div className="text-xs text-muted-foreground">{student.howDidYouHearAboutUs}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      {student.danceInterestCount != null && (
                        <Badge variant="secondary">{student.danceInterestCount} style{student.danceInterestCount === 1 ? "" : "s"}</Badge>
                      )}
                      {student.childCount != null && student.accountType === "parent" && (
                        <Badge variant="secondary">{student.childCount} child{student.childCount === 1 ? "" : "ren"}</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{new Date(student.joinedAt).toLocaleDateString()}</TableCell>
                  <TableCell className="text-right">
                    {canEdit && (
                      <Button variant="ghost" size="icon" data-testid={`button-edit-student-${student.id}`} onClick={() => openEdit(student)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-3 rounded-md border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-muted-foreground">
          Showing {startItem}–{endItem} of {total.toLocaleString()} students
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={currentPage <= 1 || isLoading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <div className="flex flex-wrap items-center gap-1">
            {paginationPages.map((p, index) => {
              const previous = paginationPages[index - 1];
              return (
                <div key={p} className="flex items-center gap-1">
                  {previous != null && p - previous > 1 && (
                    <span className="px-1 text-sm text-muted-foreground">...</span>
                  )}
                  <Button
                    type="button"
                    variant={p === currentPage ? "default" : "outline"}
                    size="sm"
                    className="h-8 min-w-8 px-2"
                    disabled={isLoading}
                    onClick={() => setPage(p)}
                  >
                    {p}
                  </Button>
                </div>
              );
            })}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={totalPages === 0 || currentPage >= totalPages || isLoading}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
          </Button>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Student" : "Add Student"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl><Input data-testid="input-student-name" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl><Input type="email" data-testid="input-student-email" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone</FormLabel>
                  <FormControl><Input data-testid="input-student-phone" {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl><Textarea data-testid="input-student-notes" {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" data-testid="button-submit-student" disabled={createStudent.isPending || updateStudent.isPending}>
                  {editing ? "Save Changes" : "Add Student"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
