/**
 * Notifications Wave 4 — campaign detail: the delivery aggregate already
 * computed server-side (computeCampaignAggregate), never re-derived here.
 * Snapshot-time facts (intendedRecipientCount etc., frozen at send) and
 * delivery-time facts (aggregate.sentDevices etc., live-derived) are kept
 * visually distinct so an operator never reads "sent" as "read" or a
 * frozen snapshot count as a live one.
 */
import { Loader2, AlertTriangle, RotateCcw, Archive } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCampaignDetail, type CampaignStatus } from "@/lib/notificationCampaigns";

const ERROR_CODE_LABELS: Record<string, string> = {
  DeviceNotRegistered: "Device no longer registered",
  expo_request_failed: "Expo request failure",
  MessageRateExceeded: "Rate limited by Expo",
  InvalidCredentials: "Invalid Push credentials",
  no_active_device: "No active device",
  MessageTooBig: "Message too large",
};

const STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: "Draft",
  ready: "Ready",
  sending: "Sending",
  completed: "Completed",
  completed_with_errors: "Completed with errors",
  failed: "Failed",
  archived: "Archived",
};

const AUDIENCE_LABELS: Record<string, string> = {
  all: "All Members",
  all_members: "All Members",
  specific_members: "Specific Members",
  students: "Students",
  parents: "Parents",
  ballet_families: "Ballet Families",
  class_participants: "Class Participants",
  package_holders: "Package Holders",
};

export function CampaignDetailDialog({
  campaignId,
  onOpenChange,
  canSend,
  canDelete,
  onResume,
  onArchive,
  isResuming,
  isArchiving,
}: {
  campaignId: number | null;
  onOpenChange: (open: boolean) => void;
  canSend: boolean;
  canDelete: boolean;
  onResume: (id: number) => void;
  onArchive: (id: number) => void;
  isResuming: boolean;
  isArchiving: boolean;
}) {
  const { data: campaign, isLoading, isError } = useCampaignDetail(campaignId);

  return (
    <Dialog open={campaignId != null} onOpenChange={(open) => { if (!open) onOpenChange(false); }}>
      <DialogContent className="admin2-ops-dialog max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="dialog-campaign-detail">
        {isLoading ? (
          <div className="py-10 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Loading campaign…</div>
        ) : isError || !campaign ? (
          <div className="py-10 text-center text-sm text-destructive">This campaign could not be loaded.</div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 flex-wrap">
                {campaign.title}
                <Badge variant={statusVariant(campaign.status)}>{STATUS_LABELS[campaign.status]}</Badge>
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 text-sm">
              <p className="text-muted-foreground">{campaign.body}</p>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Field label="Audience" value={AUDIENCE_LABELS[campaign.audienceType] ?? campaign.audienceType} />
                <Field label="Created by" value={campaign.createdByAdminName ?? (campaign.createdByAdminId ? "Former user" : "Unknown")} />
                <Field label="Created" value={new Date(campaign.createdAt).toLocaleString()} />
                <Field label="Sent at" value={campaign.sentAt ? new Date(campaign.sentAt).toLocaleString() : "—"} />
                <Field label="Send attempt" value={String(campaign.sendAttempt)} />
                <Field label="Reads" value={String(campaign.aggregate.reads)} />
              </div>

              <div className="rounded-lg border border-border bg-card p-4">
                <p className="font-semibold mb-3">Delivery summary</p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Metric label="Intended recipients" value={campaign.intendedRecipientCount} hint="snapshot" />
                  <Metric label="Push-enabled accounts" value={campaign.pushEnabledAccountCount} hint="snapshot" />
                  <Metric label="Active devices at snapshot" value={campaign.activeDeviceCount} hint="snapshot" />
                  <Metric label="No-device accounts" value={campaign.noDeviceAccountCount} hint="snapshot" />
                  <Metric label="Attempted devices" value={campaign.aggregate.attemptedDevices} hint="delivery" />
                  <Metric label="Sent devices" value={campaign.aggregate.sentDevices} hint="delivery" />
                  <Metric label="Failed devices" value={campaign.aggregate.failedDevices} hint="delivery" />
                  <Metric label="Reads" value={campaign.aggregate.reads} hint="ongoing" />
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  "Snapshot" counts were frozen the moment this campaign sent. "Delivery" counts reflect what actually happened, which can differ if a device's state changed afterward. A device being sent does not mean it was read.
                </p>
              </div>

              {campaign.aggregate.errorGroups.length > 0 && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                  <p className="font-semibold mb-2 flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-destructive" /> Delivery issues</p>
                  <ul className="space-y-1 text-sm">
                    {campaign.aggregate.errorGroups.map((group) => (
                      <li key={group.errorCode ?? "unknown"} className="flex items-center justify-between">
                        <span>{ERROR_CODE_LABELS[group.errorCode ?? ""] ?? group.errorCode ?? "Unknown error"}</span>
                        <Badge variant="destructive">{group.count}</Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {campaign.status === "sending" && campaign.canResume && canSend && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 space-y-2">
                  <p className="font-medium text-amber-700 dark:text-amber-400">Delivery appears interrupted. Resume remaining recipients?</p>
                  <p className="text-xs text-muted-foreground">Devices that already received this Push will not be sent again — only remaining recipients are attempted.</p>
                  <Button size="sm" variant="outline" disabled={isResuming} onClick={() => onResume(campaign.id)} data-testid="button-resume-campaign">
                    {isResuming ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-2 h-3.5 w-3.5" />}
                    Resume
                  </Button>
                </div>
              )}
              {campaign.status === "sending" && !campaign.canResume && (
                <p className="text-xs text-muted-foreground">This campaign is actively sending. Resume becomes available only if delivery appears to have stopped.</p>
              )}

              {canDelete && campaign.status !== "archived" && campaign.status !== "draft" && (
                <Button size="sm" variant="outline" disabled={isArchiving} onClick={() => onArchive(campaign.id)} data-testid="button-archive-campaign">
                  {isArchiving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Archive className="mr-2 h-3.5 w-3.5" />}
                  Archive
                </Button>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function statusVariant(status: CampaignStatus): "default" | "secondary" | "destructive" | "outline" {
  if (status === "completed") return "default";
  if (status === "failed" || status === "completed_with_errors") return "destructive";
  if (status === "archived") return "outline";
  return "secondary";
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: number; hint: "snapshot" | "delivery" | "ongoing" }) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/30 p-3">
      <div className="text-xl font-semibold">{value.toLocaleString()}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{hint}</div>
    </div>
  );
}
