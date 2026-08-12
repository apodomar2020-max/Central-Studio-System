import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import {
  API,
  adminFetch,
  type ClassCapacitySettings,
  type OverCapacityOccurrence,
} from "./types";

export function ClassCapacityTab() {
  const { token, can } = useAdminAuth();
  const canEdit = can("settings", "edit");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: classCapacity, isLoading: isLoadingClassCapacity, isError } = useQuery<ClassCapacitySettings>({
    queryKey: ["admin-class-capacity"],
    queryFn: () =>
      adminFetch<ClassCapacitySettings>(
        `${API}/api/admin/settings/class-capacity`,
        { method: "GET" },
        token,
      ),
  });

  const invalidateClassCapacity = () =>
    queryClient.invalidateQueries({ queryKey: ["admin-class-capacity"] });

  const updateClassCapacityMutation = useMutation({
    mutationFn: (data: { classCapacityEnabled: boolean; confirmOverCapacity?: boolean }) =>
      adminFetch<ClassCapacitySettings>(
        `${API}/api/admin/settings/class-capacity`,
        { method: "PATCH", body: JSON.stringify(data) },
        token,
      ),
    onSuccess: () => {
      invalidateClassCapacity();
      toast({ title: "Class capacity setting updated" });
    },
    onError: async (e: { error?: string; message?: string; overCapacityOccurrences?: OverCapacityOccurrence[] }, variables) => {
      if (e?.error === "over_capacity_warning" && variables.classCapacityEnabled) {
        const count = e.overCapacityOccurrences?.length ?? 0;
        const confirmed = confirm(
          `Re-enable capacity enforcement?\n\n${count} active class occurrence${count === 1 ? "" : "s"} already exceed stored capacity. New bookings may be blocked until capacity values or bookings are adjusted.`,
        );
        if (confirmed) {
          await updateClassCapacityMutation.mutateAsync({ classCapacityEnabled: true, confirmOverCapacity: true }).catch(() => null);
        }
        return;
      }
      toast({ title: "Error", description: e?.message ?? "Failed to save class capacity setting", variant: "destructive" });
    },
  });

  const onClassCapacityToggle = (enabled: boolean) => {
    updateClassCapacityMutation.mutate({ classCapacityEnabled: enabled });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Class Capacity</h2>
        <p className="text-sm text-muted-foreground">
          Controls whether regular class capacity is displayed and enforced. Stored capacity values and booking counts are preserved.
        </p>
      </div>

      {isError && <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">Class capacity settings could not be loaded.</div>}

      <div className="rounded-lg border bg-card p-6 space-y-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Label className="text-sm font-medium">Capacity display and enforcement</Label>
            <p className="text-xs text-muted-foreground mt-1">
              {classCapacity?.classCapacityEnabled === false
                ? "Inactive: students can book without capacity limits, and mobile capacity indicators are hidden."
                : "Active: stored class capacity values are used for availability and booking eligibility."}
            </p>
          </div>
          <Switch
            checked={classCapacity?.classCapacityEnabled ?? true}
            disabled={isLoadingClassCapacity || !canEdit || updateClassCapacityMutation.isPending}
            onCheckedChange={onClassCapacityToggle}
            data-testid="switch-class-capacity-enabled"
          />
        </div>

        {classCapacity?.classCapacityEnabled === false && (
          <div className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>Capacity values are saved but inactive. Re-enabling will reuse the stored values immediately.</span>
          </div>
        )}

        {(classCapacity?.overCapacityOccurrences.length ?? 0) > 0 && (
          <div className="rounded-md border border-destructive/30 p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-destructive">
              <AlertTriangle className="h-4 w-4" />
              {classCapacity?.overCapacityOccurrences.length} occurrence{classCapacity?.overCapacityOccurrences.length === 1 ? "" : "s"} above stored capacity
            </div>
            <div className="mt-2 max-h-64 space-y-1 overflow-y-auto text-xs text-muted-foreground">
              {classCapacity?.overCapacityOccurrences.map((item) => (
                <div key={`${item.scheduleId}-${item.occurrenceDate ?? "legacy"}`}>
                  {item.classTitle} {item.occurrenceDate ? `on ${item.occurrenceDate}` : "(legacy occurrence)"}: {item.bookedCount}/{item.capacity}
                </div>
              ))}
            </div>
          </div>
        )}

        {classCapacity?.updatedAt && (
          <p className="text-xs text-muted-foreground">
            Last updated: {new Date(classCapacity.updatedAt).toLocaleString()}
          </p>
        )}
      </div>
    </div>
  );
}
