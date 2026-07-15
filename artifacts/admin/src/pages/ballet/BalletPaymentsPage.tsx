/**
 * Ballet -> Payments - /ballet/payments
 *
 * Read-only financial history for Ballet applications. Payment creation,
 * status changes, renewals, and extensions are owned by Application Detail.
 */

import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, ChevronLeft, ChevronRight, FileText } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_URL as string | undefined ?? "";
const API_KEY  = import.meta.env.VITE_API_KEY  as string | undefined ?? "";
const LIMIT = 20;

function makeHeaders(token: string | null): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(API_KEY ? { "x-api-key": API_KEY } : {}),
    ...(token ? { "x-admin-token": token } : {}),
  };
}

async function adminFetch<T>(url: string, init: RequestInit, token: string | null): Promise<T> {
  const res = await fetch(url, { ...init, headers: makeHeaders(token) });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw { data };
  }
  return res.json() as Promise<T>;
}

const STATUSES = ["pending", "rejected", "paid", "refunded"] as const;
type PaymentStatus = (typeof STATUSES)[number];

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  bankTransfer: "Legacy Bank Transfer",
  kashier: "Online Payment",
  inPerson: "Pay at Studio",
};

function statusBadgeClass(status: string | null | undefined) {
  switch (status) {
    case "paid": return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case "rejected": return "bg-red-500/15 text-red-400 border-red-500/30";
    case "refunded": return "bg-purple-500/15 text-purple-400 border-purple-500/30";
    case "pending": return "bg-blue-500/15 text-blue-400 border-blue-500/30";
    default: return "bg-slate-500/15 text-slate-400 border-slate-500/30";
  }
}

function subscriptionBadgeClass(status: string | null | undefined) {
  switch (status) {
    case "active": return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case "renewed": return "bg-cyan-500/15 text-cyan-400 border-cyan-500/30";
    case "expired": return "bg-red-500/15 text-red-400 border-red-500/30";
    default: return "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
  }
}

function titleCase(value: string | null | undefined) {
  if (!value) return null;
  return value.replace(/^./, (letter) => letter.toUpperCase());
}

function formatPaymentMethod(method: string | null | undefined) {
  return method ? PAYMENT_METHOD_LABELS[method] ?? method : null;
}

interface BalletPayment {
  id: number;
  applicationId: number;
  studentName?: string | null;
  childName?: string | null;
  parentName?: string | null;
  packageName?: string | null;
  packageId: number | null;
  packageOrderId: number | null;
  amountEgp: number;
  status: PaymentStatus;
  paymentMethod: string | null;
  billingMonth: string | null;
  subscriptionStatus?: "pending" | "active" | "renewed" | "expired" | null;
  subscriptionDisplayStatus?: string | null;
  subscriptionStartDate?: string | null;
  subscriptionExpiresAt?: string | null;
  paidAt: string | null;
  refundedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt?: string | null;
}

interface ListResponse {
  data: BalletPayment[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export default function BalletPaymentsPage() {
  const { token } = useAdminAuth();
  const [, navigate] = useLocation();
  const [statusFilter, setStatusFilter] = useState("");
  const [applicationIdFilter, setApplicationIdFilter] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-ballet-payments", page, statusFilter, applicationIdFilter, token],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(LIMIT),
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(applicationIdFilter ? { applicationId: applicationIdFilter } : {}),
      });
      return adminFetch<ListResponse>(`${API_BASE}/api/admin/ballet/payments?${params}`, {}, token);
    },
    refetchOnWindowFocus: false,
  });
  const payments = data?.data ?? [];
  const dash = <span className="italic text-muted-foreground">-</span>;

  return (
    <div className="space-y-6">
      <PageHeader title="Ballet Payments" description="Read-only payment and subscription history for Ballet applications" mode="stage" />

      <div className="flex items-center gap-3 flex-wrap">
        <Select value={statusFilter || "all"} onValueChange={(value) => { setStatusFilter(value === "all" ? "" : value); setPage(1); }}>
          <SelectTrigger className="h-8 w-40 text-sm" data-testid="select-payment-status-filter">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((status) => <SelectItem key={status} value={status}>{titleCase(status)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input
          type="number"
          placeholder="Filter by application ID"
          className="h-8 w-52 text-sm"
          value={applicationIdFilter}
          onChange={(event) => { setApplicationIdFilter(event.target.value); setPage(1); }}
          data-testid="input-payment-application-filter"
        />
      </div>

      <div className="border rounded-md overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Application</TableHead>
              <TableHead>Student/Child</TableHead>
              <TableHead>Parent</TableHead>
              <TableHead>Package</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Billing Month</TableHead>
              <TableHead>Payment Method</TableHead>
              <TableHead>Payment Status</TableHead>
              <TableHead>Subscription Status</TableHead>
              <TableHead>Start Date</TableHead>
              <TableHead>Expiry Date</TableHead>
              <TableHead>Last Update</TableHead>
              <TableHead className="text-right">View</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={13} className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></TableCell></TableRow>
            ) : isError ? (
              <TableRow><TableCell colSpan={13} className="text-center py-8 text-destructive text-sm">Failed to load payments.</TableCell></TableRow>
            ) : payments.length === 0 ? (
              <TableRow><TableCell colSpan={13} className="text-center py-8 text-muted-foreground">No Ballet payment history yet.</TableCell></TableRow>
            ) : (
              payments.map((payment) => (
                <TableRow key={payment.id} data-testid={`row-ballet-payment-${payment.id}`}>
                  <TableCell className="font-medium">#{payment.applicationId}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{payment.studentName ?? payment.childName ?? dash}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{payment.parentName ?? dash}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{payment.packageName ?? (payment.packageId ? `Package #${payment.packageId}` : dash)}</TableCell>
                  <TableCell>{payment.amountEgp.toLocaleString()} EGP</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{payment.billingMonth ?? dash}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatPaymentMethod(payment.paymentMethod) ?? dash}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={statusBadgeClass(payment.status)}>
                      {titleCase(payment.status)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={subscriptionBadgeClass(payment.subscriptionStatus)}>
                      {payment.subscriptionDisplayStatus ?? titleCase(payment.subscriptionStatus) ?? "Pending Payment"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{payment.subscriptionStartDate ?? dash}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{payment.subscriptionExpiresAt ?? dash}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{payment.updatedAt ? new Date(payment.updatedAt).toLocaleString() : new Date(payment.createdAt).toLocaleString()}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => navigate(`/ballet/applications/${payment.applicationId}`)}>
                      <FileText className="mr-2 h-3.5 w-3.5" />
                      Open
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
          <span>
            Showing {((page - 1) * LIMIT) + 1}-{Math.min(page * LIMIT, data.total)} of {data.total}
          </span>
          <div className="flex gap-1">
            <Button variant="outline" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="flex items-center px-2 text-xs">{page} / {data.totalPages}</span>
            <Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= data.totalPages} onClick={() => setPage((current) => current + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
