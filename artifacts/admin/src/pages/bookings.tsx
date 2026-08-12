import { useEffect, useState } from "react";
import { useSearch } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useListBookings,
  useCreateBooking,
  useUpdateBooking,
  getListBookingsQueryKey,
} from "@workspace/api-client-react";
import type { UpdateBookingBody } from "@workspace/api-client-react";

// `confirmedPaymentMethod` is accepted by PATCH /bookings/:id on the server
// (artifacts/api-server/src/routes/bookings.ts) but the generated
// UpdateBookingBody type hasn't been regenerated to include it yet — extend
// it locally rather than widening the whole request body to `any`.
type UpdateBookingBodyWithPaymentMethod = UpdateBookingBody & {
  confirmedPaymentMethod?: "cash" | "card" | "kashier" | "bank_transfer" | "unknown";
};
import { useAdminAuth } from "@/contexts/AdminAuthContext";
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
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Check, Clock3, CreditCard, Edit, MoreHorizontal, PersonStanding, Plus, Search, UserRound, X } from "lucide-react";
import { Link } from "wouter";
import "./admin2-operations.css";

const BOOKING_STATUSES = ["pending", "confirmed", "rejected", "cancelled", "attended", "completed"];
const PAYMENT_STATUSES = ["not_required", "pending_payment", "paid", "refunded", "failed"];
const CONFIRMED_PAYMENT_METHODS = ["cash", "card", "kashier", "bank_transfer", "unknown"] as const;
type ConfirmedPaymentMethod = (typeof CONFIRMED_PAYMENT_METHODS)[number];
const CONFIRMED_PAYMENT_METHOD_LABELS: Record<ConfirmedPaymentMethod, string> = {
  cash: "Cash",
  card: "Card",
  kashier: "Kashier",
  bank_transfer: "Bank Transfer",
  unknown: "Unknown",
};
const FILTERS = ["all", "pending", "confirmed", "rejected", "cancelled", "attended"] as const;
const SCOPE_FILTERS = ["all", "self", "child"] as const;
const PAGE_SIZE = 50;
const API_BASE = import.meta.env.VITE_API_URL as string | undefined ?? "";
const API_KEY = import.meta.env.VITE_API_KEY as string | undefined ?? "";

const formSchema = z.object({
  studentName: z.string().min(1, "Name is required"),
  studentEmail: z.string().email("Valid email required"),
  studentPhone: z.string().nullish(),
  classId: z.coerce.number().int().nullish(),
  scheduleId: z.coerce.number().int().nullish(),
  packageId: z.coerce.number().int().nullish(),
  status: z.string().default("pending"),
  bookingStatus: z.string().default("pending"),
  paymentStatus: z.string().default("pending_payment"),
  paymentMode: z.string().nullish(),
  notes: z.string().nullish(),
});

type FormValues = z.input<typeof formSchema>;
type Booking = {
  id: number;
  studentName: string;
  studentEmail: string;
  studentPhone?: string | null;
  accountOwnerStudentId?: number | null;
  accountOwnerName?: string | null;
  accountOwnerEmail?: string | null;
  participantChildId?: number | null;
  participantName?: string | null;
  participantType?: "self" | "child" | null;
  bookingScope?: "self" | "child" | null;
  classId?: number | null;
  scheduleId?: number | null;
  packageOrderId?: number | null;
  classTitle?: string | null;
  scheduleLabel?: string | null;
  scheduleType?: "weekly" | "one_time" | null;
  schedulePriceEgp?: number | null;
  status: string;
  bookingStatus: string;
  paymentStatus: string;
  paymentMode?: string | null;
  bookedAt: string;
  notes?: string | null;
};

const bookingStatusLabel = (s: string) => {
  const labels: Record<string, string> = {
    pending: "Pending",
    confirmed: "Confirmed",
    rejected: "Rejected",
    cancelled: "Cancelled",
    attended: "Attended",
    completed: "Completed",
  };
  return labels[s] ?? s;
};

