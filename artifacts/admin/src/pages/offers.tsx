import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useListOffers,
  useCreateOffer,
  useUpdateOffer,
  useDeleteOffer,
  getListOffersQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2, Edit } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";

const formSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().nullish(),
  discountPercent: z.coerce.number().int().min(0).max(100),
  validUntil: z.string().nullish(),
  isActive: z.boolean().default(true),
  classIds: z.string(),
});

type FormValues = z.infer<typeof formSchema>;
type Offer = { id: number; title: string; description?: string | null; discountPercent: number; validUntil?: string | null; isActive: boolean; classIds?: number[] };

export default function Offers() {
  const { can } = useAdminAuth();
  const canCreate = can("offers", "create");
  const canEdit = can("offers", "edit");
  const canDelete = can("offers", "delete");
  const { data: offers, isLoading } = useListOffers();
  const createOffer = useCreateOffer();
  const updateOffer = useUpdateOffer();
  const deleteOffer = useDeleteOffer();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Offer | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { title: "", discountPercent: 10, classIds: "", isActive: true },
  });

  const openCreate = () => {
    setEditing(null);
    form.reset({ title: "", description: "", discountPercent: 10, classIds: "", isActive: true });
    setOpen(true);
  };

  const openEdit = (o: Offer) => {
    setEditing(o);
    form.reset({ title: o.title, description: o.description ?? "", discountPercent: o.discountPercent, validUntil: o.validUntil ?? "", classIds: (o.classIds ?? []).join(", "), isActive: o.isActive });
    setOpen(true);
  };

  const onSubmit = (values: FormValues) => {
    const classIds = values.classIds.split(",").map((s) => Number(s.trim())).filter(Boolean);
    const data = { ...values, classIds };
    const invalidate = () => { queryClient.invalidateQueries({ queryKey: getListOffersQueryKey() }); setOpen(false); };
    if (editing) {
      updateOffer.mutate({ id: editing.id, data }, { onSuccess: invalidate });
    } else {
      createOffer.mutate({ data }, { onSuccess: invalidate });
    }
  };

  const handleDelete = (id: number) => {
    if (confirm("Delete this offer?")) {
      deleteOffer.mutate({ id }, { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListOffersQueryKey() }) });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Offers" description="Promotions and discounts" mode="studio" addLabel="Add Offer" addTestId="button-add-offer" onAdd={canCreate ? openCreate : undefined} />

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Discount</TableHead>
              <TableHead>Valid Until</TableHead>
              <TableHead>Classes</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8">Loading...</TableCell></TableRow>
            ) : offers?.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No offers yet.</TableCell></TableRow>
            ) : (
              offers?.map((offer) => (
                <TableRow key={offer.id} data-testid={`row-offer-${offer.id}`}>
                  <TableCell>
                    <div className="font-medium">{offer.title}</div>
                    <div className="text-xs text-muted-foreground line-clamp-1">{offer.description}</div>
                  </TableCell>
                  <TableCell><Badge>{offer.discountPercent}% off</Badge></TableCell>
                  <TableCell>{offer.validUntil ? new Date(offer.validUntil).toLocaleDateString() : "No expiry"}</TableCell>
                  <TableCell>{offer.classIds?.length ? `${offer.classIds.length} class${offer.classIds.length > 1 ? "es" : ""}` : "All"}</TableCell>
                  <TableCell>
                    <Badge variant={offer.isActive ? "default" : "outline"}>{offer.isActive ? "Active" : "Inactive"}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {canEdit && (
                    <Button variant="ghost" size="icon" data-testid={`button-edit-offer-${offer.id}`} onClick={() => openEdit(offer)}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    )}
                    {canDelete && (
                    <Button variant="ghost" size="icon" data-testid={`button-delete-offer-${offer.id}`} onClick={() => handleDelete(offer.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
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
            <DialogTitle>{editing ? "Edit Offer" : "Add Offer"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="title" render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl><Input data-testid="input-offer-title" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="discountPercent" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Discount (%)</FormLabel>
                    <FormControl><Input type="number" data-testid="input-offer-discount" min={0} max={100} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="validUntil" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Valid Until</FormLabel>
                    <FormControl><Input type="date" data-testid="input-offer-valid-until" {...field} value={field.value ?? ""} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="classIds" render={({ field }) => (
                <FormItem>
                  <FormLabel>Class IDs (comma-separated, blank = all)</FormLabel>
                  <FormControl><Input data-testid="input-offer-classids" placeholder="1, 2, 3" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl><Textarea data-testid="input-offer-description" {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="isActive" render={({ field }) => (
                <FormItem className="flex items-center gap-3">
                  <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  <FormLabel className="!mt-0">Active</FormLabel>
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" data-testid="button-submit-offer" disabled={createOffer.isPending || updateOffer.isPending}>
                  {editing ? "Save Changes" : "Create Offer"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
