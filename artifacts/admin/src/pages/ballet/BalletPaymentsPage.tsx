/**
 * Ballet → Payments — /ballet/payments
 *
 * Payment records tied to ballet applications. Paginated like
 * GET /admin/ballet/applications (ApplicationsPage.tsx) since payment
 * volume grows over time, unlike the small catalog-style Ballet pages.
 *
 * The "refunded" status transition is a real backend side effect — it
 * withdraws the student's level assignment — so it goes through a distinct
 * confirmation step (AlertDialog) rather than a plain dropdown selection.
 *
 * Uses the raw-fetch pattern established by the other Ballet admin pages
 * rather than the generated @workspace/api-client-react hooks.
 */

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, ChevronLeft, ChevronRight } from "lucide-react";

// ─── API helpers ──────────────────────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_API_URL as string | undefined ?? "";
const API_KEY  = import.meta.env.VITE_API_KEY  as string | undefined ?? "";

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

const LIMIT = 20;
const STATUSES = ["pending", "rejected", "paid", "refunded"] as const;
type PaymentStatus = (typeof STATUSES)[number];

function statusBadgeClass(status: PaymentStatus) {
  switch (status) {
    case "pending": return "bg-blue-500/15 text-blue-400 border-blue-500/30";
    case "paid": return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case "rejected": return "bg-red-500/15 text-red-400 border-red-500/30";
    case "refunded": return "bg-purple-500/15 text-purple-400 border-purple-500/30";
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface BalletPayment {
  id: number;
  applicationId: number;
  levelAssignmentId: number | null;
  packageId: number | null;
  packageOrderId: number | null;
  amountEgp: number;
  status: PaymentStatus;
  paidAt: string | null;
  refundedAt: string | null;
  notes: string | null;
  createdAt: string;
}

interface ListResponse {
  data: BalletPayment[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const formSchema = z.object({
  applicationId: z.coerce.number().int().positive("Application ID is required"),
  amountEgp: z.coerce.number().int().positive("Amount is required"),
  packageId: z.coerce.number().int().positive().nullish(),
  packageOrderId: z.coerce.number().int().positive().nullish(),
  levelAssignmentId: z.coerce.number().int().positive().nullish(),
});

type FormValues = z.input<typeof formSchema>;

const EMPTY_VALUES: FormValues = {
  applicationId: undefined as unknown as number,
  amountEgp: undefined as unknown as number,
  packageId: undefined,
  packageOrderId: undefined,
  levelAssignmentId: undefined,
};

export default function BalletPaymentsPage() {
  const { token, can } = useAdminAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const canCreate = can("ballet.payments", "create");
  const canEdit = can("ballet.payments", "edit");

  const [statusFilter, setStatusFilter] = useState("");
  const [applicationIdFilter, setApplicationIdFilter] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [refundTarget, setRefundTarget] = useState<BalletPayment | null>(null);

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

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-ballet-payments"] });

  const createMutation = useMutation({
    mutationFn: (body: object) => adminFetch(`${API_BASE}/api/admin/ballet/payments`, { method: "POST", body: JSON.stringify(body) }, token),
    onSuccess: () => { invalidate(); toast({ title: "Payment created" }); setOpen(false); },
    onError: (e: any) => toast({ title: "Error", description: e?.data?.error ?? "Failed to create payment", variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: PaymentStatus }) =>
      adminFetch(`${API_BASE}/api/admin/ballet/payments/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }, token),
    onSuccess: (_, { status }) => {
      invalidate();
      toast({ title: status === "refunded" ? "Payment refunded — enrollment withdrawn" : "Payment status updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e?.data?.error ?? "Failed to update payment status", variant: "destructive" }),
  });

  const form = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: EMPTY_VALUES });

  const openCreate = () => {
    form.reset(EMPTY_VALUES);
    setOpen(true);
  };

  const onSubmit = (values: FormValues) => {
    const parsed = formSchema.parse(values);
    createMutation.mutate({
      applicationId: parsed.applicationId,
      amountEgp: parsed.amountEgp,
      packageId: parsed.packageId ?? undefined,
      packageOrderId: parsed.packageOrderId ?? undefined,
      levelAssignmentId: parsed.levelAssignmentId ?? undefined,
    });
  };

  function handleStatusChange(payment: BalletPayment, newStatus: PaymentStatus) {
    if (newStatus === payment.status) return;
    if (newStatus === "refunded") {
      setRefundTarget(payment);
      return;
    }
    statusMutation.mutate({ id: payment.id, status: newStatus });
  }

  function confirmRefund() {
    if (refundTarget) statusMutation.mutate({ id: refundTarget.id, status: "refunded" });
    setRefundTarget(null);
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Ballet Payments" description="Payment records for ballet applications" mode="stage" addLabel="Add Payment" addTestId="button-add-ballet-payment" onAdd={canCreate ? openCreate : undefined} />

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={statusFilter || "all"} onValueChange={(v) => { setStatusFilter(v === "all" ? "" : v); setPage(1); }}>
          <SelectTrigger className="h-8 w-40 text-sm" data-testid="select-payment-status-filter">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input
          type="number"
          placeholder="Filter by application ID"
          className="h-8 w-52 text-sm"
          value={applicationIdFilter}
          onChange={(e) => { setApplicationIdFilter(e.target.value); setPage(1); }}
          data-testid="input-payment-application-filter"
        />
      </div>

      {/* Table */}
      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Application</TableHead>
              <TableHead>Amount (EGP)</TableHead>
              <TableHead>Package Order</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Change Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></TableCell></TableRow>
            ) : isError ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-destructive text-sm">Failed to load payments.</TableCell></TableRow>
            ) : payments.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No ballet payments yet.</TableCell></TableRow>
            ) : (
              payments.map((payment) => (
                <TableRow key={payment.id} data-testid={`row-ballet-payment-${payment.id}`}>
                  <TableCell className="text-muted-foreground text-xs">{payment.id}</TableCell>
                  <TableCell className="font-medium">#{payment.applicationId}</TableCell>
                  <TableCell>{payment.amountEgp.toLocaleString()} EGP</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{payment.packageOrderId ? `#${payment.packageOrderId}` : "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={statusBadgeClass(payment.status)}>
                      {payment.status.charAt(0).toUpperCase() + payment.status.slice(1)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{new Date(payment.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell className="text-right">
                    {canEdit ? (
                      <Select value={payment.status} onValueChange={(v) => handleStatusChange(payment, v as PaymentStatus)}>
                        <SelectTrigger className="h-8 w-32 text-sm ml-auto" data-testid={`select-payment-status-${payment.id}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STATUSES.map((s) => <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>
            Showing {((page - 1) * LIMIT) + 1}–{Math.min(page * LIMIT, data.total)} of {data.total}
          </span>
          <div className="flex gap-1">
            <Button variant="outline" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="flex items-center px-2 text-xs">{page} / {data.totalPages}</span>
            <Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Ballet Payment</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="applicationId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Application ID</FormLabel>
                  <FormControl><Input type="number" data-testid="input-payment-application-id" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="amountEgp" render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount (EGP)</FormLabel>
                  <FormControl><Input type="number" min={0} data-testid="input-payment-amount" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="packageId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Package ID (optional)</FormLabel>
                  <FormControl><Input type="number" data-testid="input-payment-package-id" {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="packageOrderId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Package Order ID (optional)</FormLabel>
                  <FormControl><Input type="number" data-testid="input-payment-package-order-id" {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="levelAssignmentId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Level Assignment ID (optional)</FormLabel>
                  <FormControl><Input type="number" data-testid="input-payment-level-assignment-id" {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" data-testid="button-submit-ballet-payment" disabled={createMutation.isPending}>
                  {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Create Payment
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Refund confirmation — a real backend side effect, not cosmetic */}
      <AlertDialog open={!!refundTarget} onOpenChange={(o) => { if (!o) setRefundTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Refund payment #{refundTarget?.id}?</AlertDialogTitle>
            <AlertDialogDescription>
              Marking this payment as refunded will withdraw the student's ballet enrollment —
              the associated level assignment will be set to "withdrawn". The application and
              its event history are kept, but the child will no longer show as actively enrolled.
              This action cannot be undone from here.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setRefundTarget(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid="button-confirm-refund" onClick={confirmRefund}>
              Confirm Refund
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
