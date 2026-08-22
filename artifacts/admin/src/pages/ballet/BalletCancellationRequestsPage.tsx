import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, FileText } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_URL as string | undefined ?? "";

function headers(token: string | null): HeadersInit {
  return { "Content-Type": "application/json", ...(token ? { "x-admin-token": token } : {}) };
}

async function adminFetch<T>(url: string, init: RequestInit, token: string | null): Promise<T> {
  const res = await fetch(url, { ...init, headers: headers(token) });
  if (!res.ok) throw await res.json().catch(() => ({ error: "Request failed" }));
  return res.json() as Promise<T>;
}

interface CancellationRow {
  id: number;
  applicationId: number | null;
  levelAssignmentId: number | null;
  childName: string | null;
  parentName: string | null;
  status: string;
  requestedTiming: string;
  approvedTiming: string | null;
  approvedEffectiveDate: string | null;
  requestRefund: boolean;
  reason: string;
  initiatedByType?: string | null;
  initiatedByAdminName?: string | null;
  initiatedByAdminUsername?: string | null;
  createdAt: string;
}

interface ListResponse {
  data: CancellationRow[];
  total: number;
}

function badgeClass(status: string) {
  if (status === "completed") return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  if (status === "rejected") return "bg-red-500/15 text-red-400 border-red-500/30";
  if (status === "approved") return "bg-cyan-500/15 text-cyan-400 border-cyan-500/30";
  if (status === "withdrawnByParent") return "bg-slate-500/15 text-slate-400 border-slate-500/30";
  return "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
}

export default function BalletCancellationRequestsPage() {
  const { token } = useAdminAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["ballet-cancellation-requests", status, token],
    queryFn: () => adminFetch<ListResponse>(`${API_BASE}/api/admin/ballet/cancellation-requests?${new URLSearchParams({ ...(status ? { status } : {}) })}`, {}, token),
    refetchOnWindowFocus: false,
  });

  const action = useMutation({
    mutationFn: ({ id, path }: { id: number; path: string }) => adminFetch(`${API_BASE}/api/admin/ballet/cancellation-requests/${id}/${path}`, { method: "POST", body: JSON.stringify({}) }, token),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ballet-cancellation-requests"] }),
  });

  const rows = data?.data ?? [];
  return (
    <div className="admin2-ballet-page admin2-ballet-queue space-y-6">
      <PageHeader title="Ballet Cancellation Requests" description="Review and finalize active enrollment cancellation requests." mode="stage" />
      <Select value={status || "all"} onValueChange={(value) => setStatus(value === "all" ? "" : value)}>
        <SelectTrigger className="h-8 w-56 text-sm"><SelectValue placeholder="All statuses" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          {["pendingReview", "approved", "rejected", "withdrawnByParent", "completed"].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
        </SelectContent>
      </Select>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader><TableRow><TableHead>ID</TableHead><TableHead>Child</TableHead><TableHead>Parent</TableHead><TableHead>Status</TableHead><TableHead>Timing</TableHead><TableHead>Initiated By</TableHead><TableHead>Refund?</TableHead><TableHead>Reason</TableHead><TableHead>Created</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
          <TableBody>
            {isLoading ? <TableRow><TableCell colSpan={10} className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></TableCell></TableRow>
              : isError ? <TableRow><TableCell colSpan={10} className="py-8 text-center text-destructive">Failed to load cancellation requests.</TableCell></TableRow>
              : rows.length === 0 ? <TableRow><TableCell colSpan={10} className="py-8 text-center text-muted-foreground">No cancellation requests.</TableCell></TableRow>
              : rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>#{row.id}</TableCell>
                  <TableCell>{row.childName ?? "—"}</TableCell>
                  <TableCell>{row.parentName ?? "—"}</TableCell>
                  <TableCell><Badge variant="outline" className={badgeClass(row.status)}>{row.status}</Badge></TableCell>
                  <TableCell>{row.approvedTiming ?? row.requestedTiming}{row.approvedEffectiveDate ? ` · ${row.approvedEffectiveDate}` : ""}</TableCell>
                  <TableCell>{row.initiatedByType === "admin" ? (row.initiatedByAdminName ?? row.initiatedByAdminUsername ?? "Admin") : "Parent"}</TableCell>
                  <TableCell>{row.requestRefund ? "Yes" : "No"}</TableCell>
                  <TableCell className="max-w-xs truncate">{row.reason}</TableCell>
                  <TableCell>{new Date(row.createdAt).toLocaleString()}</TableCell>
                  <TableCell className="space-x-2 text-right">
                    {row.status === "pendingReview" && <Button size="sm" variant="outline" onClick={() => action.mutate({ id: row.id, path: "approve-immediate" })}>Approve Now</Button>}
                    {row.status === "pendingReview" && <Button size="sm" variant="outline" onClick={() => action.mutate({ id: row.id, path: "approve-end-of-period" })}>End Period</Button>}
                    {row.status === "pendingReview" && <Button size="sm" variant="destructive" onClick={() => action.mutate({ id: row.id, path: "reject" })}>Reject</Button>}
                    {row.status === "approved" && <Button size="sm" variant="outline" onClick={() => action.mutate({ id: row.id, path: "finalize" })}>Finalize</Button>}
                    {row.applicationId && <Button size="sm" variant="ghost" onClick={() => navigate(`/ballet/applications/${row.applicationId}`)}><FileText className="mr-1 h-3.5 w-3.5" />App</Button>}
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
import "./admin2-ballet.css";
