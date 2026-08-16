import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import {
  API,
  adminFetch,
  classPricingSchema,
  type ClassPricingSettings,
  type ClassPricingForm,
} from "./types";

export function ClassPricingTab() {
  const { token, can } = useAdminAuth();
  const canEdit = can("settings", "edit");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: classPricing, isLoading: isLoadingClassPricing, isError } = useQuery<ClassPricingSettings>({
    queryKey: ["admin-class-pricing"],
    queryFn: () =>
      adminFetch<ClassPricingSettings>(
        `${API}/api/admin/settings/class-pricing`,
        { method: "GET" },
        token,
      ),
  });

  const invalidateClassPricing = () =>
    queryClient.invalidateQueries({ queryKey: ["admin-class-pricing"] });

  const updateClassPricingMutation = useMutation({
    mutationFn: (data: ClassPricingForm) =>
      adminFetch<ClassPricingSettings>(
        `${API}/api/admin/settings/class-pricing`,
        { method: "PATCH", body: JSON.stringify(data) },
        token,
      ),
    onSuccess: () => {
      invalidateClassPricing();
      toast({ title: "Class pricing updated" });
    },
    onError: (e: { data?: { error?: string } }) =>
      toast({ title: "Error", description: e?.data?.error ?? "Failed to save class pricing", variant: "destructive" }),
  });

  const classPricingForm = useForm<ClassPricingForm>({
    resolver: zodResolver(classPricingSchema),
    values: {
      singleClassPriceEgp: classPricing?.singleClassPriceEgp ?? 300,
      adultsWalkinPriceEgp: classPricing?.adultsWalkinPriceEgp ?? null,
      teensWalkinPriceEgp: classPricing?.teensWalkinPriceEgp ?? null,
      kidsWalkinPriceEgp: classPricing?.kidsWalkinPriceEgp ?? null,
    },
  });

  const onClassPricingSubmit = (values: ClassPricingForm) => {
    updateClassPricingMutation.mutate(values);
  };

  // Admin visibility (pre-merge gap closure): a category can have active
  // classes assigned to it while its own price is left unconfigured — that
  // combination silently falls back to the Single Class Price below with no
  // other signal anywhere in the UI. Surface it explicitly here.
  const categoryGaps: Array<{ key: "adults" | "teens" | "kids"; label: string; activeClasses: number }> = (
    [
      { key: "adults" as const, label: "Adults", price: classPricing?.adultsWalkinPriceEgp },
      { key: "teens" as const, label: "Teens", price: classPricing?.teensWalkinPriceEgp },
      { key: "kids" as const, label: "Kids", price: classPricing?.kidsWalkinPriceEgp },
    ]
  )
    .filter((c) => c.price == null && (classPricing?.activeClassCountsByCategory?.[c.key] ?? 0) > 0)
    .map((c) => ({ key: c.key, label: c.label, activeClasses: classPricing!.activeClassCountsByCategory![c.key] }));

  const activeClassesFor = (key: "adults" | "teens" | "kids") => classPricing?.activeClassCountsByCategory?.[key] ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Class Pricing</h2>
        <p className="text-sm text-muted-foreground">
          Configure General Class walk-in prices per category. A schedule-specific
          price override always wins; if a class hasn't been assigned a pricing
          category yet (Classes page), it falls back to the Single Class Price below.
        </p>
      </div>

      {isError && <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">Class pricing could not be loaded.</div>}

      {!isLoadingClassPricing && categoryGaps.length > 0 && (
        <div
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-200"
          data-testid="banner-category-price-gap"
        >
          <p className="font-medium">Some categories have active classes but no configured price:</p>
          <ul className="list-disc pl-5 mt-1">
            {categoryGaps.map((gap) => (
              <li key={gap.key}>
                <strong>{gap.activeClasses}</strong> active class{gap.activeClasses === 1 ? "" : "es"} {gap.activeClasses === 1 ? "is" : "are"} assigned{" "}
                <strong>{gap.label}</strong> pricing, but no {gap.label} price is set below — {gap.activeClasses === 1 ? "it" : "they"} will keep
                charging the Single Class Price fallback until you configure it.
              </li>
            ))}
          </ul>
        </div>
      )}

      <Form {...classPricingForm}>
        <form onSubmit={classPricingForm.handleSubmit(onClassPricingSubmit)} className="space-y-6">
          <div className="rounded-lg border bg-card p-6 shadow-sm">
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-foreground">General Class Walk-in Pricing</h3>
              <p className="text-sm text-muted-foreground mt-1">
                The active prices — applied automatically once a class is assigned an Adults, Teens, or Kids category.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FormField
                control={classPricingForm.control}
                name="adultsWalkinPriceEgp"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Adults Walk-in Price (EGP)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        placeholder="Not configured"
                        data-testid="input-adults-walkin-price"
                        disabled={isLoadingClassPricing || !canEdit}
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormDescription data-testid="text-adults-active-count">
                      {activeClassesFor("adults")} active class{activeClassesFor("adults") === 1 ? "" : "es"} use Adults pricing.{" "}
                      {field.value == null && activeClassesFor("adults") > 0 ? (
                        <span className="text-amber-600 dark:text-amber-400 font-medium">Blank — falling back to Single Class Price.</span>
                      ) : (
                        "Leave blank to use the Single Class Price fallback."
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={classPricingForm.control}
                name="teensWalkinPriceEgp"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Teens Walk-in Price (EGP)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        placeholder="Not configured"
                        data-testid="input-teens-walkin-price"
                        disabled={isLoadingClassPricing || !canEdit}
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormDescription data-testid="text-teens-active-count">
                      {activeClassesFor("teens")} active class{activeClassesFor("teens") === 1 ? "" : "es"} use Teens pricing.{" "}
                      {field.value == null && activeClassesFor("teens") > 0 ? (
                        <span className="text-amber-600 dark:text-amber-400 font-medium">Blank — falling back to Single Class Price.</span>
                      ) : (
                        "Leave blank to use the Single Class Price fallback."
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={classPricingForm.control}
                name="kidsWalkinPriceEgp"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Kids Walk-in Price (EGP)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        placeholder="Not configured"
                        data-testid="input-kids-walkin-price"
                        disabled={isLoadingClassPricing || !canEdit}
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormDescription data-testid="text-kids-active-count">
                      {activeClassesFor("kids")} active class{activeClassesFor("kids") === 1 ? "" : "es"} use Kids pricing.{" "}
                      {field.value == null && activeClassesFor("kids") > 0 ? (
                        <span className="text-amber-600 dark:text-amber-400 font-medium">Blank — falling back to Single Class Price.</span>
                      ) : (
                        "Leave blank to use the Single Class Price fallback."
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>

          <div className="rounded-lg border bg-card p-6 shadow-sm" data-testid="section-legacy-fallback">
            <div className="mb-4">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-foreground">Legacy Fallback</h3>
                <Badge variant="secondary">Fallback</Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Fallback price used for classes without a configured Walk-in Pricing Category.
                Not one of the main category prices above.
              </p>
            </div>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
              <FormField
                control={classPricingForm.control}
                name="singleClassPriceEgp"
                render={({ field }) => (
                  <FormItem className="sm:w-72">
                    <FormLabel>Single Class Price (EGP)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        data-testid="input-single-class-price"
                        disabled={isLoadingClassPricing || !canEdit}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {canEdit && (
                <Button
                  type="submit"
                  data-testid="button-save-class-pricing"
                  disabled={isLoadingClassPricing || updateClassPricingMutation.isPending}
                >
                  <Save className="h-4 w-4 mr-2" />
                  Save Pricing
                </Button>
              )}
            </div>
            {classPricing?.updatedAt && (
              <p className="text-xs text-muted-foreground mt-4">
                Last updated: {new Date(classPricing.updatedAt).toLocaleString()}
              </p>
            )}
          </div>
        </form>
      </Form>
    </div>
  );
}