const paymentStatusLabel = (s: string) => {
  const labels: Record<string, string> = {
    not_required: "Not Required",
    pending_payment: "Pending Payment",
    paid: "Paid",
    refunded: "Refunded",
    failed: "Failed",
  };
  return labels[s] ?? s;
};

const participantName = (booking: Booking) => booking.participantName || booking.studentName;
const accountOwnerName = (booking: Booking) => booking.accountOwnerName || booking.studentName;
const accountOwnerEmail = (booking: Booking) => booking.accountOwnerEmail || booking.studentEmail;
const isChildBooking = (booking: Booking) =>
  booking.bookingScope === "child" || booking.participantType === "child" || booking.participantChildId != null;
const scopeLabel = (booking: Booking) => (isChildBooking(booking) ? "Child" : "Self");
const initialsFor = (name: string) => {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return initials || "?";
};

const bookingStatusPillClass = (status: string) => {
  if (status === "pending") return "border-amber-500/60 bg-amber-500/10 text-amber-400";
  if (status === "confirmed" || status === "attended" || status === "completed") return "border-emerald-500/50 bg-emerald-500/10 text-emerald-400";
  if (status === "cancelled" || status === "rejected") return "border-red-500/50 bg-red-500/10 text-red-400";
  return "border-slate-500/50 bg-slate-500/10 text-muted-foreground";
};

const paymentStatusPillClass = (status: string) => {
  if (status === "pending_payment") return "border-blue-500/60 bg-blue-500/10 text-blue-400";
  if (status === "paid" || status === "not_required") return "border-emerald-500/50 bg-emerald-500/10 text-emerald-400";
  if (status === "failed") return "border-red-500/50 bg-red-500/10 text-red-400";
  return "border-slate-500/50 bg-slate-500/10 text-muted-foreground";
};

