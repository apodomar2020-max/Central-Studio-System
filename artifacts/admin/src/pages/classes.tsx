import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useListClasses,
  useCreateClass,
  useUpdateClass,
  useDeleteClass,
  useListInstructors,
  getListClassesQueryKey,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
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
import { Trash2, Edit } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { useAdminConfirm } from "@/components/admin/admin-confirm";
import { Badge } from "@/components/ui/badge";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { deriveAgeRangeLabel } from "@workspace/api-zod";
import "./admin2-studio.css";

// ─── Dance types — loaded from Settings, replaces hardcoded CATEGORIES ────────

const API = import.meta.env.VITE_API_URL ?? "";
const API_KEY = (import.meta.env.VITE_API_KEY as string | undefined) ?? "";

function makeAdminHeaders(token: string | null): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(API_KEY ? { "x-api-key": API_KEY } : {}),
    ...(token ? { "x-admin-token": token } : {}),
  };
}

interface DanceTypeItem {
  id: number;
  name: string;
  slug: string;
  isActive: boolean;
  sortOrder: number;
}

interface ClassCapacitySettings {
  classCapacityEnabled: boolean;
}

interface ClassPricingSettingsSummary {
  adultsWalkinPriceEgp: number | null;
  teensWalkinPriceEgp: number | null;
  kidsWalkinPriceEgp: number | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LEVELS = ["Beginner", "Intermediate", "Advanced", "All Levels"];
const AGE_GROUPS = ["Kids", "Teens", "Adults"] as const;
const AGE_PRESETS = ["all", "kids", "teens", "adults", "custom"] as const;
// General Class walk-in pricing bucket — deliberately separate from the
// legacy AGE_GROUPS free text above; unassigned (null) is a valid, expected
// state for every class until an Admin explicitly audits and assigns it.
const PRICING_CATEGORIES = [
  { value: "adults", label: "Adults" },
  { value: "teens", label: "Teens" },
  { value: "kids", label: "Kids" },
] as const;
const PRICING_CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  PRICING_CATEGORIES.map((c) => [c.value, c.label]),
);
const PRICING_CATEGORY_UNASSIGNED = "__unassigned__";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Normalize a category string for fuzzy matching — mirrors the mobile apiAdapters logic. */
function normalizeCat(s: string): string {
  return s.trim().toLowerCase().replace(/[\s\-_]+/g, "");
}

// ─── Form schema ──────────────────────────────────────────────────────────────

const nullableAge = z.preprocess(
  (value) => value === "" || value == null ? null : Number(value),
  z.number().int().min(0, "Age must be 0 or above").max(150, "Age must be 150 or below").nullable(),
);

const formSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().nullish(),
  instructorId: z.coerce.number().int().nullish(),
  category: z.string().min(1, "Category is required"),
  danceTypeId: z.coerce.number().int().positive().nullish(),
  level: z.string().min(1, "Level is required"),
  ageGroup: z.string().min(1, "Age Group is required"),
  pricingCategory: z.enum(["adults", "teens", "kids"]).nullable(),
  allowAllAges: z.boolean(),
  minAge: nullableAge,
  maxAge: nullableAge,
  durationMins: z.coerce.number().int().min(1),
  capacity: z.coerce.number().int().min(1),
  photoUrl: z.string().url("Must be a valid URL").nullish().or(z.literal("")),
  classVideoUrl: z.string().url("Must be a valid URL").nullish().or(z.literal("")),
  isActive: z.boolean().default(true),
}).superRefine((value, ctx) => {
  if (!value.allowAllAges && value.minAge == null) {
    ctx.addIssue({ code: "custom", path: ["minAge"], message: "Minimum age is required." });
  }
  if (value.minAge != null && value.maxAge != null && value.minAge > value.maxAge) {
    ctx.addIssue({ code: "custom", path: ["maxAge"], message: "Maximum age cannot be below minimum age." });
  }
});

