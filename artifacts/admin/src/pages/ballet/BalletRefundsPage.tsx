import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, FileText } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_URL as string | undefined ?? "";
const API_KEY = import.meta.env.VITE_API_KEY as string | undefined ?? "";

function headers(token: string | null): HeadersInit {
  return { "Content-Type": "application/json", ...(API_KEY ? { "x-api-key": API_KEY } : {}), ...(token ? { "x-admin-token": token } : {}) };
}

async function adminFetch<T>(url: string, init: RequestInit, token: string | null): Promise<T> {
  const res = await fetch(url, { ...init, headers: headers(token) });
  if (!res.ok) throw await res.json().catch(() => ({ error: "Request failed" }));
  return res.json() as Promise<T>;
}

interface RefundRow {
  id: number;
  applicationId: number;
  paymentId: number;
  childName: string | null;
  parentName: string | null;
  status: string;
  refundMethod: string;
  approvedAmountEgp: number | null;
  refundedAmountEgp: number | null;
  paymentAmountEgp: number | null;
  paymentMethod: string | null;
  transactionReference: string | null;
  requestedReason: string;
  createdAt: string;
}

interface ListResponse { data: RefundRow[]; total: number }

function badgeClass(status: string) {
  if (status === "refunded") return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  if (status === "rejected" || status === "failed") return "bg-red-500/15 text-red-400 border-red-500/30";
  if (status === "approved" || status === "processing") return "bg-cyan-500/15 text-cyan-400 border-cyan-500/30";
  return "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
}

export default function BalletRefundsPage() {
  const { token, can } = useAdminAuth();
  // Finance Roles & Permissions integration: refund control buttons require
  // finance.refundsManage — a view-only user can see refund records here
  // but must not execute refund actions. Backend independently enforces the
  // same permission on every mutation endpoint.
  const canManageRefunds = can("finance", "refundsManage");
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("");
  const [amountById, setAmountById] = useState<Record<number, string>>({});
  const [referenceById, setReferenceById] = useState<Record<number, string>>({});

  const { data, isLoading, isError } = useQuery({
    queryKey: ["ballet-refunds", status, token],
    queryFn: () => adminFetch<ListResponse>(`${API_BASE}/api/admin/ballet/refunds?${new URLSearchParams({ ...(status ? { status } : {}) })}`, {}, token),
    refetchOnWindowFocus: false,
  });

  const mutate = useMutation({
    mutationFn: ({ id, path, body }: { id: number; path: string; body?: Record<string, unknown> }) =>
      adminFetch(`${API_BASE}/api/admin/ballet/refunds/${id}/${path}`, { method: "POST", body: JSON.stringify(body ?? {}) }, token),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ballet-refunds"] }),
  });

  const rows = data?.data ?? [];
  return (
    <div className="admin2-ballet-page admin2-ballet-ledger space-y-6">
      <PageHeader title="Ballet Refunds" description="Cash refund review and processing. Bank Transfer and Online refunds are not available." mode="stage" />
      <Select value={status || "all"} onValueChange={(value) => setStatus(value === "all" ? "" : value)}>
        <SelectTrigger className="h-8 w-56 text-sm"><SelectValue placeholder="All statuses" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          {["underReview", "approved", "processing", "refunded", "rejected", "failed", "withdrawn"].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
        </SelectContent>
      </Select>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader><TableRow><TableHead>ID</TableHead><TableHead>Child</TableHead><TableHead>Status</TableHead><TableHead>Original Payment</TableHead><TableHead>Approved</TableHead><TableHead>Refunded</TableHead><TableHead>Reason</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
          <TableBody>
            {isLoading ? <TableRow><TableCell colSpan={8} className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></TableCell></TableRow>
              : isError ? <TableRow><TableCell colSpan={8} className="py-8 text-center text-destructive">Failed to load refunds.</TableCell></TableRow>
              : rows.length === 0 ? <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">No refunds.</TableCell></TableRow>
              : rows.map((row) => {
                const amount = Number(amountById[row.id] || row.approvedAmountEgp || row.paymentAmountEgp || 0);
                return (
                  <TableRow key={row.id}>
                    <TableCell>#{row.id}</TableCell>
                    <TableCell>{row.childName ?? "—"}<div className="text-xs text-muted-foreground">{row.parentName ?? ""}</div></TableCell>
                    <TableCell><Badge variant="outline" className={badgeClass(row.status)}>{row.status}</Badge><div className="text-xs text-muted-foreground">Cash only</div></TableCell>
                    <TableCell>{(row.paymentAmountEgp ?? 0).toLocaleString()} EGP<div className="text-xs text-muted-foreground">{row.paymentMethod === "inPerson" ? "Pay at Studio" : row.paymentMethod ?? "—"}</div></TableCell>
                    <TableCell>{row.approvedAmountEgp?.toLocaleString() ?? "—"}</TableCell>
                    <TableCell>{row.refundedAmountEgp?.toLocaleString() ?? "—"}</TableCell>
                    <TableCell className="max-w-xs truncate">{row.requestedReason}</TableCell>
                    <TableCell className="min-w-[360px] space-y-2 text-right">
                      {(row.status === "underReview" || row.status === "approved" || row.status === "processing") && (
                        <div className="flex justify-end gap-2">
                          <Input className="h-8 w-24" type="number" value={amountById[row.id] ?? ""} placeholder={String(row.approvedAmountEgp ?? row.paymentAmountEgp ?? "")} onChange={(event) => setAmountById((prev) => ({ ...prev, [row.id]: event.target.value }))} />
                          <Input className="h-8 w-32" value={referenceById[row.id] ?? ""} placeholder="Receipt/ref" onChange={(event) => setReferenceById((prev) => ({ ...prev, [row.id]: event.target.value }))} />
                        </div>
                      )}
                      {canManageRefunds && row.status === "underReview" && <Button size="sm" variant="outline" onClick={() => mutate.mutate({ id: row.id, path: "approve", body: { approvedAmountEgp: amount, refundMethod: "cash" } })}>Approve Cash</Button>}
                      {canManageRefunds && row.status === "underReview" && <Button size="sm" variant="destructive" onClick={() => mutate.mutate({ id: row.id, path: "reject", body: { adminNotes: "Rejected by admin" } })}>Reject</Button>}
                      {canManageRefunds && row.status === "approved" && <Button size="sm" variant="outline" onClick={() => mutate.mutate({ id: row.id, path: "mark-processing" })}>Processing</Button>}
                      {canManageRefunds && (row.status === "approved" || row.status === "processing") && <Button size="sm" variant="outline" onClick={() => mutate.mutate({ id: row.id, path: "mark-refunded", body: { refundedAmountEgp: amount, transactionReference: referenceById[row.id] || `cash-refund-${row.id}` } })}>Mark Refunded</Button>}
                      {canManageRefunds && (row.status === "approved" || row.status === "processing") && <Button size="sm" variant="destructive" onClick={() => mutate.mutate({ id: row.id, path: "mark-failed", body: { failedReason: "Marked failed by admin" } })}>Failed</Button>}
                      <Button size="sm" variant="ghost" onClick={() => navigate(`/ballet/applications/${row.applicationId}`)}><FileText className="mr-1 h-3.5 w-3.5" />App</Button>
                    </TableCell>
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
import "./admin2-ballet.css";
