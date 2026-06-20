import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useListPricePackages,
  useCreatePricePackage,
  useUpdatePricePackage,
  useDeletePricePackage,
  getListPricePackagesQueryKey,
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2, Edit, Star } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";

const TYPES = ["per_class", "monthly", "term"];

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.string().default("per_class"),
  priceEgp: z.coerce.number().min(0, "Price required"),
  sessions: z.coerce.number().int().nullish(),
  description: z.string().nullish(),
  isActive: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  validityMonths: z.coerce.number().int().min(1).default(6),
  singleClassPriceEgp: z.coerce.number().nullish(),
  allowedDanceTypes: z.string().default(""),
});

type FormValues = z.input<typeof formSchema>;
type Package = { id: number; name: string; type: string; priceEgp: number; sessions?: number | null; description?: string | null; isActive: boolean; isFeatured: boolean; validityMonths: number; singleClassPriceEgp?: number | null; allowedDanceTypes: string[] };

export default function Packages() {
  const { can } = useAdminAuth();
  const canCreate = can("packages", "create");
  const canEdit = can("packages", "edit");
  const canDelete = can("packages", "delete");
  const { data: packages, isLoading } = useListPricePackages();
  const createPackage = useCreatePricePackage();
  const updatePackage = useUpdatePricePackage();
  const deletePackage = useDeletePricePackage();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Package | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", type: "per_class", priceEgp: 0, isActive: true, isFeatured: false, validityMonths: 6, allowedDanceTypes: "" },
  });

  const openCreate = () => {
    setEditing(null);
    form.reset({ name: "", type: "per_class", priceEgp: 0, isActive: true, isFeatured: false, validityMonths: 6, allowedDanceTypes: "" });
    setOpen(true);
  };

  const openEdit = (p: Package) => {
    setEditing(p);
    form.reset({
      name: p.name, type: p.type, priceEgp: p.priceEgp, sessions: p.sessions ?? undefined,
      description: p.description ?? "", isActive: p.isActive, isFeatured: p.isFeatured,
      validityMonths: p.validityMonths, singleClassPriceEgp: p.singleClassPriceEgp ?? undefined,
      allowedDanceTypes: p.allowedDanceTypes.join(", "),
    });
    setOpen(true);
  };

  const onSubmit = (values: FormValues) => {
    const parsed = formSchema.parse(values);
    // Convert comma-separated dance types string to array
    const allowedDanceTypes = parsed.allowedDanceTypes
      ? parsed.allowedDanceTypes.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    const data = { ...parsed, allowedDanceTypes };
    const invalidate = () => { queryClient.invalidateQueries({ queryKey: getListPricePackagesQueryKey() }); setOpen(false); };
    if (editing) {
      updatePackage.mutate({ id: editing.id, data }, { onSuccess: invalidate });
    } else {
      createPackage.mutate({ data }, { onSuccess: invalidate });
    }
  };

  const handleDelete = (id: number) => {
    if (confirm("Delete this package?")) {
      deletePackage.mutate({ id }, { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListPricePackagesQueryKey() }) });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Packages" description="Pricing plans and subscriptions" mode="studio" addLabel="Add Package" addTestId="button-add-package" onAdd={canCreate ? openCreate : undefined} />

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Price (EGP)</TableHead>
              <TableHead>Sessions</TableHead>
              <TableHead>Featured</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8">Loading...</TableCell></TableRow>
            ) : packages?.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No packages yet.</TableCell></TableRow>
            ) : (
              packages?.map((pkg) => (
                <TableRow key={pkg.id} data-testid={`row-package-${pkg.id}`}>
                  <TableCell className="font-medium">{pkg.name}</TableCell>
                  <TableCell className="capitalize">{pkg.type.replace("_", " ")}</TableCell>
                  <TableCell>{pkg.priceEgp.toLocaleString()} EGP</TableCell>
                  <TableCell>{pkg.sessions ?? "Unlimited"}</TableCell>
                  <TableCell>{pkg.isFeatured ? <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" /> : "—"}</TableCell>
                  <TableCell>
                    <Badge variant={pkg.isActive ? "default" : "outline"}>{pkg.isActive ? "Active" : "Inactive"}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {canEdit && (
                      <Button variant="ghost" size="icon" data-testid={`button-edit-package-${pkg.id}`} onClick={() => openEdit(pkg)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                    )}
                    {canDelete && (
                      <Button variant="ghost" size="icon" data-testid={`button-delete-package-${pkg.id}`} onClick={() => handleDelete(pkg.id)}>
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
            <DialogTitle>{editing ? "Edit Package" : "Add Package"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Package Name</FormLabel>
                  <FormControl><Input data-testid="input-package-name" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="type" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger data-testid="select-package-type"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace("_", " ")}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="priceEgp" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Price (EGP)</FormLabel>
                    <FormControl><Input type="number" data-testid="input-package-price" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="sessions" render={({ field }) => (
                <FormItem>
                  <FormLabel>Sessions (leave blank for unlimited)</FormLabel>
                  <FormControl><Input type="number" data-testid="input-package-sessions" {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl><Textarea data-testid="input-package-description" {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="validityMonths" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Validity (months)</FormLabel>
                    <FormControl><Input type="number" min={1} data-testid="input-package-validity" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="singleClassPriceEgp" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Per-class price (EGP, optional)</FormLabel>
                    <FormControl><Input type="number" min={0} placeholder="Auto-calculated" data-testid="input-package-class-price" {...field} value={field.value ?? ""} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="allowedDanceTypes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Allowed dance types (comma-separated, blank = all)</FormLabel>
                  <FormControl><Input placeholder="e.g. Hip Hop, Ballet, Jazz" data-testid="input-package-dance-types" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="flex gap-6">
                <FormField control={form.control} name="isActive" render={({ field }) => (
                  <FormItem className="flex items-center gap-3">
                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                    <FormLabel className="!mt-0">Active</FormLabel>
                  </FormItem>
                )} />
                <FormField control={form.control} name="isFeatured" render={({ field }) => (
                  <FormItem className="flex items-center gap-3">
                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                    <FormLabel className="!mt-0">Featured</FormLabel>
                  </FormItem>
                )} />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" data-testid="button-submit-package" disabled={createPackage.isPending || updatePackage.isPending}>
                  {editing ? "Save Changes" : "Create Package"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
