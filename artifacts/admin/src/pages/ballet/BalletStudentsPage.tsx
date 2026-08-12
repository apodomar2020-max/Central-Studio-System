/**
 * Ballet Students — current active ballet_level_assignments roster.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, ChevronLeft, ChevronRight, Eye } from "lucide-react";

interface StudentRow {
  assignmentId: number;
  applicationId: number;
  studentName: string;
  parentName: string;
  parentPhone: string;
  age: number | null;
  dateJoined: string | null;
  levelId: number | null;
  levelName: string | null;
  groupId: number | null;
  groupName: string | null;
  paymentStatus: string | null;
  subscriptionStatus: "pending" | "active" | "renewed" | "expired";
  subscriptionDisplayStatus: string;
  subscriptionStartDate: string | null;
  subscriptionExpiresAt: string | null;
  daysRemaining: number | null;
}

interface ListResponse {
  data: StudentRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const API_BASE = import.meta.env.VITE_API_URL as string | undefined ?? "";
const API_KEY = import.meta.env.VITE_API_KEY as string | undefined ?? "";
const LIMIT = 20;

function makeHeaders(token: string | null): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(API_KEY ? { "x-api-key": API_KEY } : {}),
    ...(token ? { "x-admin-token": token } : {}),
  };
}

function SubscriptionBadge({ student }: { student: StudentRow }) {
  const className = student.subscriptionStatus === "expired"
    ? "bg-red-500/15 text-red-400 border-red-500/30"
    : student.subscriptionStatus === "renewed"
      ? "bg-cyan-500/15 text-cyan-400 border-cyan-500/30"
      : student.subscriptionStatus === "active"
        ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
        : "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
  return <Badge variant="outline" className={className}>{student.subscriptionDisplayStatus}</Badge>;
}

function PaymentBadge({ status }: { status: string | null }) {
  if (!status) return <span className="italic text-muted-foreground">—</span>;
  const className = status === "paid"
    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
    : status === "rejected"
      ? "bg-red-500/15 text-red-400 border-red-500/30"
      : status === "refunded"
        ? "bg-slate-500/15 text-slate-400 border-slate-500/30"
        : "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
  return <Badge variant="outline" className={className}>{status.replace(/^./, (c) => c.toUpperCase())}</Badge>;
}

export default function BalletStudentsPage() {
  const { token } = useAdminAuth();
  const [, navigate] = useLocation();
  const [page, setPage] = useState(1);

  const { data, isLoading, isError } = useQuery<ListResponse>({
    queryKey: ["ballet-students", page, token],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      const res = await fetch(`${API_BASE}/api/admin/ballet/students?${params}`, { headers: makeHeaders(token) });
      if (!res.ok) throw new Error("Failed to load students");
      return res.json();
    },
  });

  const dash = <span className="italic text-muted-foreground">—</span>;

  return (
    <div className="admin2-ballet-page admin2-ballet-people space-y-6">
      <PageHeader title="Ballet Students" description="Ballet student files created from current level assignments" mode="stage" />

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Student Name</TableHead>
              <TableHead>Parent Name</TableHead>
              <TableHead>Parent Phone</TableHead>
              <TableHead>Age</TableHead>
              <TableHead>Date Joined</TableHead>
              <TableHead>Level</TableHead>
              <TableHead>Group</TableHead>
              <TableHead>Payment Status</TableHead>
              <TableHead>Subscription</TableHead>
              <TableHead>Start</TableHead>
              <TableHead>Expiry</TableHead>
              <TableHead>Days</TableHead>
              <TableHead className="w-16 text-right">View</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={13} className="py-10 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></TableCell></TableRow>
            ) : isError ? (
              <TableRow><TableCell colSpan={13} className="py-10 text-center text-destructive text-sm">Failed to load students.</TableCell></TableRow>
            ) : data?.data.length === 0 ? (
              <TableRow><TableCell colSpan={13} className="py-10 text-center text-muted-foreground text-sm">No active ballet students yet.</TableCell></TableRow>
            ) : (
              data?.data.map((s) => (
                <TableRow
                  key={s.assignmentId}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => navigate(`/ballet/students/${s.assignmentId}`)}
                  tabIndex={0}
                  role="link"
                  aria-label={`Open Ballet student file for ${s.studentName}`}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      navigate(`/ballet/students/${s.assignmentId}`);
                    }
                  }}
                >
                  <TableCell className="font-medium">{s.studentName}</TableCell>
                  <TableCell>{s.parentName}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{s.parentPhone}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{s.age ?? dash}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{s.dateJoined ? new Date(s.dateJoined).toLocaleDateString() : dash}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{s.levelName ?? dash}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{s.groupName ?? dash}</TableCell>
                  <TableCell><PaymentBadge status={s.paymentStatus} /></TableCell>
                  <TableCell><SubscriptionBadge student={s} /></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{s.subscriptionStartDate ?? dash}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{s.subscriptionExpiresAt ?? dash}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{s.daysRemaining != null ? s.daysRemaining : dash}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`View student ${s.assignmentId}`} onClick={(e) => { e.stopPropagation(); navigate(`/ballet/students/${s.assignmentId}`); }}>
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {data && data.totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>Showing {((page - 1) * LIMIT) + 1}–{Math.min(page * LIMIT, data.total)} of {data.total}</span>
          <div className="flex gap-1">
            <Button variant="outline" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
            <span className="flex items-center px-2 text-xs">{page} / {data.totalPages}</span>
            <Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      )}
    </div>
  );
}
import "./admin2-ballet.css";
