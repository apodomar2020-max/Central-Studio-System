import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
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

  const { data: classPricing, isLoading: isLoadingClassPricing } = useQuery<ClassPricingSettings>({
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
    values: { singleClassPriceEgp: classPricing?.singleClassPriceEgp ?? 300 },
  });

  const onClassPricingSubmit = (values: ClassPricingForm) => {
    updateClassPricingMutation.mutate(values);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Class Pricing</h2>
        <p className="text-sm text-muted-foreground">
          Global single-session price for regular studio classes. Package pricing remains managed separately.
        </p>
      </div>

      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <Form {...classPricingForm}>
          <form onSubmit={classPricingForm.handleSubmit(onClassPricingSubmit)} className="flex flex-col gap-4 sm:flex-row sm:items-end">
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
          </form>
        </Form>
        {classPricing?.updatedAt && (
          <p className="text-xs text-muted-foreground mt-4">
            Last updated: {new Date(classPricing.updatedAt).toLocaleString()}
          </p>
        )}
      </div>
    </div>
  );
}
