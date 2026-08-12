import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useListPricePackages,
  useCreatePricePackage,
  useUpdatePricePackage,
  useDeletePricePackage,
  getListPricePackagesQueryKey,
  normalizeMediaUrl,
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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, Edit, Star } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { useAdminConfirm } from "@/components/admin/admin-confirm";
import { Badge } from "@/components/ui/badge";
import { deriveAgeRangeLabel } from "@workspace/api-zod";
import "./admin2-studio.css";

const TYPES = ["per_class", "monthly", "term"];
const AGE_PRESETS = ["all", "kids", "teens", "adults", "custom"] as const;
const API = import.meta.env.VITE_API_URL ?? "";
const API_KEY = (import.meta.env.VITE_API_KEY as string | undefined) ?? "";

const DESC_MAX = 160;
const FEATURE_MAX = 48;

const nullableAge = z.preprocess(
  (value) => value === "" || value == null ? null : Number(value),
  z.number().int().min(0, "Age must be 0 or above").max(150, "Age must be 150 or below").nullable(),
);

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.string().default("per_class"),
  priceEgp: z.coerce.number().min(0, "Price required"),
  sessions: z.coerce.number().int().nullish(),
  description: z.string().max(DESC_MAX, `Keep it under ${DESC_MAX} characters`).nullish(),
  isActive: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  validityMonths: z.coerce.number().int().min(1).default(6),
  singleClassPriceEgp: z.coerce.number().nullish(),
  allowedDanceTypeIds: z.array(z.number().int().positive()).default([]),
  allowAllAges: z.boolean(),
  minAge: nullableAge,
  maxAge: nullableAge,
  // Up to 3 short feature bullets shown on the package card.
  feature1: z.string().max(FEATURE_MAX, `Max ${FEATURE_MAX} characters`).default(""),
  feature2: z.string().max(FEATURE_MAX, `Max ${FEATURE_MAX} characters`).default(""),
  feature3: z.string().max(FEATURE_MAX, `Max ${FEATURE_MAX} characters`).default(""),
  // Admin-controlled artwork — Home card background + details sheet hero.
  // Blank clears the field (server normalizes/validates on save).
  cardImageUrl: z.string().nullish(),
  detailsImageUrl: z.string().nullish(),
}).superRefine((value, ctx) => {
  if (!value.allowAllAges && value.minAge == null) {
    ctx.addIssue({ code: "custom", path: ["minAge"], message: "Minimum age is required." });
  }
  if (value.minAge != null && value.maxAge != null && value.minAge > value.maxAge) {
    ctx.addIssue({ code: "custom", path: ["maxAge"], message: "Maximum age cannot be below minimum age." });
  }
});

type FormValues = z.output<typeof formSchema>;
type Package = {
  id: number; name: string; type: string; priceEgp: number; sessions?: number | null;
  description?: string | null; isActive: boolean; isFeatured: boolean; validityMonths: number;
  singleClassPriceEgp?: number | null; allowedDanceTypes: string[]; allowedDanceTypeIds: number[];
  features?: string[]; allowAllAges: boolean | null; minAge: number | null; maxAge: number | null;
  ageRangeLabel: string; configurationState: "configured" | "legacy_unconfigured";
  cardImageUrl?: string | null; detailsImageUrl?: string | null;
};

function ImageUrlPreview({ url, label }: { url?: string | null; label: string }) {
  const [failed, setFailed] = useState(false);
  const normalized = normalizeMediaUrl(url, "image");
  useEffect(() => setFailed(false), [normalized]);
  if (!normalized || failed) {
    return (
      <div className="flex h-28 w-full items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
        {url?.trim() && failed ? "Preview failed. Check that the image is public." : `No ${label.toLowerCase()} set.`}
      </div>
    );
  }
  return (
    <img
      src={normalized}
      alt={label}
      className="h-28 w-full rounded-md border object-cover"
      onError={() => setFailed(true)}
    />
  );
}

interface DanceTypeItem {
  id: number;
  name: string;
  isActive: boolean;
}

