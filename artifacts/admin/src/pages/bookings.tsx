import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useListBookings,
  useCreateBooking,
  useUpdateBooking,
  useDeleteBooking,
  getListBookingsQueryKey,
} from "@workspace/api-client-react";
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
import { Trash2, Edit } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";

const STATUSES = ["pending", "confirmed", "cancelled", "completed"];

const formSchema = z.object({
  studentName: z.string().min(1, "Name is required"),
  studentEmail: z.string().email("Valid email required"),
  studentPhone: z.string().nullish(),
  classId: z.coerce.number().int().nullish(),
  scheduleId: z.coerce.number().int().nullish(),
  packageId: z.coerce.number().int().nullish(),
  status: z.string().default("pending"),
  notes: z.string().nullish(),
});

type FormValues = z.input<typeof formSchema>;
type Booking = { id: number; studentName: string; studentEmail: string; studentPhone?: string | null; classId?: number | null; status: string; bookedAt: string; notes?: string | null };

const statusVariant = (s: string) =>
  s === "confirmed" ? "default" : s === "pending" ? "secondary" : s === "completed" ? "outline" : "destructive";

export default function Bookings() {
  const { data: bookings, isLoading } = useListBookings();
  const createBooking = useCreateBooking();
  const updateBooking = useUpdateBooking();
  const deleteBooking = useDeleteBooking();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Booking | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { studentName: "", studentEmail: "", status: "pending" },
  });

  const openCreate = () => {
    setEditing(null);
    form.reset({ studentName: "", studentEmail: "", status: "pending" });
    setOpen(true);
  };

  const openEdit = (b: Booking) => {
    setEditing(b);
    form.reset({ studentName: b.studentName, studentEmail: b.studentEmail, studentPhone: b.studentPhone, classId: b.classId ?? undefined, status: b.status, notes: b.notes ?? "" });
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

  const handleDelete = (id: number) => {
    if (confirm("Delete this booking?")) {
      deleteBooking.mutate({ id }, { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListBookingsQueryKey() }) });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Bookings" description="Manage class bookings" mode="studio" addLabel="Add Booking" addTestId="button-add-booking" onAdd={openCreate} />

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Student</TableHead>
              <TableHead>Class ID</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8">Loading...</TableCell></TableRow>
            ) : bookings?.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No bookings yet.</TableCell></TableRow>
            ) : (
              bookings?.map((booking) => (
                <TableRow key={booking.id} data-testid={`row-booking-${booking.id}`}>
                  <TableCell>
                    <div className="font-medium">{booking.studentName}</div>
                    <div className="text-xs text-muted-foreground">{booking.studentEmail}</div>
                  </TableCell>
                  <TableCell>{booking.classId ?? "—"}</TableCell>
                  <TableCell>{new Date(booking.bookedAt).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(booking.status)}>{booking.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" data-testid={`button-edit-booking-${booking.id}`} onClick={() => openEdit(booking)}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" data-testid={`button-delete-booking-${booking.id}`} onClick={() => handleDelete(booking.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
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
                    <FormLabel>Student Name</FormLabel>
                    <FormControl><Input data-testid="input-booking-name" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="studentEmail" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
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
              <FormField control={form.control} name="status" render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger data-testid="select-booking-status"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
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