export default function Bookings() {
  const { can, token } = useAdminAuth();
  const canCreate = can("bookings", "create");
  const canEdit = can("bookings", "edit");
  const canCancel = can("bookings", "cancel");
  // Finance Roles & Permissions integration: confirming a Pay-at-Studio
  // booking payment requires finance.paymentsConfirm in addition to the
  // existing bookings.edit permission, even though this button lives on
  // the Bookings page rather than Finance. Backend enforces the same
  // permission independently.
  const canConfirmPayments = can("finance", "paymentsConfirm");
  const [activeFilter, setActiveFilter] = useState<(typeof FILTERS)[number]>("all");
  const [scopeFilter, setScopeFilter] = useState<(typeof SCOPE_FILTERS)[number]>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const urlSearch = useSearch();
  // Deep-link support: /bookings?studentEmail=x@y.com pre-filters to one
  // student (used by the "View all bookings" link on the admin 360 profile page).
  const [studentEmailFilter, setStudentEmailFilter] = useState<string | null>(null);
  const [scheduleIdFilter, setScheduleIdFilter] = useState<number | null>(null);
  const [dateFilter, setDateFilter] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(urlSearch);
    const email = params.get("studentEmail");
    if (email) setStudentEmailFilter(email);

    const schedId = params.get("scheduleId");
    if (schedId && /^\d+$/.test(schedId)) setScheduleIdFilter(Number(schedId));

    const dt = params.get("date");
    if (dt && /^\d{4}-\d{2}-\d{2}$/.test(dt)) setDateFilter(dt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const listParams = {
    page,
    pageSize: PAGE_SIZE,
    ...(activeFilter !== "all" ? { bookingStatus: activeFilter } : {}),
    ...(scopeFilter !== "all" ? { scope: scopeFilter } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(studentEmailFilter ? { studentEmail: studentEmailFilter } : {}),
    ...(scheduleIdFilter != null ? { scheduleId: scheduleIdFilter } : {}),
    ...(dateFilter ? { date: dateFilter } : {}),
  };
  const { data: bookingsResponse, isLoading, isError } = useListBookings(listParams);
  const bookings = (bookingsResponse?.bookings ?? []) as Booking[];
  const total = bookingsResponse?.total ?? 0;
  const totalPages = bookingsResponse?.totalPages ?? 0;
  const currentPage = bookingsResponse?.page ?? page;
  const pageSize = bookingsResponse?.pageSize ?? PAGE_SIZE;
  const startItem = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endItem = total === 0 ? 0 : Math.min(currentPage * pageSize, total);
  const createBooking = useCreateBooking();
  const updateBooking = useUpdateBooking();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Booking | null>(null);
  const [statusConfirm, setStatusConfirm] = useState<{ booking: Booking; status: "confirmed" | "rejected" | "cancelled" } | null>(null);
  const [paymentConfirm, setPaymentConfirm] = useState<{ booking: Booking; status: "paid" | "failed" } | null>(null);
  const [confirmedPaymentMethod, setConfirmedPaymentMethod] = useState<ConfirmedPaymentMethod | "">("");
  const [paymentConfirmSubmitLock, setPaymentConfirmSubmitLock] = useState(false);
  const [paymentConfirmError, setPaymentConfirmError] = useState("");
  const [paymentActionAmount, setPaymentActionAmount] = useState<number | null>(null);
  const [paymentActionAmountLoading, setPaymentActionAmountLoading] = useState(false);

  useEffect(() => {
    if (!paymentConfirm || paymentConfirm.status !== "paid") {
      setPaymentActionAmount(null);
      setPaymentActionAmountLoading(false);
      return;
    }
    const controller = new AbortController();
    setPaymentActionAmount(null);
    setPaymentActionAmountLoading(true);
    void fetch(`${API_BASE}/api/bookings/${paymentConfirm.booking.id}/payment-confirmation-amount`, {
      headers: {
        ...(API_KEY ? { "x-api-key": API_KEY } : {}),
        ...(token ? { "x-admin-token": token } : {}),
      },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load the authorized payment amount.");
        return response.json() as Promise<{ amountEgp: number | null }>;
      })
      .then((body) => setPaymentActionAmount(body.amountEgp))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setPaymentConfirmError(error instanceof Error ? error.message : "Could not load the authorized payment amount.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setPaymentActionAmountLoading(false);
      });
    return () => controller.abort();
  }, [paymentConfirm, token]);

  useEffect(() => {
    setPage(1);
  }, [activeFilter, scopeFilter, search]);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { studentName: "", studentEmail: "", bookingStatus: "pending", paymentStatus: "pending_payment" },
  });

  const openCreate = () => {
    setEditing(null);
    form.reset({ studentName: "", studentEmail: "", bookingStatus: "pending", paymentStatus: "pending_payment" });
    setOpen(true);
  };

  const openEdit = (b: Booking) => {
    setEditing(b);
    form.reset({
      studentName: b.studentName,
      studentEmail: b.studentEmail,
      studentPhone: b.studentPhone,
      classId: b.classId ?? undefined,
      scheduleId: b.scheduleId ?? undefined,
      bookingStatus: b.bookingStatus ?? b.status,
      paymentStatus: b.paymentStatus ?? "not_required",
      paymentMode: b.paymentMode ?? undefined,
      notes: b.notes ?? "",
    });
    setOpen(true);
  };

  const onSubmit = (values: FormValues) => {
    const parsed = formSchema.parse(values);
    const invalidate = () => { queryClient.invalidateQueries({ queryKey: getListBookingsQueryKey() }); setOpen(false); };
    if (editing) {
      updateBooking.mutate({ id: editing.id, data: parsed }, { onSuccess: invalidate });
    } else {
      createBooking.mutate({ data: parsed }, { onSuccess: invalidate });
    }
  };

  const invalidateBookings = () => {
    queryClient.invalidateQueries({ queryKey: getListBookingsQueryKey() });
  };

  const setBookingStatus = (booking: Booking, bookingStatus: string) => {
    updateBooking.mutate(
      { id: booking.id, data: { bookingStatus } },
      { onSuccess: invalidateBookings },
    );
  };

  const setPaymentStatus = (booking: Booking, paymentStatus: string) => {
    updateBooking.mutate(
      { id: booking.id, data: { paymentStatus } },
      { onSuccess: invalidateBookings },
    );
  };

  const confirmStatusChange = () => {
    if (!statusConfirm) return;
    setBookingStatus(statusConfirm.booking, statusConfirm.status);
    setStatusConfirm(null);
  };

  const confirmPaymentChange = () => {
    if (!paymentConfirm || paymentConfirmSubmitLock) return;
    if (paymentConfirm.status === "paid" && !confirmedPaymentMethod) return;
    setPaymentConfirmSubmitLock(true);
    setPaymentConfirmError("");
    const data: UpdateBookingBodyWithPaymentMethod = {
      paymentStatus: paymentConfirm.status,
      ...(paymentConfirm.status === "paid" ? { confirmedPaymentMethod: confirmedPaymentMethod || undefined } : {}),
    };
    updateBooking.mutate(
      { id: paymentConfirm.booking.id, data },
      {
        onSuccess: () => {
          invalidateBookings();
          setPaymentConfirm(null);
          setConfirmedPaymentMethod("");
          setPaymentConfirmSubmitLock(false);
        },
        onError: (err: unknown) => {
          const data = err !== null && typeof err === "object" && "data" in err ? (err as { data?: { message?: string; error?: string } }).data : null;
          setPaymentConfirmError(data?.message ?? data?.error ?? "Could not update payment status — please try again.");
          setPaymentConfirmSubmitLock(false);
        },
      },
    );
  };

  const paginationPages = (() => {
    if (totalPages <= 0) return [];
    const pages = new Set<number>([1, totalPages]);
    for (let p = currentPage - 2; p <= currentPage + 2; p += 1) {
      if (p >= 1 && p <= totalPages) pages.add(p);
    }
    return Array.from(pages).sort((a, b) => a - b);
  })();

  return (
    <div className="admin2-ops-page admin2-bookings">
      <div className="admin2-command-bar admin2-bookings-command">
        <label className="admin2-bookings-search">
          <span className="sr-only">Search bookings</span>
          <Search aria-hidden="true" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search participant, account owner, email, or class"
            data-testid="input-booking-search"
          />
        </label>
        <div className="admin2-bookings-filter-group" aria-label="Booking status filters">
          <span>Status</span>
          <div className="admin2-filter-pills">
            {FILTERS.map((filter) => (
              <Button key={filter} type="button" variant={activeFilter === filter ? "default" : "outline"} size="compact" aria-pressed={activeFilter === filter} onClick={() => setActiveFilter(filter)}>
                {filter === "all" ? "All" : bookingStatusLabel(filter)}
              </Button>
            ))}
          </div>
        </div>
        <div className="admin2-bookings-filter-group" aria-label="Participant scope filters">
          <span>Scope</span>
          <div className="admin2-filter-pills">
            {SCOPE_FILTERS.map((filter) => (
              <Button key={filter} type="button" variant={scopeFilter === filter ? "default" : "outline"} size="compact" aria-pressed={scopeFilter === filter} onClick={() => setScopeFilter(filter)}>
                {filter === "all" ? "All" : filter === "child" ? "Child" : "Self"}
              </Button>
            ))}
          </div>
        </div>
        {studentEmailFilter && <div className="admin2-bookings-deep-filter"><Badge variant="secondary">{studentEmailFilter}</Badge><Button type="button" variant="ghost" size="compact" onClick={() => setStudentEmailFilter(null)}>Clear</Button></div>}
        {canCreate && <Button type="button" onClick={openCreate} data-testid="button-add-booking" className="admin2-bookings-add"><Plus />Add Booking</Button>}
      </div>

      <div className="admin2-queue-surface">
        <Table>
          <TableHeader>
            <TableRow className="border-border bg-muted/30 hover:bg-muted/30">
              <TableHead className="h-10 text-xs font-semibold text-muted-foreground">Participant</TableHead>
              <TableHead className="h-10 text-xs font-semibold text-muted-foreground">Account Owner</TableHead>
              <TableHead className="h-10 text-xs font-semibold text-muted-foreground">Scope</TableHead>
              <TableHead className="h-10 text-xs font-semibold text-muted-foreground">Class</TableHead>
              <TableHead className="h-10 text-xs font-semibold text-muted-foreground">Schedule</TableHead>
              <TableHead className="h-10 text-xs font-semibold text-muted-foreground">Booked</TableHead>
              <TableHead className="h-10 text-xs font-semibold text-muted-foreground">Booking Status</TableHead>
              <TableHead className="h-10 text-xs font-semibold text-muted-foreground">Payment Status</TableHead>
              <TableHead className="h-12 text-right text-xs font-semibold text-muted-foreground">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={9} className="text-center py-8">Loading...</TableCell></TableRow>
            ) : isError ? (
              <TableRow><TableCell colSpan={9} className="text-center py-8 text-destructive">Bookings could not be loaded. Try again in a moment.</TableCell></TableRow>
            ) : bookings.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No bookings yet.</TableCell></TableRow>
            ) : (
              bookings.map((booking) => {
                const canShowBookingActions = canEdit && (booking.bookingStatus ?? booking.status) === "pending";
                const canShowCancelAction = canCancel && !["cancelled", "rejected", "attended", "completed"].includes(booking.bookingStatus ?? booking.status);
                const canShowPaymentActions = canEdit && canConfirmPayments && booking.paymentStatus === "pending_payment";
                const bookingStatus = booking.bookingStatus ?? booking.status;
                const paymentStatus = booking.paymentStatus ?? "not_required";
                const BookingStatusIcon = bookingStatus === "pending" ? Clock3 : bookingStatus === "confirmed" || bookingStatus === "attended" || bookingStatus === "completed" ? Check : X;
                const PaymentStatusIcon = paymentStatus === "pending_payment" ? Clock3 : paymentStatus === "paid" || paymentStatus === "not_required" ? Check : X;

                return (
                    <TableRow key={booking.id} data-testid={`row-booking-${booking.id}`} className="bg-card hover:bg-muted/20">
                      <TableCell className="py-3">
                        <div className="flex items-center gap-2 border-r border-border/70 pr-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-violet-300/40 bg-gradient-to-br from-violet-500/80 to-slate-700 text-xs font-semibold text-white shadow-[0_0_24px_rgba(139,92,246,0.18)]">
                            {initialsFor(participantName(booking))}
                          </div>
                          <div>
                            <div className="font-semibold text-foreground">{participantName(booking)}</div>
                            <div className="text-[11px] text-muted-foreground">
                              {isChildBooking(booking) ? "Child attendee" : "Account holder"}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="py-3">
                        <div className="border-r border-border/70 pr-3">
                          {isChildBooking(booking) && booking.accountOwnerStudentId ? (
                            <Link href={`/parents/${booking.accountOwnerStudentId}`} className="font-semibold text-foreground hover:text-[#00B6D7] hover:underline">
                              {accountOwnerName(booking)}
                            </Link>
                          ) : (
                            <div className="font-semibold text-foreground">{accountOwnerName(booking)}</div>
                          )}
                          <div className="max-w-[170px] break-words text-[11px] text-muted-foreground">{accountOwnerEmail(booking)}</div>
                        </div>
                      </TableCell>
                      <TableCell className="py-3">
                        <div className="flex border-r border-border/70 pr-3">
                          <span className="inline-flex min-w-[72px] items-center justify-center gap-2 rounded-md border border-cyan-500/50 bg-cyan-500/10 px-2 py-1 text-[11px] font-semibold text-foreground">
                            <UserRound className="h-3.5 w-3.5 text-cyan-400" />
                            {scopeLabel(booking)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="py-3">
                        <div className="flex items-center gap-2 border-r border-border/70 pr-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-cyan-400/30 bg-cyan-500/15 text-cyan-300 shadow-[0_0_24px_rgba(0,182,215,0.16)]">
                            <PersonStanding className="h-4 w-4" />
                          </div>
                          <div>
                            <div className="font-semibold text-foreground">{booking.classTitle ?? `Class #${booking.classId ?? "—"}`}</div>
                            <div className="text-[11px] text-muted-foreground">Booking #{booking.id}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="py-3">
                        <div className="border-r border-border/70 pr-3">
                          <div className="flex items-start gap-2 text-foreground">
                            <CalendarDays className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <div>
                              <div className="font-medium">{booking.scheduleLabel ?? (booking.scheduleId ? `Schedule #${booking.scheduleId}` : "—")}</div>
                              {booking.scheduleType && (
                                <div className="mt-1 inline-flex rounded-md bg-blue-500/15 px-2 py-1 text-xs font-medium text-blue-300">
                                  {booking.scheduleType === "one_time" ? "One-time" : "Weekly"}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="py-3">
                        <div className="flex items-center gap-2 border-r border-border/70 pr-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-600/60 bg-slate-700/40 text-blue-400">
                            <CalendarDays className="h-3.5 w-3.5" />
                          </div>
                          <span className="font-medium text-foreground">{new Date(booking.bookedAt).toLocaleDateString()}</span>
                        </div>
                      </TableCell>
                      <TableCell className="py-3">
                        <div className="border-r border-border/70 pr-3 text-center">
                          <span className={`inline-flex min-w-[82px] items-center justify-center gap-2 rounded-md border px-2 py-1 text-[11px] font-semibold ${bookingStatusPillClass(bookingStatus)}`}>
                            <BookingStatusIcon className="h-3.5 w-3.5" />
                            {bookingStatusLabel(bookingStatus)}
                          </span>
                          <div className="mt-0.5 text-[11px] text-muted-foreground">Booking</div>
                        </div>
                      </TableCell>
                      <TableCell className="py-3">
                        <div className="border-r border-border/70 pr-3 text-center">
                          <span className={`inline-flex min-w-[112px] items-center justify-center gap-2 rounded-md border px-2 py-1 text-[11px] font-semibold ${paymentStatusPillClass(paymentStatus)}`}>
                            <PaymentStatusIcon className="h-3.5 w-3.5" />
                            {paymentStatusLabel(paymentStatus)}
                          </span>
                          <div className="mt-0.5 text-[11px] text-muted-foreground">Payment</div>
                          {booking.packageOrderId != null && (
                            <div className="mt-1 text-[10px] text-muted-foreground">
                              Package order #{booking.packageOrderId}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-3 text-right">
                        {/* Production hotfix: a "pending" booking used to show up to
                            6 simultaneous buttons (Edit/Confirm/Reject/Cancel/Paid/
                            Payment failed). Only Edit + the single clearest next step
                            (Confirm) stay directly visible; everything else — the
                            destructive and payment-outcome actions — moves into one
                            canonical Admin 2.0 dropdown (design-lab reference pattern),
                            same mutations/dialogs/confirmations, just consolidated. */}
                        <div className="admin2-booking-row-actions">
                          {canEdit && <Button variant="ghost" size="iconSm" aria-label={`Edit booking ${booking.id}`} data-testid={`button-edit-booking-${booking.id}`} onClick={() => openEdit(booking)} title="Edit booking"><Edit /></Button>}
                          {canShowBookingActions && (
                            <Button variant="secondary" size="compact" data-testid={`button-approve-booking-${booking.id}`} onClick={() => setStatusConfirm({ booking, status: "confirmed" })} title="Confirm booking"><Check />Confirm</Button>
                          )}
                          {(canShowBookingActions || canShowCancelAction || canShowPaymentActions) && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="iconSm" aria-label={`More actions for booking ${booking.id}`} data-testid={`button-more-booking-${booking.id}`}>
                                  <MoreHorizontal />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {canShowPaymentActions && (
                                  <>
                                    <DropdownMenuItem data-testid={`button-confirm-payment-booking-${booking.id}`} onClick={() => setPaymentConfirm({ booking, status: "paid" })}>
                                      <CreditCard /> Mark Paid
                                    </DropdownMenuItem>
                                    <DropdownMenuItem data-testid={`button-reject-payment-booking-${booking.id}`} onClick={() => setPaymentConfirm({ booking, status: "failed" })}>
                                      <X /> Payment Failed
                                    </DropdownMenuItem>
                                  </>
                                )}
                                {(canShowBookingActions || canShowCancelAction) && (canShowPaymentActions) && <DropdownMenuSeparator />}
                                {canShowBookingActions && (
                                  <DropdownMenuItem
                                    data-testid={`button-reject-booking-${booking.id}`}
                                    className="text-destructive focus:text-destructive"
                                    onClick={() => setStatusConfirm({ booking, status: "rejected" })}
                                  >
                                    <X /> Reject
                                  </DropdownMenuItem>
                                )}
                                {canShowCancelAction && (
                                  <DropdownMenuItem
                                    data-testid={`button-cancel-booking-${booking.id}`}
                                    className="text-destructive focus:text-destructive"
                                    onClick={() => setStatusConfirm({ booking, status: "cancelled" })}
                                  >
                                    <X /> Cancel
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="admin2-queue-pagination flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-[11px] text-muted-foreground">
          Showing {startItem}–{endItem} of {total.toLocaleString()} bookings
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
                    <span className="px-1 text-[11px] text-muted-foreground">...</span>
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
        <DialogContent className="admin2-ops-dialog max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Booking" : "New Booking"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <FormField control={form.control} name="studentName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Participant Name</FormLabel>
                    <FormControl><Input data-testid="input-booking-name" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="studentEmail" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account Owner Email</FormLabel>
                    <FormControl><Input type="email" data-testid="input-booking-email" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <FormField control={form.control} name="studentPhone" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl><Input data-testid="input-booking-phone" {...field} value={field.value ?? ""} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="classId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Class ID</FormLabel>
                    <FormControl><Input type="number" data-testid="input-booking-classid" {...field} value={field.value ?? ""} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="scheduleId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Schedule ID</FormLabel>
                  <FormControl><Input type="number" data-testid="input-booking-scheduleid" {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="bookingStatus" render={({ field }) => (
                <FormItem>
                  <FormLabel>Booking Status</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger data-testid="select-booking-status"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {/* "attended"/"completed" are produced only by the check-in
                          flow (which also records attendance + credit), never set
                          manually here — the backend rejects such transitions. */}
                      {BOOKING_STATUSES
                        .filter((s) => s !== "attended" && s !== "completed")
                        .map((s) => <SelectItem key={s} value={s}>{bookingStatusLabel(s)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="paymentStatus" render={({ field }) => (
                <FormItem>
                  <FormLabel>Payment Status</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger data-testid="select-payment-status"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {PAYMENT_STATUSES.map((s) => <SelectItem key={s} value={s}>{paymentStatusLabel(s)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl><Textarea data-testid="input-booking-notes" {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" data-testid="button-submit-booking" disabled={createBooking.isPending || updateBooking.isPending}>
                  {editing ? "Save Changes" : "Create Booking"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={statusConfirm != null} onOpenChange={(next) => !next && setStatusConfirm(null)}>
        <DialogContent className="admin2-ops-dialog max-w-md">
          <DialogHeader>
            <DialogTitle>
              {statusConfirm?.status === "confirmed" ? "Confirm Booking" : statusConfirm?.status === "rejected" ? "Reject Booking" : "Cancel Booking"}
            </DialogTitle>
          </DialogHeader>
          {statusConfirm && (
            <div className="space-y-4">
              <div className="rounded-md border bg-muted/30 p-4 text-sm">
                <div className="grid grid-cols-[96px_1fr] gap-y-2">
                  <span className="text-muted-foreground">Participant:</span>
                  <span className="font-medium">{participantName(statusConfirm.booking)}</span>
                  <span className="text-muted-foreground">Class:</span>
                  <span className="font-medium">{statusConfirm.booking.classTitle ?? `Class #${statusConfirm.booking.classId ?? "—"}`}</span>
                  <span className="text-muted-foreground">Schedule:</span>
                  <span className="font-medium">{statusConfirm.booking.scheduleLabel ?? (statusConfirm.booking.scheduleId ? `Schedule #${statusConfirm.booking.scheduleId}` : "—")}</span>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Are you sure you want to {statusConfirm.status === "confirmed" ? "confirm" : statusConfirm.status === "rejected" ? "reject" : "cancel"} this booking?
              </p>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setStatusConfirm(null)}>Back</Button>
                <Button
                  type="button"
                  variant={statusConfirm.status === "confirmed" ? "default" : "destructive"}
                  onClick={confirmStatusChange}
                  disabled={updateBooking.isPending}
                >
                  {statusConfirm.status === "confirmed" ? "Confirm Booking" : statusConfirm.status === "rejected" ? "Reject Booking" : "Cancel Booking"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={paymentConfirm != null}
        onOpenChange={(next) => {
          if (!next) {
            setPaymentConfirm(null);
            setConfirmedPaymentMethod("");
            setPaymentConfirmError("");
          }
        }}
      >
        <DialogContent className="admin2-ops-dialog max-w-md">
          <DialogHeader>
            <DialogTitle>
              {paymentConfirm?.status === "paid" ? "Confirm Payment" : "Reject Payment"}
            </DialogTitle>
          </DialogHeader>
          {paymentConfirm && (
            <div className="space-y-4">
              <div className="rounded-md border bg-muted/30 p-4 text-sm">
                <div className="grid grid-cols-[96px_1fr] gap-y-2">
                  <span className="text-muted-foreground">Participant:</span>
                  <span className="font-medium">{participantName(paymentConfirm.booking)}</span>
                  <span className="text-muted-foreground">Amount:</span>
                  <span className="font-medium">
                    {paymentConfirm.status !== "paid"
                      ? "Not applicable"
                      : paymentActionAmountLoading
                        ? "Loading…"
                        : paymentActionAmount == null
                          ? "Amount unavailable"
                          : `EGP ${paymentActionAmount.toLocaleString()}`}
                  </span>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Are you sure you want to {paymentConfirm.status === "paid" ? "confirm" : "reject"} this payment?
              </p>
              {paymentConfirm.status === "paid" && (
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Payment Method
                  </label>
                  <Select
                    value={confirmedPaymentMethod}
                    onValueChange={(v) => setConfirmedPaymentMethod(v as ConfirmedPaymentMethod)}
                  >
                    <SelectTrigger data-testid="select-confirmed-payment-method">
                      <SelectValue placeholder="Select payment method…" />
                    </SelectTrigger>
                    <SelectContent>
                      {CONFIRMED_PAYMENT_METHODS.map((m) => (
                        <SelectItem key={m} value={m}>{CONFIRMED_PAYMENT_METHOD_LABELS[m]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {paymentConfirmError && (
                <p className="text-xs text-destructive">{paymentConfirmError}</p>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setPaymentConfirm(null)}>Cancel</Button>
                <Button
                  type="button"
                  variant={paymentConfirm.status === "failed" ? "destructive" : "default"}
                  onClick={confirmPaymentChange}
                  disabled={paymentConfirmSubmitLock || (paymentConfirm.status === "paid" && (!confirmedPaymentMethod || paymentActionAmountLoading || paymentActionAmount == null))}
                >
                  {paymentConfirmSubmitLock ? "Saving…" : paymentConfirm.status === "paid" ? "Confirm Payment" : "Reject Payment"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
