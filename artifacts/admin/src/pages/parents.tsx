import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { useListStudents, useUpdateStudent, getListStudentsQueryKey } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { BadgeCheck, Edit } from "lucide-react";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { useToast } from "@/hooks/use-toast";
import { WorkspaceRouteNav } from "@/components/admin/workspace-route-nav";
import "./admin2-operations.css";

/**
 * Parent edit (Phase 3) — Parents live in the same table/endpoints as
 * Students; PATCH /students/:id already authorizes `parents.edit` (or
 * `users.edit`) for parent accounts, so this reuses useUpdateStudent as-is.
 * Same safe fields as the Students edit dialog.
 */
const editFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Valid email required"),
  phone: z.string().nullish(),
  notes: z.string().nullish(),
});

type EditFormValues = z.input<typeof editFormSchema>;

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

/** Profile Completion Engine (Phase 4) fields — see the matching type in students.tsx. */
type ParentRow = {
  id: number;
  name: string;
  email: string;
  phone?: string | null;
  notes?: string | null;
  avatarUrl?: string | null;
  joinedAt: string;
  childCount?: number;
  authProvider?: string | null;
  howDidYouHearAboutUs?: string | null;
  danceInterestCount?: number;
  verificationBadge?: boolean;
  profileCompletion?: { percent: number; isComplete: boolean } | null;
};

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

export default function ParentsPage() {
  const { can } = useAdminAuth();
  const canEdit = can("parents", "edit");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateParent = useUpdateStudent();
  const [editing, setEditing] = useState<ParentRow | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(50);
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const listParams = {
    accountType: "parent" as const,
    page,
    pageSize,
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
  };
  const { data: parentsResponse, isLoading, isError } = useListStudents(listParams);

  const parents = (parentsResponse?.students ?? []) as ParentRow[];
  const total = parentsResponse?.total ?? 0;
  const currentPage = parentsResponse?.page ?? page;
  const totalPages = parentsResponse?.totalPages ?? 0;
  const responsePageSize = parentsResponse?.pageSize ?? pageSize;
  const startItem = total === 0 ? 0 : (currentPage - 1) * responsePageSize + 1;
  const endItem = total === 0 ? 0 : Math.min(currentPage * responsePageSize, total);
  const paginationPages = paginationRange(currentPage, totalPages);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, pageSize]);

  const form = useForm<EditFormValues>({
    resolver: zodResolver(editFormSchema),
    defaultValues: { name: "", email: "" },
  });

  const openEdit = (parent: ParentRow) => {
    setEditing(parent);
    form.reset({
      name: parent.name,
      email: parent.email,
      phone: parent.phone ?? "",
      notes: parent.notes ?? "",
    });
  };

  const onSubmit = (values: EditFormValues) => {
    if (!editing) return;
    const parsed = editFormSchema.parse(values);
    updateParent.mutate(
      { id: editing.id, data: parsed },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListStudentsQueryKey() });
          setEditing(null);
          toast({ title: "Parent updated" });
        },
        onError: (error: unknown) => {
          const err = error as { data?: { error?: string }; message?: string };
          toast({
            title: "Failed to update parent",
            description: err?.data?.error ?? err?.message ?? "Something went wrong",
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <div className="admin2-ops-page admin2-parents">
      {/* Production refinement: same compact single-toolbar composition as
          Students — see students.tsx for the full rationale. Parents has no
          Add action, so the toolbar is switcher + search + rows. */}
      <div className="admin2-command-bar admin2-users-command">
        <WorkspaceRouteNav
          ariaLabel="Users workspace"
          items={[
            ...(can("students", "view") ? [{ label: "Students", href: "/students" }] : []),
            ...(can("parents", "view") ? [{ label: "Parents", href: "/parents" }] : []),
          ]}
        />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search parents by name, email, or phone"
          className="admin2-users-search"
          data-testid="input-parent-search"
        />
        <div className="admin2-users-rows">
          <span className="text-sm text-muted-foreground">Rows</span>
          <Select value={String(pageSize)} onValueChange={(value) => setPageSize(Number(value) as (typeof PAGE_SIZE_OPTIONS)[number])}>
            <SelectTrigger className="w-24" data-testid="select-parent-page-size">
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

      <div className="admin2-people-registry">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Children Count</TableHead>
              <TableHead>Profile</TableHead>
              <TableHead>Signup</TableHead>
              <TableHead>Joined</TableHead>
              {canEdit && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={canEdit ? 7 : 6} className="text-center py-8">Loading...</TableCell></TableRow>
            ) : isError ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-destructive">Parents could not be loaded. Try again in a moment.</TableCell></TableRow>
            ) : parents.length === 0 ? (
              <TableRow><TableCell colSpan={canEdit ? 7 : 6} className="text-center py-8 text-muted-foreground">No parent accounts found.</TableCell></TableRow>
            ) : (
              parents.map((parent) => (
                <TableRow key={parent.id} data-testid={`row-parent-${parent.id}`}>
                  <TableCell className="font-medium">
                    <Link href={`/parents/${parent.id}`} className="hover:underline flex items-center gap-2">
                      <Avatar className="h-9 w-9">
                        {parent.avatarUrl ? <AvatarImage src={parent.avatarUrl} alt={parent.name} /> : null}
                        <AvatarFallback>{parent.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <span>{parent.name}</span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div>{parent.email}</div>
                    <div className="text-xs text-muted-foreground">{parent.phone}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {parent.childCount ?? 0} {parent.childCount === 1 ? "Child" : "Children"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {parent.profileCompletion ? (
                      <div className="flex items-center gap-1.5">
                        <Badge variant={parent.profileCompletion.isComplete ? "default" : "outline"}>
                          {parent.profileCompletion.percent}%
                        </Badge>
                        {parent.verificationBadge && <BadgeCheck className="h-4 w-4 text-emerald-400" aria-label="Verified" />}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="capitalize text-sm">{parent.authProvider ?? "manual"}</div>
                    {parent.howDidYouHearAboutUs && <div className="text-xs text-muted-foreground">{parent.howDidYouHearAboutUs}</div>}
                  </TableCell>
                  <TableCell>{new Date(parent.joinedAt).toLocaleDateString()}</TableCell>
                  {canEdit && (
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Edit ${parent.name}`}
                        title="Edit parent"
                        data-testid={`button-edit-parent-${parent.id}`}
                        onClick={() => openEdit(parent)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="admin2-registry-pagination flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-muted-foreground">
          Showing {startItem}–{endItem} of {total.toLocaleString()} parents
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

      {/* Parent edit dialog — same fields/pattern as the Students edit dialog */}
      <Dialog open={editing != null} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent className="admin2-ops-dialog">
          <DialogHeader>
            <DialogTitle>Edit Parent</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl><Input data-testid="input-parent-name" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl><Input type="email" data-testid="input-parent-email" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone</FormLabel>
                  <FormControl><Input data-testid="input-parent-phone" {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl><Textarea data-testid="input-parent-notes" {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                <Button type="submit" data-testid="button-submit-parent" disabled={updateParent.isPending}>
                  Save Changes
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
