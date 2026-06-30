import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Eye, MessageSquareText, Search, Star } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAdminAuth } from "@/contexts/AdminAuthContext";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
const API_KEY = (import.meta.env.VITE_API_KEY as string | undefined) ?? "";
const PAGE_SIZE = 25;

interface FeedbackListRow {
  id: number;
  attendanceId: number;
  student: string;
  studentEmail: string;
  child: string | null;
  trainer: string | null;
  classTitle: string | null;
  rating: number;
  commentPreview: string | null;
  hasComment: boolean;
  reviewStatus: string;
  submittedAt: string | null;
  receivedAt: string;
}

interface FeedbackListResponse {
  data: FeedbackListRow[];
  total: number;
  page: number;
  pageSize: number;
}

function makeHeaders(token?: string | null): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(API_KEY ? { "x-api-key": API_KEY } : {}),
    ...(token ? { "x-admin-token": token } : {}),
  };
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "resolved": return "border-emerald-400/40 bg-emerald-500/10 text-emerald-300";
    case "in_review": return "border-cyan-400/40 bg-cyan-500/10 text-cyan-300";
    case "dismissed": return "border-slate-400/40 bg-slate-500/10 text-slate-300";
    default: return "border-amber-400/40 bg-amber-500/10 text-amber-300";
  }
}

function formatDate(value?: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-[#00B6D7]">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} className={`h-3.5 w-3.5 ${i < rating ? "fill-current" : "opacity-25"}`} />
      ))}
    </span>
  );
}

export default function FeedbackPage() {
  const { token, can } = useAdminAuth();
  const canViewComments = can("feedback", "viewComments");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [rating, setRating] = useState("all");
  const [reviewStatus, setReviewStatus] = useState("all");

  const query = useQuery({
    queryKey: ["feedback", page, search, rating, reviewStatus],
    queryFn: async (): Promise<FeedbackListResponse> => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (search.trim()) params.set("search", search.trim());
      if (rating !== "all") params.set("rating", rating);
      if (reviewStatus !== "all") params.set("reviewStatus", reviewStatus);

      const res = await fetch(`${API_BASE}/api/feedback?${params.toString()}`, {
        headers: makeHeaders(token),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Failed to load feedback");
      }
      return res.json();
    },
  });

  const total = query.data?.total ?? 0;
  const totalPages = total === 0 ? 0 : Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Feedback"
        description="Internal class feedback for Central Studio quality review."
        mode="studio"
      />

      <Card>
        <CardContent className="p-4">
          <div className="grid gap-3 md:grid-cols-[1fr_180px_180px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search student, child, trainer, class..."
                className="pl-9"
              />
            </div>
            <Select value={rating} onValueChange={(v) => { setRating(v); setPage(1); }}>
              <SelectTrigger><SelectValue placeholder="Rating" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All ratings</SelectItem>
                {[5, 4, 3, 2, 1].map((n) => <SelectItem key={n} value={String(n)}>{n} stars</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={reviewStatus} onValueChange={(v) => { setReviewStatus(v); setPage(1); }}>
              <SelectTrigger><SelectValue placeholder="Review status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="in_review">In review</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
                <SelectItem value="dismissed">Dismissed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                <TableHead>Child</TableHead>
                <TableHead>Trainer</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead>Rating</TableHead>
                <TableHead>Comment</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isLoading ? (
                <TableRow><TableCell colSpan={9} className="py-10 text-center text-muted-foreground">Loading feedback...</TableCell></TableRow>
              ) : query.isError ? (
                <TableRow><TableCell colSpan={9} className="py-10 text-center text-destructive">{query.error.message}</TableCell></TableRow>
              ) : query.data?.data.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="py-10 text-center text-muted-foreground">No feedback found.</TableCell></TableRow>
              ) : (
                query.data?.data.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="font-medium text-white">{row.student}</div>
                      <div className="text-xs text-muted-foreground">{row.studentEmail}</div>
                    </TableCell>
                    <TableCell>{row.child ?? "-"}</TableCell>
                    <TableCell>{row.trainer ?? "-"}</TableCell>
                    <TableCell>{row.classTitle ?? "-"}</TableCell>
                    <TableCell>{formatDate(row.receivedAt)}</TableCell>
                    <TableCell><Stars rating={row.rating} /></TableCell>
                    <TableCell className="max-w-[240px]">
                      {canViewComments ? (
                        row.commentPreview ? <span className="line-clamp-2 text-sm">{row.commentPreview}</span> : <span className="text-muted-foreground">No comment</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <MessageSquareText className="h-3.5 w-3.5" /> Hidden
                        </span>
                      )}
                    </TableCell>
                    <TableCell><Badge variant="outline" className={statusBadgeClass(row.reviewStatus)}>{row.reviewStatus.replace("_", " ")}</Badge></TableCell>
                    <TableCell className="text-right">
                      <Link href={`/feedback/${row.id}`}>
                        <Button size="sm" variant="outline" className="gap-1"><Eye className="h-3.5 w-3.5" /> View</Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>Showing {query.data?.data.length ?? 0} of {total}</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
          <Button variant="outline" size="sm" disabled={totalPages === 0 || page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      </div>
    </div>
  );
}
