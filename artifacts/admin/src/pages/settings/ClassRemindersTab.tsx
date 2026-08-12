import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import {
  API,
  adminFetch,
  type ClassReminderSettings,
  type ClassReminderStatus,
} from "./types";

export function ClassRemindersTab() {
  const { token, can } = useAdminAuth();
  const canEdit = can("settings", "edit");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: classReminderStatus, isLoading: isLoadingClassReminders, isError } = useQuery<ClassReminderStatus>({
    queryKey: ["admin-class-reminders-status"],
    queryFn: () =>
      adminFetch<ClassReminderStatus>(
        `${API}/api/admin/settings/class-reminders/status`,
        { method: "GET" },
        token,
      ),
    refetchInterval: 60_000,
  });

  const invalidateClassReminders = () =>
    queryClient.invalidateQueries({ queryKey: ["admin-class-reminders-status"] });

  const updateClassReminderSettingsMutation = useMutation({
    mutationFn: (data: Partial<Pick<ClassReminderSettings, "automaticRemindersEnabled" | "classReminder24hEnabled" | "classReminder1hEnabled" | "postClassRating3hEnabled">>) =>
      adminFetch<ClassReminderSettings>(
        `${API}/api/admin/settings/class-reminders`,
        { method: "PATCH", body: JSON.stringify(data) },
        token,
      ),
    onSuccess: () => {
      invalidateClassReminders();
      toast({ title: "Class reminder settings updated" });
    },
    onError: (e: { data?: { error?: string } }) =>
      toast({ title: "Error", description: e?.data?.error ?? "Failed to save class reminder settings", variant: "destructive" }),
  });

  const onClassReminderToggle = (
    key: "automaticRemindersEnabled" | "classReminder24hEnabled" | "classReminder1hEnabled" | "postClassRating3hEnabled",
    enabled: boolean,
  ) => {
    updateClassReminderSettingsMutation.mutate({ [key]: enabled });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Class Reminders</h2>
        <p className="text-sm text-muted-foreground">
          Controls which booked-class reminder categories run. Reminder timing (24h / 1h / post-class) is fixed and not configurable here.
        </p>
      </div>

      <div className="rounded-lg border bg-card p-6 space-y-6 shadow-sm">
        {isLoadingClassReminders ? (
          <p className="text-sm text-muted-foreground py-2">Loading…</p>
        ) : isError || !classReminderStatus ? (
          <p className="text-sm text-destructive py-2">Unable to load class reminder settings.</p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex items-center justify-between gap-3 rounded-md border p-4 bg-background/50">
                <div>
                  <Label className="text-sm font-medium">Automatic class reminders</Label>
                  <p className="text-xs text-muted-foreground mt-1">Master switch — off skips every category below.</p>
                </div>
                <Switch
                  checked={classReminderStatus.settings.automaticRemindersEnabled}
                  disabled={!canEdit || updateClassReminderSettingsMutation.isPending}
                  onCheckedChange={(checked) => onClassReminderToggle("automaticRemindersEnabled", checked)}
                  data-testid="switch-automatic-reminders-enabled"
                />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md border p-4 bg-background/50">
                <div>
                  <Label className="text-sm font-medium">24-hour reminder</Label>
                  <p className="text-xs text-muted-foreground mt-1">Sent 21-24 hours before class starts.</p>
                </div>
                <Switch
                  checked={classReminderStatus.settings.classReminder24hEnabled}
                  disabled={!canEdit || updateClassReminderSettingsMutation.isPending}
                  onCheckedChange={(checked) => onClassReminderToggle("classReminder24hEnabled", checked)}
                  data-testid="switch-class-reminder-24h-enabled"
                />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md border p-4 bg-background/50">
                <div>
                  <Label className="text-sm font-medium">1-hour reminder</Label>
                  <p className="text-xs text-muted-foreground mt-1">Sent 15-60 minutes before class starts.</p>
                </div>
                <Switch
                  checked={classReminderStatus.settings.classReminder1hEnabled}
                  disabled={!canEdit || updateClassReminderSettingsMutation.isPending}
                  onCheckedChange={(checked) => onClassReminderToggle("classReminder1hEnabled", checked)}
                  data-testid="switch-class-reminder-1h-enabled"
                />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md border p-4 bg-background/50">
                <div>
                  <Label className="text-sm font-medium">Post-class feedback reminder</Label>
                  <p className="text-xs text-muted-foreground mt-1">Sent about 3 hours after class ends.</p>
                </div>
                <Switch
                  checked={classReminderStatus.settings.postClassRating3hEnabled}
                  disabled={!canEdit || updateClassReminderSettingsMutation.isPending}
                  onCheckedChange={(checked) => onClassReminderToggle("postClassRating3hEnabled", checked)}
                  data-testid="switch-post-class-rating-3h-enabled"
                />
              </div>
            </div>

            <div className="border-t pt-4 space-y-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Worker</span>
                  <Badge
                    variant="outline"
                    className={
                      classReminderStatus.worker.status === "online"
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : classReminderStatus.worker.status === "stale"
                          ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                          : "text-muted-foreground"
                    }
                  >
                    {classReminderStatus.worker.status === "online" ? "Online" : classReminderStatus.worker.status === "stale" ? "Stale" : "Unknown"}
                  </Badge>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Worker Push</span>
                  <Badge
                    variant="outline"
                    className={classReminderStatus.worker.pushNotificationsEnabled ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"}
                  >
                    {classReminderStatus.worker.pushNotificationsEnabled == null ? "Unknown" : classReminderStatus.worker.pushNotificationsEnabled ? "Enabled" : "Disabled"}
                  </Badge>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">API Push</span>
                  <Badge
                    variant="outline"
                    className={classReminderStatus.api.pushNotificationsEnabled ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"}
                  >
                    {classReminderStatus.api.pushNotificationsEnabled ? "Enabled" : "Disabled"}
                  </Badge>
                </span>
              </div>

              {classReminderStatus.pushConfigMismatch && (
                <div className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>API and Worker Push configuration differ — reminders may be created but not delivered. Check PUSH_NOTIFICATIONS_ENABLED on both services.</span>
                </div>
              )}

              <div className="text-xs text-muted-foreground space-y-1">
                <p>
                  Last reminder run:{" "}
                  {classReminderStatus.worker.lastReminderRunAt
                    ? `${new Date(classReminderStatus.worker.lastReminderRunAt).toLocaleString()}${classReminderStatus.worker.lastReminderRunStatus ? ` (${classReminderStatus.worker.lastReminderRunStatus})` : ""}`
                    : "Never"}
                </p>
                {classReminderStatus.worker.lastReminderRunSummary && (
                  <p>
                    Latest — created {String(classReminderStatus.worker.lastReminderRunSummary["created"] ?? 0)},{" "}
                    sent {String(classReminderStatus.worker.lastReminderRunSummary["pushed"] ?? 0)},{" "}
                    failed {String(classReminderStatus.worker.lastReminderRunSummary["pushFailed"] ?? 0)},{" "}
                    skipped {String(
                      (Number(classReminderStatus.worker.lastReminderRunSummary["duplicateSkipped"] ?? 0)) +
                      (Number(classReminderStatus.worker.lastReminderRunSummary["disabledSkipped"] ?? 0)) +
                      (Number(classReminderStatus.worker.lastReminderRunSummary["inactiveScheduleSkipped"] ?? 0)) +
                      (Number(classReminderStatus.worker.lastReminderRunSummary["missingOccurrence"] ?? 0)),
                    )}
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
