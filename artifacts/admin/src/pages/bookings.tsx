import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useListBookings,
  useCreateBooking,
  useUpdateBooking,
  getListBookingsQueryKey,
} from "@workspace/api-client-react";
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
import { useQueryClient } from "@tanstack/react-query";
import { Check, Edit, X } from "lucide-react";
import { Link } from "wouter";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";

const BOOKING_STATUSES = ["pending", "confirmed", "rejected", "cancelled", "attended", "completed"];
const PAYMENT_STATUSES = ["not_required", "pending_payment", "paid", "refunded", "failed"];
const FILTERS = ["all", "pending", "confirmed", "rejected", "cancelled", "attended"] as const;
const SCOPE_FILTERS = ["all", "self", "child"] as const;

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
  classTitle?: string | null;
  scheduleLabel?: string | null;
  scheduleType?: "weekly" | "one_time" | null;
  status: string;
  bookingStatus: string;
  paymentStatus: string;
  paymentMode?: string | null;
  bookedAt: string;
  notes?: string | null;
};

const bookingStatusVariant = (s: string) =>
  s === "confirmed" || s === "attended" || s === "completed"
    ? "default"
    : s === "pending"
      ? "secondary"
      : s === "cancelled" || s === "rejected"
        ? "destructive"
        : "outline";

const paymentStatusVariant = (s: string) =>
  s === "paid" || s === "not_required"
    ? "default"
    : s === "pending_payment"
      ? "secondary"
      : s === "refunded"
        ? "outline"
        : "destructive";

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

export default function Bookings() {
  const { can } = useAdminAuth();
  const canCreate = can("bookings", "create");
  const canEdit = can("bookings", "edit");
  const canCancel = can("bookings", "cancel");
  const { data: bookings, isLoading } = useListBookings();
  const createBooking = useCreateBooking();
  const updateBooking = useUpdateBooking();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Booking | null>(null);
  const [activeFilter, setActiveFilter] = useState<(typeof FILTERS)[number]>("all");
  const [scopeFilter, setScopeFilter] = useState<(typeof SCOPE_FILTERS)[number]>("all");
  const [search, setSearch] = useState("");

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

  const visibleBookings = (bookings ?? []).filter((booking) => {
    if (activeFilter !== "all" && (booking.bookingStatus ?? booking.status) !== activeFilter) {
      return false;
    }
    if (scopeFilter !== "all" && (isChildBooking(booking) ? "child" : "self") !== scopeFilter) {
      return false;
    }
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return [
      participantName(booking),
      accountOwnerName(booking),
      accountOwnerEmail(booking),
      booking.studentName,
      booking.studentEmail,
      booking.classTitle ?? "",
    ].some((value) => value.toLowerCase().includes(query));
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Bookings" description="Manage class bookings" mode="studio" addLabel="Add Booking" addTestId="button-add-booking" onAdd={canCreate ? openCreate : undefined} />

      <div className="space-y-3">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search participant, account owner, email, or class"
          className="max-w-md"
          data-testid="input-booking-search"
        />
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((filter) => (
            <Button
              key={filter}
              type="button"
              variant={activeFilter === filter ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveFilter(filter)}
            >
              {filter === "all" ? "All Statuses" : bookingStatusLabel(filter)}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {SCOPE_FILTERS.map((filter) => (
            <Button
              key={filter}
              type="button"
              variant={scopeFilter === filter ? "default" : "outline"}
              size="sm"
              onClick={() => setScopeFilter(filter)}
            >
              {filter === "all" ? "All Scopes" : filter === "child" ? "Child Bookings" : "Self Bookings"}
            </Button>
          ))}
        </div>
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Participant</TableHead>
              <TableHead>Account Owner</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead>Class</TableHead>
              <TableHead>Schedule</TableHead>
              <TableHead>Booked</TableHead>
              <TableHead>Booking Status</TableHead>
              <TableHead>Payment Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={9} className="text-center py-8">Loading...</TableCell></TableRow>
            ) : visibleBookings.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No bookings yet.</TableCell></TableRow>
            ) : (
              visibleBookings.map((booking) => (
                <TableRow key={booking.id} data-testid={`row-booking-${booking.id}`}>
                  <TableCell>
                    <div className="font-medium">{participantName(booking)}</div>
                    <div className="text-xs text-muted-foreground">
                      {isChildBooking(booking) ? "Child attendee" : "Account holder"}
                    </div>
                  </TableCell>
                  <TableCell>
                    {isChildBooking(booking) && booking.accountOwnerStudentId ? (
                      <Link href={`/parents/${booking.accountOwnerStudentId}`} className="font-medium text-[#00B6D7] hover:underline">
                        {accountOwnerName(booking)}
                      </Link>
                    ) : (
                      <div className="font-medium">{accountOwnerName(booking)}</div>
                    )}
                    <div className="text-xs text-muted-foreground">{accountOwnerEmail(booking)}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={isChildBooking(booking) ? "secondary" : "outline"} className={isChildBooking(booking) ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-700" : ""}>
                      {scopeLabel(booking)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{booking.classTitle ?? `Class #${booking.classId ?? "—"}`}</div>
                    <div className="text-xs text-muted-foreground">Booking #{booking.id}</div>
                  </TableCell>
                  <TableCell>
                    <div>{booking.scheduleLabel ?? (booking.scheduleId ? `Schedule #${booking.scheduleId}` : "—")}</div>
                    {booking.scheduleType && (
                      <div className="text-xs text-muted-foreground">
                        {booking.scheduleType === "one_time" ? "One-time" : "Weekly"}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>{new Date(booking.bookedAt).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <Badge variant={bookingStatusVariant(booking.bookingStatus ?? booking.status)}>
                      {bookingStatusLabel(booking.bookingStatus ?? booking.status)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={paymentStatusVariant(booking.paymentStatus ?? "not_required")}>
                      {paymentStatusLabel(booking.paymentStatus ?? "not_required")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {canEdit && (booking.bookingStatus ?? booking.status) === "pending" && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          data-testid={`button-approve-booking-${booking.id}`}
                          onClick={() => setBookingStatus(booking, "confirmed")}
                          title="Approve booking"
                        >
                          <Check className="h-4 w-4 text-emerald-600" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          data-testid={`button-reject-booking-${booking.id}`}
                          onClick={() => setBookingStatus(booking, "rejected")}
                          title="Reject booking"
                        >
                          <X className="h-4 w-4 text-destructive" />
                        </Button>
                      </>
                    )}
                    {canEdit && booking.paymentStatus === "pending_payment" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        data-testid={`button-mark-paid-booking-${booking.id}`}
                        onClick={() => setPaymentStatus(booking, "paid")}
                        title="Mark paid"
                      >
                        <Check className="h-4 w-4 text-sky-600" />
                      </Button>
                    )}
                    {canCancel && !["cancelled", "rejected", "attended", "completed"].includes(booking.bookingStatus ?? booking.status) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        data-testid={`button-cancel-booking-${booking.id}`}
                        onClick={() => setBookingStatus(booking, "cancelled")}
                        title="Cancel booking"
                      >
                        <X className="h-4 w-4 text-orange-600" />
                      </Button>
                    )}
                    {canEdit && (
                      <Button variant="ghost" size="icon" data-testid={`button-edit-booking-${booking.id}`} onClick={() => openEdit(booking)}>
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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Booking" : "New Booking"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
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
              <div className="grid grid-cols-2 gap-4">
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
                      {BOOKING_STATUSES.map((s) => <SelectItem key={s} value={s}>{bookingStatusLabel(s)}</SelectItem>)}
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
    </div>
  );
}
