/**
 * Notifications Wave 4 — Marketing → Manual Push Notifications.
 *
 * Replaces the legacy raw-notifications composer (TARGETS = all/studio/stage,
 * GET /notifications) entirely. This page shows and manages ONLY
 * intentional, Admin-created Manual Push Campaigns from
 * notification_campaigns — system/automation/transactional notifications
 * (booking events, attendance, class reminders, package lifecycle, Ballet
 * lifecycle, schedule events, worker/automation) never appear here. Those
 * records are untouched, still part of the operational notification system
 * and mobile history; System-side delivery visibility is Wave 5's job
 * (System → Logs → Notification Delivery), not this page's.
 *
 * One logical campaign = one row — never one row per recipient. Preview and
 * send always go through the campaign API's own canonical resolver
 * (previewCampaignAudience / sendCampaign) — this page never constructs a
 * recipient list itself, and only ever sends explicit IDs for
 * specific_members (the one audience type where the admin picks identity
 * directly).
 */
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Edit, Trash2, Eye, Send, Archive as ArchiveIcon } from "lucide-react";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { useAdminConfirm } from "@/components/admin/admin-confirm";
import { useToast } from "@/hooks/use-toast";
import { CampaignComposerDialog } from "@/components/admin/campaign-composer-dialog";
import { CampaignDetailDialog } from "@/components/admin/campaign-detail-dialog";
import { CampaignSendConfirmDialog } from "@/components/admin/campaign-send-confirm-dialog";
import {
  useListCampaigns,
  useDeleteCampaign,
  useArchiveCampaign,
  useSendCampaign,
  useResumeCampaign,
  fetchCampaignPreview,
  type AudiencePreview,
  type CampaignStatus,
  type NotificationCampaign,
  type CreatableAudienceType,
} from "@/lib/notificationCampaigns";
import "./admin2-final.css";

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

function statusVariant(status: CampaignStatus): "default" | "secondary" | "destructive" | "outline" {
  if (status === "completed") return "default";
  if (status === "failed" || status === "completed_with_errors") return "destructive";
  if (status === "archived") return "outline";
  return "secondary";
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timeout);
  }, [value, delayMs]);
  return debounced;
}

function errorText(error: unknown, fallback: string): string {
  const value = error as { data?: { error?: string }; message?: string };
  return value?.data?.error ?? value?.message ?? fallback;
}

const PAGE_SIZE = 25;