export default function Packages() {
  const confirmAction = useAdminConfirm();
  const { token, can } = useAdminAuth();
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
  const [agePreset, setAgePreset] = useState<(typeof AGE_PRESETS)[number]>("all");
  const { data: danceTypes = [] } = useQuery<DanceTypeItem[]>({
    queryKey: ["admin-dance-types"],
    queryFn: async () => {
      const response = await fetch(`${API}/api/admin/settings/dance-types`, {
        headers: {
          ...(API_KEY ? { "x-api-key": API_KEY } : {}),
          ...(token ? { "x-admin-token": token } : {}),
        },
      });
      if (!response.ok) throw new Error("Unable to load dance types");
      return response.json() as Promise<DanceTypeItem[]>;
    },
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "", type: "per_class", priceEgp: 0, isActive: true, isFeatured: false,
      validityMonths: 6, allowedDanceTypeIds: [], allowAllAges: true, minAge: null,
      maxAge: null, feature1: "", feature2: "", feature3: "",
      cardImageUrl: "", detailsImageUrl: "",
    },
  });

  const openCreate = () => {
    setEditing(null);
    form.reset({
      name: "", type: "per_class", priceEgp: 0, isActive: true, isFeatured: false,
      validityMonths: 6, allowedDanceTypeIds: [], allowAllAges: true, minAge: null,
      maxAge: null, feature1: "", feature2: "", feature3: "",
      cardImageUrl: "", detailsImageUrl: "",
    });
    setAgePreset("all");
    setOpen(true);
  };

  const openEdit = (p: Package) => {
    setEditing(p);
    form.reset({
      name: p.name, type: p.type, priceEgp: p.priceEgp, sessions: p.sessions ?? undefined,
      description: p.description ?? "", isActive: p.isActive, isFeatured: p.isFeatured,
      validityMonths: p.validityMonths, singleClassPriceEgp: p.singleClassPriceEgp ?? undefined,
      allowedDanceTypeIds: p.allowedDanceTypeIds,
      allowAllAges: p.allowAllAges ?? false,
      minAge: p.minAge,
      maxAge: p.maxAge,
      feature1: p.features?.[0] ?? "", feature2: p.features?.[1] ?? "", feature3: p.features?.[2] ?? "",
      cardImageUrl: p.cardImageUrl ?? "", detailsImageUrl: p.detailsImageUrl ?? "",
    });
    setAgePreset(
      p.allowAllAges === true ? "all"
      : p.minAge === 5 && p.maxAge === 12 ? "kids"
      : p.minAge === 13 && p.maxAge === 17 ? "teens"
      : p.minAge === 18 && p.maxAge == null ? "adults"
      : "custom",
    );
    setOpen(true);
  };

  const onSubmit = (values: FormValues) => {
    const parsed = formSchema.parse(values);
    const { feature1, feature2, feature3, ...rest } = parsed;
    // Collect the 3 feature inputs into an array, dropping blanks.
    const features = [feature1, feature2, feature3].map((s) => s.trim()).filter(Boolean);
    const data = { ...rest, features };
    const invalidate = () => { queryClient.invalidateQueries({ queryKey: getListPricePackagesQueryKey() }); setOpen(false); };
    if (editing) {
      updatePackage.mutate({ id: editing.id, data }, { onSuccess: invalidate });
    } else {
      createPackage.mutate({ data }, { onSuccess: invalidate });
    }
  };

  const applyAgePreset = (preset: (typeof AGE_PRESETS)[number]) => {
    setAgePreset(preset);
    const values = preset === "all" ? { allowAllAges: true, minAge: null, maxAge: null }
      : preset === "kids" ? { allowAllAges: false, minAge: 5, maxAge: 12 }
      : preset === "teens" ? { allowAllAges: false, minAge: 13, maxAge: 17 }
      : preset === "adults" ? { allowAllAges: false, minAge: 18, maxAge: null }
      : { allowAllAges: false, minAge: form.getValues("minAge"), maxAge: form.getValues("maxAge") };
    form.setValue("allowAllAges", values.allowAllAges, { shouldValidate: true });
    form.setValue("minAge", values.minAge, { shouldValidate: true });
    form.setValue("maxAge", values.maxAge, { shouldValidate: true });
  };

  const handleDelete = async (id: number) => {
    if (await confirmAction({ title: "Delete package?", description: "This package will be removed. Existing historical records remain governed by the server.", confirmLabel: "Delete package" })) {
      deletePackage.mutate({ id }, { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListPricePackagesQueryKey() }) });
    }
  };

  return (
    <div className="admin2-studio-page admin2-studio-packages">
      <PageHeader title="Packages" description="Pricing plans and subscriptions" mode="studio" addLabel="Add Package" addTestId="button-add-package" onAdd={canCreate ? openCreate : undefined} />

      <div className="admin2-studio-registry">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Price (EGP)</TableHead>
              <TableHead>Sessions</TableHead>
              <TableHead>Age</TableHead>
              <TableHead>Featured</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8">Loading...</TableCell></TableRow>
            ) : packages?.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No packages yet.</TableCell></TableRow>
            ) : (
              packages?.map((pkg) => (
                <TableRow key={pkg.id} data-testid={`row-package-${pkg.id}`}>
                  <TableCell className="font-medium">{pkg.name}</TableCell>
                  <TableCell className="capitalize">{pkg.type.replace("_", " ")}</TableCell>
                  <TableCell><span className="admin2-studio-value">{pkg.priceEgp.toLocaleString()} EGP</span></TableCell>
                  <TableCell>{pkg.sessions ?? "Unlimited"}</TableCell>
                  <TableCell>
                    {pkg.ageRangeLabel}
                    {pkg.configurationState === "legacy_unconfigured" && <Badge variant="outline" className="ml-2">Needs configuration</Badge>}
                  </TableCell>
                  <TableCell>{pkg.isFeatured ? <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" /> : "—"}</TableCell>
                  <TableCell>
                    <Badge variant={pkg.isActive ? "default" : "outline"}>{pkg.isActive ? "Active" : "Inactive"}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {canEdit && (
                      <Button variant="ghost" size="icon" aria-label={`Edit ${pkg.name}`} title="Edit package" data-testid={`button-edit-package-${pkg.id}`} onClick={() => openEdit(pkg)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                    )}
                    {canDelete && (
                      <Button variant="ghost" size="icon" aria-label={`Delete ${pkg.name}`} title="Delete package" data-testid={`button-delete-package-${pkg.id}`} onClick={() => handleDelete(pkg.id)}>
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
        <DialogContent className="admin2-studio-dialog max-w-xl">
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
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                  <FormLabel>Description (short, max {DESC_MAX})</FormLabel>
                  <FormControl><Textarea maxLength={DESC_MAX} data-testid="input-package-description" {...field} value={field.value ?? ""} /></FormControl>
                  <div className="text-xs text-muted-foreground text-right">{(field.value ?? "").length}/{DESC_MAX}</div>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="space-y-2">
                {/* Plain label — NOT <FormLabel>, which calls useFormField() and
                    throws when rendered outside a <FormField>/<FormItem>. */}
                <p className="text-sm font-medium leading-none">Features (up to 3 — shown as bullets on the package card)</p>
                {(["feature1", "feature2", "feature3"] as const).map((fn, i) => (
                  <FormField key={fn} control={form.control} name={fn} render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Input
                          maxLength={FEATURE_MAX}
                          placeholder={`Feature ${i + 1}`}
                          data-testid={`input-package-${fn}`}
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                ))}
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
              <div className="space-y-3 rounded-md border p-3">
                <p className="text-sm font-medium">Age Eligibility</p>
                <Select value={agePreset} onValueChange={(value) => applyAgePreset(value as (typeof AGE_PRESETS)[number])}>
                  <SelectTrigger data-testid="select-package-age-preset"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Ages</SelectItem>
                    <SelectItem value="kids">Kids 5–12</SelectItem>
                    <SelectItem value="teens">Teens 13–17</SelectItem>
                    <SelectItem value="adults">Adults 18+</SelectItem>
                    <SelectItem value="custom">Custom range</SelectItem>
                  </SelectContent>
                </Select>
                {!form.watch("allowAllAges") && (
                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={form.control} name="minAge" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Minimum Age</FormLabel>
                        <FormControl><Input type="number" min={0} max={150} {...field} value={field.value ?? ""} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="maxAge" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Maximum Age (optional)</FormLabel>
                        <FormControl><Input type="number" min={0} max={150} {...field} value={field.value ?? ""} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                )}
                <p className="text-sm">Label: {deriveAgeRangeLabel({
                  allowAllAges: form.watch("allowAllAges"),
                  minAge: form.watch("minAge"),
                  maxAge: form.watch("maxAge"),
                })}</p>
              </div>
              <FormField control={form.control} name="allowedDanceTypeIds" render={({ field }) => (
                <FormItem>
                  <FormLabel>Allowed dance types</FormLabel>
                  <div className="flex flex-wrap gap-2">
                    {danceTypes.filter((item) => item.isActive).map((item) => {
                      const selected = field.value.includes(item.id);
                      return (
                        <Button
                          key={item.id}
                          type="button"
                          size="sm"
                          variant={selected ? "default" : "outline"}
                          onClick={() => field.onChange(
                            selected ? field.value.filter((id) => id !== item.id) : [...field.value, item.id],
                          )}
                        >
                          {item.name}
                        </Button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">No selection means unrestricted.</p>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="space-y-3 rounded-md border p-3">
                <p className="text-sm font-medium">Package Artwork</p>
                <p className="text-xs text-muted-foreground">
                  Card image shows on the Home package card; details image is the hero in the package details sheet
                  (falls back to the card image when blank).
                </p>
                <FormField control={form.control} name="cardImageUrl" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Card Image URL</FormLabel>
                    <FormControl>
                      <Input
                        type="url"
                        placeholder="https://example.com/package-card.jpg"
                        data-testid="input-package-card-image"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <ImageUrlPreview url={form.watch("cardImageUrl")} label="Card image" />
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="detailsImageUrl" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Details Hero Image URL (optional)</FormLabel>
                    <FormControl>
                      <Input
                        type="url"
                        placeholder="Falls back to card image if left blank"
                        data-testid="input-package-details-image"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <ImageUrlPreview url={form.watch("detailsImageUrl") || form.watch("cardImageUrl")} label="Details image" />
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
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
