import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Save } from "lucide-react";
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

      <Form {...classPricingForm}>
        <form onSubmit={classPricingForm.handleSubmit(onClassPricingSubmit)} className="space-y-6">
          <div className="rounded-lg border bg-card p-6 shadow-sm">
            <h3 className="text-sm font-semibold text-foreground mb-4">Category Prices</h3>
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
                    <FormDescription>Leave blank to use the Single Class Price fallback.</FormDescription>
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
                    <FormDescription>Leave blank to use the Single Class Price fallback.</FormDescription>
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
                    <FormDescription>Leave blank to use the Single Class Price fallback.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>

          <div className="rounded-lg border bg-card p-6 shadow-sm">
            <h3 className="text-sm font-semibold text-foreground mb-1">Single Class Price (legacy fallback)</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Used for any class without a configured category price, and for classes
              not yet assigned Adults/Teens/Kids.
            </p>
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