export default function Notifications() {
  const { can } = useAdminAuth();
  const confirmAction = useAdminConfirm();
  const { toast } = useToast();
  const canCreate = can("notifications", "create");
  const canSend = can("notifications", "send");
  const canDelete = can("notifications", "delete");

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<CampaignStatus | "all">("all");
  const [audienceFilter, setAudienceFilter] = useState<string>("all");
  const [includeArchived, setIncludeArchived] = useState(false);
  const debouncedSearch = useDebouncedValue(search.trim(), 300);

  const [composerOpen, setComposerOpen] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<NotificationCampaign | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [sendTarget, setSendTarget] = useState<{ campaign: NotificationCampaign; preview: AudiencePreview } | null>(null);
  const [isLoadingSendPreview, setIsLoadingSendPreview] = useState<number | null>(null);
  const [pollingId, setPollingId] = useState<number | null>(null);

  useEffect(() => { setPage(1); }, [debouncedSearch, statusFilter, audienceFilter, includeArchived]);

  const listParams = {
    page,
    limit: PAGE_SIZE,
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(statusFilter !== "all" ? { status: statusFilter } : {}),
    ...(audienceFilter !== "all" ? { audienceType: audienceFilter as CreatableAudienceType } : {}),
    includeArchived,
  };
  const { data, isLoading, isError, refetch } = useListCampaigns(listParams, {
    refetchInterval: pollingId != null ? 2000 : false,
  });
  const campaigns = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 0;

  // Wave 4 review fix: the underlying result set can shrink without the
  // admin ever touching a filter (e.g. archiving the last remaining
  // campaign on the current page) — without this guard, `page` would stay
  // stuck past `totalPages`, showing a misleading "no campaigns match
  // these filters" empty state instead of the real content one page back.
  useEffect(() => {
    if (totalPages > 0 && page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  // Stop polling once the campaign we were watching leaves "sending".
  useEffect(() => {
    if (pollingId == null) return;
    const row = campaigns.find((c) => c.id === pollingId);
    if (row && row.status !== "sending") setPollingId(null);
  }, [campaigns, pollingId]);

  const deleteCampaign = useDeleteCampaign();
  const archiveCampaign = useArchiveCampaign();
  const sendCampaign = useSendCampaign();
  const resumeCampaign = useResumeCampaign();

  const openCreate = () => { setEditingCampaign(null); setComposerOpen(true); };
  const openEdit = (c: NotificationCampaign) => { setEditingCampaign(c); setComposerOpen(true); };

  const handleDelete = async (c: NotificationCampaign) => {
    if (await confirmAction({ title: "Delete draft campaign?", description: `"${c.title}" will be permanently removed. This cannot be undone.`, confirmLabel: "Delete draft" })) {
      try {
        await deleteCampaign.mutateAsync(c.id);
        toast({ title: "Draft deleted" });
      } catch (error) {
        toast({ title: "Could not delete draft", description: errorText(error, "Please try again."), variant: "destructive" });
      }
    }
  };

  const handleArchive = async (id: number) => {
    if (await confirmAction({ title: "Archive campaign?", description: "History, reads, and delivery logs are retained — this only hides it from the active list.", confirmLabel: "Archive", destructive: false })) {
      try {
        await archiveCampaign.mutateAsync(id);
        toast({ title: "Campaign archived" });
        setDetailId(null);
      } catch (error) {
        toast({ title: "Could not archive campaign", description: errorText(error, "Please try again."), variant: "destructive" });
      }
    }
  };

  const openSendConfirm = async (c: NotificationCampaign) => {
    setIsLoadingSendPreview(c.id);
    try {
      const preview = await fetchCampaignPreview(c.id);
      setSendTarget({ campaign: c, preview });
    } catch (error) {
      toast({ title: "Could not preview this audience", description: errorText(error, "Please try again."), variant: "destructive" });
    } finally {
      setIsLoadingSendPreview(null);
    }
  };

  const handleConfirmSend = async () => {
    if (!sendTarget) return;
    const id = sendTarget.campaign.id;
    setPollingId(id); // start reflecting "sending" as soon as the backend transitions, regardless of how long the HTTP request itself takes
    try {
      const result = await sendCampaign.mutateAsync(id);
      setSendTarget(null);
      await refetch();
      const label = result.status === "completed" ? "Campaign sent" : result.status === "completed_with_errors" ? "Campaign sent with some delivery errors" : "Campaign send failed";
      toast({ title: label, variant: result.status === "failed" ? "destructive" : undefined });
    } catch (error) {
      toast({ title: "Send failed", description: errorText(error, "Please try again."), variant: "destructive" });
    } finally {
      setPollingId(null);
    }
  };

  const handleResume = async (id: number) => {
    if (!(await confirmAction({ title: "Resume delivery?", description: "Delivery appears interrupted. Resume remaining recipients? Devices that already received this Push will not be sent again.", confirmLabel: "Resume", destructive: false }))) return;
    setPollingId(id);
    try {
      const result = await resumeCampaign.mutateAsync(id);
      toast({ title: result.status === "completed" ? "Resume completed" : "Resume finished with errors", variant: result.status === "failed" ? "destructive" : undefined });
    } catch (error) {
      toast({ title: "Could not resume campaign", description: errorText(error, "Please try again."), variant: "destructive" });
    } finally {
      setPollingId(null);
    }
  };

  return (
    <div className="admin2-final-page admin2-marketing-registry space-y-6">
      <PageHeader
        title="Manual Push Notifications"
        description="Intentional, Admin-created Push campaigns to your community. System, automation, and transactional notifications are not managed here."
        mode="general"
        addLabel="New Campaign"
        addTestId="button-add-campaign"
        onAdd={canCreate ? openCreate : undefined}
      />

      <div className="admin2-command-bar flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by title…"
          className="w-full sm:w-64"
          data-testid="input-campaign-search"
        />
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as CampaignStatus | "all")}>
          <SelectTrigger className="w-40" data-testid="select-status-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {(Object.keys(STATUS_LABELS) as CampaignStatus[]).map((s) => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={audienceFilter} onValueChange={setAudienceFilter}>
          <SelectTrigger className="w-44" data-testid="select-audience-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All audiences</SelectItem>
            {Object.entries(AUDIENCE_LABELS).filter(([key]) => key !== "all").map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} data-testid="checkbox-include-archived" />
          Include archived
        </label>
      </div>

      <div className="admin2-people-registry">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Audience</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Recipients</TableHead>
              <TableHead>Sent</TableHead>
              <TableHead>Failed</TableHead>
              <TableHead>No Device</TableHead>
              <TableHead>Sent At</TableHead>
              <TableHead>Created By</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={10} className="text-center py-8">Loading…</TableCell></TableRow>
            ) : isError ? (
              <TableRow><TableCell colSpan={10} className="text-center py-8 text-destructive">Campaigns could not be loaded. Try again in a moment.</TableCell></TableRow>
            ) : campaigns.length === 0 ? (
              <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground" data-testid="text-empty-campaigns">
                {debouncedSearch || statusFilter !== "all" || audienceFilter !== "all" ? "No campaigns match these filters." : "No campaigns yet. Create your first Manual Push Notification."}
              </TableCell></TableRow>
            ) : (
              campaigns.map((c) => (
                <TableRow key={c.id} data-testid={`row-campaign-${c.id}`}>
                  <TableCell className="font-medium max-w-[220px] truncate">{c.title}</TableCell>
                  <TableCell><Badge variant="outline">{AUDIENCE_LABELS[c.audienceType] ?? c.audienceType}</Badge></TableCell>
                  <TableCell><Badge variant={statusVariant(c.status)} data-testid={`badge-status-${c.id}`}>{STATUS_LABELS[c.status]}</Badge></TableCell>
                  <TableCell>{c.intendedRecipientCount}</TableCell>
                  <TableCell>{c.sentDeviceCount}</TableCell>
                  <TableCell>{c.failedDeviceCount > 0 ? <span className="text-destructive">{c.failedDeviceCount}</span> : c.failedDeviceCount}</TableCell>
                  <TableCell>{c.noDeviceAccountCount}</TableCell>
                  <TableCell>{c.sentAt ? new Date(c.sentAt).toLocaleDateString() : "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{c.createdByAdminName ?? (c.createdByAdminId ? "Former user" : "Unknown")}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button variant="ghost" size="icon" aria-label={`View ${c.title}`} title="View details" data-testid={`button-view-campaign-${c.id}`} onClick={() => setDetailId(c.id)}>
                      <Eye className="h-4 w-4" />
                    </Button>
                    {canCreate && c.status === "draft" && (
                      <Button variant="ghost" size="icon" aria-label={`Edit ${c.title}`} title="Edit draft" data-testid={`button-edit-campaign-${c.id}`} onClick={() => openEdit(c)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                    )}
                    {canSend && (c.status === "draft" || c.status === "ready") && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Send ${c.title}`}
                        title="Send campaign"
                        data-testid={`button-send-campaign-${c.id}`}
                        disabled={isLoadingSendPreview === c.id}
                        onClick={() => openSendConfirm(c)}
                      >
                        <Send className="h-4 w-4" />
                      </Button>
                    )}
                    {canDelete && c.status === "draft" && (
                      <Button variant="ghost" size="icon" aria-label={`Delete ${c.title}`} title="Delete draft" data-testid={`button-delete-campaign-${c.id}`} onClick={() => handleDelete(c)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                    {canDelete && c.status !== "draft" && c.status !== "archived" && (
                      <Button variant="ghost" size="icon" aria-label={`Archive ${c.title}`} title="Archive campaign" data-testid={`button-archive-campaign-${c.id}`} onClick={() => handleArchive(c.id)}>
                        <ArchiveIcon className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="admin2-registry-pagination flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-muted-foreground">
          {total > 0 ? `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total.toLocaleString()} campaigns` : "No campaigns"}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={page <= 1 || isLoading} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
          <span className="text-sm text-muted-foreground">Page {page} of {Math.max(totalPages, 1)}</span>
          <Button type="button" variant="outline" size="sm" disabled={totalPages === 0 || page >= totalPages || isLoading} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</Button>
        </div>
      </div>

      <CampaignComposerDialog open={composerOpen} onOpenChange={setComposerOpen} editing={editingCampaign} canSend={canSend} />

      <CampaignDetailDialog
        campaignId={detailId}
        onOpenChange={(open) => { if (!open) setDetailId(null); }}
        canSend={canSend}
        canDelete={canDelete}
        onResume={handleResume}
        onArchive={handleArchive}
        isResuming={resumeCampaign.isPending}
        isArchiving={archiveCampaign.isPending}
      />

      <CampaignSendConfirmDialog
        open={sendTarget != null}
        onOpenChange={(open) => { if (!open) setSendTarget(null); }}
        audienceType={sendTarget?.campaign.audienceType ?? null}
        preview={sendTarget?.preview ?? null}
        isSending={sendCampaign.isPending}
        onConfirm={handleConfirmSend}
      />
    </div>
  );
}
