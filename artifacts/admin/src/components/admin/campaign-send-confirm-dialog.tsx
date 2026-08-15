/**
 * Notifications Wave 4 — rich Send confirmation.
 *
 * A dedicated dialog rather than the generic useAdminConfirm (string-only
 * description) — this needs structured, clearly-labeled stat rows plus a
 * stronger warning specifically for All Members, matching the task's exact
 * required copy. Built on the same AlertDialog primitives and button
 * treatment as admin-confirm.tsx for visual consistency, not a new pattern.
 */
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2 } from "lucide-react";
import type { AudiencePreview, CreatableAudienceType } from "@/lib/notificationCampaigns";

const AUDIENCE_LABELS: Record<CreatableAudienceType | "all", string> = {
  all: "All Members",
  all_members: "All Members",
  specific_members: "Specific Members",
  students: "Students",
  parents: "Parents",
  ballet_families: "Ballet Families",
  class_participants: "Class Participants",
  package_holders: "Package Holders",
};

export function CampaignSendConfirmDialog({
  open,
  onOpenChange,
  audienceType,
  preview,
  isSending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  audienceType: CreatableAudienceType | "all" | null;
  preview: AudiencePreview | null;
  isSending: boolean;
  onConfirm: () => void;
}) {
  const isAllMembers = audienceType === "all_members" || audienceType === "all";

  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!isSending) onOpenChange(next); }}>
      <AlertDialogContent data-testid="dialog-send-confirm">
        <AlertDialogHeader>
          <AlertDialogTitle>Send this Push Notification?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm text-foreground">
              <div>
                <span className="text-xs uppercase tracking-wide text-muted-foreground">Audience</span>
                <div className="font-medium">{audienceType ? AUDIENCE_LABELS[audienceType] : "—"}</div>
              </div>
              {preview && (
                <div className="grid grid-cols-2 gap-2">
                  <Stat label="Matched accounts" value={preview.matchedAccounts} />
                  <Stat label="Push-enabled accounts" value={preview.pushEnabledAccounts} />
                  <Stat label="Active devices" value={preview.activeDevices} />
                  <Stat label="No active device" value={preview.noActiveDeviceAccounts} />
                </div>
              )}
              {isAllMembers && (
                <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-amber-700 dark:text-amber-400 font-medium" data-testid="text-all-members-warning">
                  You are about to notify all eligible members.
                </p>
              )}
              <p className="text-muted-foreground">This will send a real Push notification to every matched, Push-enabled device. This cannot be undone.</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            data-testid="button-confirm-send"
            disabled={isSending}
            className="!border-[#e2696d55] !bg-[#e2696d] !text-white hover:!bg-[#ed7c80]"
            onClick={(e) => { e.preventDefault(); onConfirm(); }}
          >
            {isSending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
            Send Push Notification
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/30 p-2">
      <div className="text-lg font-semibold">{value.toLocaleString()}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