type FormValues = z.output<typeof formSchema>;
type Class = {
  id: number;
  title: string;
  description?: string | null;
  instructorId?: number | null;
  category: string;
  danceTypeId?: number | null;
  level: string;
  ageGroup: string;
  pricingCategory?: string | null;
  allowAllAges: boolean | null;
  minAge: number | null;
  maxAge: number | null;
  ageRangeLabel: string;
  configurationState: "configured" | "legacy_unconfigured";
  durationMins: number;
  capacity: number;
  photoUrl?: string | null;
  classVideoUrl?: string | null;
  isActive: boolean;
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Classes() {
  const confirmAction = useAdminConfirm();
  const { token, can } = useAdminAuth();
  const canCreate = can("classes", "create");
  const canEdit = can("classes", "edit");
  const canDelete = can("classes", "delete");
  const canMediaManage = can("classes", "mediaManage");
  const { data: classes, isLoading } = useListClasses();
  const { data: instructors } = useListInstructors();
  const createClass = useCreateClass();
  const updateClass = useUpdateClass();
  const deleteClass = useDeleteClass();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Class | null>(null);
  const [agePreset, setAgePreset] = useState<(typeof AGE_PRESETS)[number]>("all");

  // ── Dynamic dance types from Settings → Dance Types ───────────────────────
  const { data: danceTypes = [] } = useQuery<DanceTypeItem[]>({
    queryKey: ["admin-dance-types"],
    queryFn: async () => {
      const r = await fetch(`${API}/api/admin/settings/dance-types`, {
        headers: makeAdminHeaders(token),
      });
      // Return empty array on any error (e.g. 404 before route is deployed)
      // so the Classes page never crashes while dance types are unavailable.
      if (!r.ok) return [];
      return r.json() as Promise<DanceTypeItem[]>;
    },
  });

  const { data: classCapacity } = useQuery<ClassCapacitySettings>({
    queryKey: ["admin-class-capacity"],
    queryFn: async () => {
      const r = await fetch(`${API}/api/admin/settings/class-capacity`, {
        headers: makeAdminHeaders(token),
      });
      if (!r.ok) return { classCapacityEnabled: true };
      return r.json() as Promise<ClassCapacitySettings>;
    },
  });
  const capacityInactive = classCapacity?.classCapacityEnabled === false;

  // Cross-referenced with each class's pricingCategory below to flag a class
  // that HAS a category assigned but whose category price is unconfigured —
  // the failure mode the unassigned-category banner alone can't catch.
  const { data: classPricingSettings } = useQuery<ClassPricingSettingsSummary>({
    queryKey: ["admin-class-pricing-summary"],
    queryFn: async () => {
      const r = await fetch(`${API}/api/admin/settings/class-pricing`, {
        headers: makeAdminHeaders(token),
      });
      if (!r.ok) return { adultsWalkinPriceEgp: null, teensWalkinPriceEgp: null, kidsWalkinPriceEgp: null };
      return r.json() as Promise<ClassPricingSettingsSummary>;
    },
  });
  const CATEGORY_PRICE_FIELD: Record<string, keyof ClassPricingSettingsSummary> = {
    adults: "adultsWalkinPriceEgp",
    teens: "teensWalkinPriceEgp",
    kids: "kidsWalkinPriceEgp",
  };
  const hasUnconfiguredCategoryPrice = (pricingCategory?: string | null): boolean => {
    if (!pricingCategory || !classPricingSettings) return false;
    const field = CATEGORY_PRICE_FIELD[pricingCategory];
    return field != null && classPricingSettings[field] == null;
  };

  /** Active dance types sorted for the dropdown */
  const activeCategories = danceTypes
    .filter((dt) => dt.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((dt) => dt.name);

  /**
   * Map a potentially dirty DB value (e.g. "Hiphop", "hip-hop") to the nearest
   * known category name. Falls back to the raw value so no data is lost.
   */
  function canonicalizeCategory(raw: string): string {
    const needle = normalizeCat(raw);
    return activeCategories.find((c) => normalizeCat(c) === needle) ?? raw;
  }

  // ── Form ──────────────────────────────────────────────────────────────────
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "", category: "", level: "All Levels", ageGroup: "Adults",
      pricingCategory: null,
      allowAllAges: true, minAge: null, maxAge: null,
      durationMins: 60, capacity: 20, photoUrl: "", classVideoUrl: "", isActive: true,
    },
  });

  const openCreate = () => {
    setEditing(null);
    form.reset({
      title: "", description: "", category: "", level: "All Levels",
      ageGroup: "Adults", pricingCategory: null, allowAllAges: true, minAge: null, maxAge: null, durationMins: 60, capacity: 20,
      photoUrl: "", classVideoUrl: "", isActive: true,
    });
    setAgePreset("all");
    setOpen(true);
  };

  const openEdit = (cls: Class) => {
    setEditing(cls);
    form.reset({
      title: cls.title,
      description: cls.description ?? "",
      instructorId: cls.instructorId ?? undefined,
      category: canonicalizeCategory(cls.category),
      danceTypeId: cls.danceTypeId ?? undefined,
      level: cls.level,
      ageGroup: cls.ageGroup || "Adults",
      pricingCategory: (cls.pricingCategory as "adults" | "teens" | "kids" | null | undefined) ?? null,
      allowAllAges: cls.allowAllAges ?? false,
      minAge: cls.minAge,
      maxAge: cls.maxAge,
      durationMins: cls.durationMins,
      capacity: cls.capacity,
      photoUrl: cls.photoUrl ?? "",
      classVideoUrl: cls.classVideoUrl ?? "",
      isActive: cls.isActive,
    });
    setAgePreset(
      cls.allowAllAges === true ? "all"
      : cls.minAge === 5 && cls.maxAge === 12 ? "kids"
      : cls.minAge === 13 && cls.maxAge === 17 ? "teens"
      : cls.minAge === 18 && cls.maxAge == null ? "adults"
      : "custom",
    );
    setOpen(true);
  };

  const onSubmit = (values: FormValues) => {
    const parsed = formSchema.parse(values);
    const payload = {
      ...parsed,
      danceTypeId: danceTypes.find((item) => item.name === parsed.category)?.id ?? parsed.danceTypeId ?? null,
      photoUrl: parsed.photoUrl || null,
      classVideoUrl: parsed.classVideoUrl || null,
    };
    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: getListClassesQueryKey() });
      setOpen(false);
    };
    if (editing) {
      updateClass.mutate({ id: editing.id, data: payload }, { onSuccess: invalidate });
    } else {
      createClass.mutate({ data: payload }, { onSuccess: invalidate });
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
    if (await confirmAction({ title: "Archive class?", description: "The class will be deactivated while historical schedules, bookings, and reports remain preserved.", confirmLabel: "Archive class" })) {
      deleteClass.mutate({ id }, {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getListClassesQueryKey() }),
      });
    }
  };

  const getInstructorName = (id?: number | null) =>
    instructors?.find((i) => i.id === id)?.name ?? "—";

  const activeClasses = classes?.filter((cls) => cls.isActive) ?? [];
  const unassignedPricingCount = activeClasses.filter((cls) => !cls.pricingCategory).length;
  // Distinct failure mode from "unassigned": a class HAS a category, but
  // that category's own price was never configured in Settings -> Class
  // Pricing — invisible without this cross-reference.
  const unconfiguredCategoryPriceClasses = activeClasses.filter((cls) => hasUnconfiguredCategoryPrice(cls.pricingCategory));

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="admin2-studio-page admin2-studio-classes">
      <PageHeader
        title="Classes"
        description="Manage your class catalog"
        mode="studio"
        addLabel="Add Class"
        addTestId="button-add-class"
        onAdd={canCreate ? openCreate : undefined}
      />

      {!isLoading && unassignedPricingCount > 0 && (
        <div
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-200 mb-4"
          data-testid="banner-pricing-category-audit"
        >
          <strong>{unassignedPricingCount}</strong> active {unassignedPricingCount === 1 ? "class hasn't" : "classes haven't"} been
          assigned a Walk-in Pricing Category yet. Until audited, {unassignedPricingCount === 1 ? "it" : "they"} will keep using the
          legacy Single Class Price fallback from Settings → Class Pricing. Edit a class below to assign Adults, Teens, or Kids.
        </div>
      )}

      {!isLoading && unconfiguredCategoryPriceClasses.length > 0 && (
        <div
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-200 mb-4"
          data-testid="banner-category-price-unconfigured"
        >
          <p>
            <strong>{unconfiguredCategoryPriceClasses.length}</strong> active class{unconfiguredCategoryPriceClasses.length === 1 ? " has" : "es have"} a
            pricing category assigned, but that category's price isn't configured yet — {unconfiguredCategoryPriceClasses.length === 1 ? "it's" : "they're"} silently
            using the legacy Single Class Price fallback. Configure the missing price{unconfiguredCategoryPriceClasses.length === 1 ? "" : "s"} from Settings → Class Pricing:
          </p>
          <ul className="list-disc pl-5 mt-1">
            {unconfiguredCategoryPriceClasses.map((cls) => (
              <li key={cls.id}>{cls.title} — {PRICING_CATEGORY_LABEL[cls.pricingCategory!] ?? cls.pricingCategory}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="admin2-studio-registry">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Instructor</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Level</TableHead>
              <TableHead>Age Eligibility</TableHead>
              <TableHead>Pricing Category</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Capacity</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center py-8">Loading...</TableCell>
              </TableRow>
            ) : classes?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                  No classes yet.
                </TableCell>
              </TableRow>
            ) : (
              classes?.map((cls) => (
                <TableRow key={cls.id} data-testid={`row-class-${cls.id}`}>
                  <TableCell className="font-medium">{cls.title}</TableCell>
                  <TableCell>{getInstructorName(cls.instructorId)}</TableCell>
                  <TableCell>{cls.category}</TableCell>
                  <TableCell>{cls.level}</TableCell>
                  <TableCell>
                    {cls.ageRangeLabel}
                    {cls.configurationState === "legacy_unconfigured" && (
                      <Badge variant="outline" className="ml-2">Needs configuration</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {cls.pricingCategory ? (
                      <>
                        {PRICING_CATEGORY_LABEL[cls.pricingCategory] ?? cls.pricingCategory}
                        {hasUnconfiguredCategoryPrice(cls.pricingCategory) && (
                          <Badge
                            variant="outline"
                            className="ml-2 border-amber-500/40 text-amber-700 dark:text-amber-300"
                            data-testid={`badge-pricing-unconfigured-${cls.id}`}
                            title="This category has no configured price — falling back to the Single Class Price."
                          >
                            No price set
                          </Badge>
                        )}
                      </>
                    ) : (
                      <Badge variant="outline" data-testid={`badge-pricing-unassigned-${cls.id}`}>Unassigned</Badge>
                    )}
                  </TableCell>
                  <TableCell>{cls.durationMins} min</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span>{cls.capacity}</span>
                      {capacityInactive && <Badge variant="outline">Inactive</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={cls.isActive ? "default" : "outline"}>
                      {cls.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Edit ${cls.title}`}
                        title="Edit class"
                        data-testid={`button-edit-class-${cls.id}`}
                        onClick={() => openEdit(cls)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Archive ${cls.title}`}
                        title="Archive class"
                        data-testid={`button-delete-class-${cls.id}`}
                        onClick={() => handleDelete(cls.id)}
                      >
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
            <DialogTitle>{editing ? "Edit Class" : "Add Class"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Title</FormLabel>
                    <FormControl>
                      <Input data-testid="input-class-title" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Category</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-class-category">
                            <SelectValue placeholder={
                              activeCategories.length === 0
                                ? "No dance types configured"
                                : "Select category"
                            } />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {activeCategories.length === 0 ? (
                            <div className="px-3 py-2 text-sm text-muted-foreground">
                              No dance types configured.{" "}
                              <a href="/settings" className="underline">Go to Settings</a> to add some.
                            </div>
                          ) : (
                            activeCategories.map((c) => (
                              <SelectItem key={c} value={c}>{c}</SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="level"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Level</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-class-level">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {LEVELS.map((l) => (
                            <SelectItem key={l} value={l}>{l}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="ageGroup"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Legacy Age Group</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-class-age-group">
                          <SelectValue placeholder="Select age group" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {AGE_GROUPS.map((g) => (
                          <SelectItem key={g} value={g}>{g}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="pricingCategory"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Walk-in Pricing Category</FormLabel>
                    <Select
                      onValueChange={(v) => field.onChange(v === PRICING_CATEGORY_UNASSIGNED ? null : v)}
                      value={field.value ?? PRICING_CATEGORY_UNASSIGNED}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-class-pricing-category">
                          <SelectValue placeholder="Unassigned" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={PRICING_CATEGORY_UNASSIGNED}>Unassigned (uses legacy fallback price)</SelectItem>
                        {PRICING_CATEGORIES.map((c) => (
                          <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Determines which Class Pricing category price applies to walk-ins for
                      this class (Settings → Class Pricing). A schedule-specific price
                      override always takes priority over this.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="space-y-3 rounded-md border p-3">
                <div>
                  <p className="text-sm font-medium">Age Eligibility</p>
                  <p className="text-xs text-muted-foreground">The label is derived from the technical range.</p>
                </div>
                <Select value={agePreset} onValueChange={(value) => applyAgePreset(value as (typeof AGE_PRESETS)[number])}>
                  <SelectTrigger data-testid="select-class-age-preset"><SelectValue /></SelectTrigger>
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
                <p className="text-sm">
                  Label: {deriveAgeRangeLabel({
                    allowAllAges: form.watch("allowAllAges"),
                    minAge: form.watch("minAge"),
                    maxAge: form.watch("maxAge"),
                  })}
                </p>
              </div>
              <FormField
                control={form.control}
                name="instructorId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Instructor</FormLabel>
                    <Select
                      onValueChange={(v) => field.onChange(v === "none" ? null : Number(v))}
                      value={field.value ? String(field.value) : "none"}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-class-instructor">
                          <SelectValue placeholder="Select instructor" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">No instructor</SelectItem>
                        {instructors?.map((i) => (
                          <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="durationMins"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Duration (min)</FormLabel>
                      <FormControl>
                        <Input type="number" data-testid="input-class-duration" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="capacity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Capacity</FormLabel>
                      <FormControl>
                        <Input type="number" data-testid="input-class-capacity" {...field} />
                      </FormControl>
                      {capacityInactive && (
                        <p className="text-xs text-muted-foreground">
                          Capacity is currently inactive globally, but this saved value will be reused when re-enabled.
                        </p>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        data-testid="input-class-description"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {canMediaManage && (
                <>
                  <FormField
                    control={form.control}
                    name="photoUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Class Image URL</FormLabel>
                        <FormControl>
                          <Input placeholder="Direct image or Google Drive sharing URL" {...field} value={field.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="classVideoUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Class Video URL</FormLabel>
                        <FormControl>
                          <Input placeholder="Direct MP4, Google Drive, or YouTube URL" {...field} value={field.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}
              <FormField
                control={form.control}
                name="isActive"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-3">
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                    <FormLabel className="!mt-0">Active</FormLabel>
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  data-testid="button-submit-class"
                  disabled={createClass.isPending || updateClass.isPending}
                >
                  {editing ? "Save Changes" : "Create Class"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
