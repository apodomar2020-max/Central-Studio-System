import { useEffect, useState } from "react";
import { useListStudents } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { PageHeader } from "@/components/layout/page-header";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BadgeCheck } from "lucide-react";

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

/** Profile Completion Engine (Phase 4) fields — see the matching type in students.tsx. */
type ParentRow = {
  id: number;
  name: string;
  email: string;
  phone?: string | null;
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
  const { data: parentsResponse, isLoading } = useListStudents(listParams);

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

  return (
    <div className="space-y-6">
      <PageHeader title="Parents" description="Manage parent accounts and children profiles" mode="studio" />

      <div className="flex flex-col gap-3 rounded-md border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search parents by name, email, or phone"
          className="max-w-md"
          data-testid="input-parent-search"
        />
        <div className="flex items-center gap-2">
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

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Children Count</TableHead>
              <TableHead>Profile</TableHead>
              <TableHead>Signup</TableHead>
              <TableHead>Joined</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8">Loading...</TableCell></TableRow>
            ) : parents.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No parent accounts found.</TableCell></TableRow>
            ) : (
              parents.map((parent) => (
                <TableRow key={parent.id} data-testid={`row-parent-${parent.id}`}>
                  <TableCell className="font-medium">
                    <Link href={`/parents/${parent.id}`} className="hover:underline flex items-center gap-2">
                      <Avatar className="h-7 w-7">
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
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-3 rounded-md border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-muted-foreground">
          Showing {startItem}–{endItem} of {total.toLocaleString()} parents
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={currentPage <= 1 || isLoading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <div className="flex items-center gap-1">
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
    </div>
  );
}
