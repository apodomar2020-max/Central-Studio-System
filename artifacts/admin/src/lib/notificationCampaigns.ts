/**
 * Notifications Wave 4 — Manual Push Campaign data layer.
 *
 * Hand-written react-query hooks over customFetch, matching the established
 * escape-hatch pattern already used elsewhere in this codebase (see
 * notifications.tsx's pushStatus query, students.tsx's doc comment on
 * fields the generated client doesn't know about) for endpoints not yet in
 * the generated @workspace/api-client-react client. The notification-campaigns
 * routes (Wave 2/2.1/3) were never run through the client generator, so
 * this file is the minimal, safe alternative — never hand-edits any
 * generated file.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";

// ─── Types (mirrors the backend contract exactly — see
// artifacts/api-server/src/lib/notificationCampaigns.ts and
// notificationCampaignAudience.ts) ────────────────────────────────────────

export type CampaignStatus =
  | "draft"
  | "ready"
  | "sending"
  | "completed"
  | "completed_with_errors"
  | "failed"
  | "archived";

/** The seven Wave 3 segments a NEW/edited campaign may use. Legacy "all" is resolvable forever but never offered here. */
export type CreatableAudienceType =
  | "all_members"
  | "specific_members"
  | "students"
  | "parents"
  | "ballet_families"
  | "class_participants"
  | "package_holders";

export type AudienceType = CreatableAudienceType | "all";

export type SpecificMembersConfig = { studentIds: number[] };
export type ClassParticipantsConfig = { classId: number; scheduleId: number; occurrenceDate: string };
export type PackageHoldersConfig = { scope: "all_active" } | { scope: "package"; packageId: number };
export type AudienceConfig = Record<string, never> | SpecificMembersConfig | ClassParticipantsConfig | PackageHoldersConfig;

export type NotificationCampaign = {
  id: number;
  title: string;
  body: string;
  audienceType: AudienceType;
  audienceConfig: AudienceConfig | null;
  status: CampaignStatus;
  createdByAdminId: number | null;
  /** Wave 4 addition — see routes/notificationCampaigns.ts's LEFT JOIN. Null for a legacy row or a since-deleted admin. */
  createdByAdminName?: string | null;
  notificationId: number | null;
  previewedAt: string | null;
  sentAt: string | null;
  archivedAt: string | null;
  sendStartedAt: string | null;
  lastSendHeartbeatAt: string | null;
  sendAttempt: number;
  lastError: string | null;
  /**
   * Wave 4 review fix: server-computed (isCampaignStaleSending, same
   * threshold/semantics resumeCampaign() itself uses — see
   * notificationCampaigns.ts). The client must never reproduce this
   * configurable backend business rule itself; this field is the sole
   * source the UI reads to decide whether to offer Resume. Always present
   * on list and detail responses; false for anything not status='sending'.
   */
  canResume: boolean;
  intendedRecipientCount: number;
  pushEnabledAccountCount: number;
  activeDeviceCount: number;
  sentDeviceCount: number;
  failedDeviceCount: number;
  noDeviceAccountCount: number;
  createdAt: string;
  updatedAt: string;
};

export type CampaignListResponse = {
  data: NotificationCampaign[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export type CampaignAggregate = {
  intendedRecipients: number;
  pushEnabledAccounts: number;
  activeDevices: number;
  attemptedDevices: number;
  sentDevices: number;
  failedDevices: number;
  noDeviceAccounts: number;
  reads: number;
  errorGroups: Array<{ errorCode: string | null; count: number }>;
};

export type CampaignDetail = NotificationCampaign & { aggregate: CampaignAggregate };

export type AudiencePreview = {
  matchedAccounts: number;
  pushEnabledAccounts: number;
  activeDevices: number;
  noActiveDeviceAccounts: number;
};

export type CampaignSendResult = {
  status: Extract<CampaignStatus, "completed" | "completed_with_errors" | "failed">;
  intendedRecipientCount: number;
  pushEnabledAccountCount: number;
  activeDeviceCount: number;
  sentDeviceCount: number;
  failedDeviceCount: number;
  noDeviceAccountCount: number;
  truncated: boolean;
};

export type CampaignResumeResult = CampaignSendResult & {
  wasStale: boolean;
  sendAttempt: number;
  devicesPreviouslySent: number;
  devicesAttemptedThisRun: number;
  sentThisRun: number;
  failedThisRun: number;
  skippedAlreadySent: number;
  remainingRecipients: number;
};

export type CampaignApiError = { error: string; code?: string };

export type ListCampaignsParams = {
  page?: number;
  limit?: number;
  status?: CampaignStatus;
  audienceType?: AudienceType;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  includeArchived?: boolean;
};

function buildQueryString(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export const campaignKeys = {
  all: ["notification-campaigns"] as const,
  list: (params: ListCampaignsParams) => ["notification-campaigns", "list", params] as const,
  detail: (id: number) => ["notification-campaigns", "detail", id] as const,
};

// ─── Queries ──────────────────────────────────────────────────────────────────

export function useListCampaigns(params: ListCampaignsParams, options?: Partial<UseQueryOptions<CampaignListResponse>>) {
  return useQuery({
    queryKey: campaignKeys.list(params),
    queryFn: () => customFetch<CampaignListResponse>(`/api/notification-campaigns${buildQueryString(params)}`),
    ...options,
  });
}

export function useCampaignDetail(id: number | null, options?: Partial<UseQueryOptions<CampaignDetail>>) {
  return useQuery({
    queryKey: id != null ? campaignKeys.detail(id) : ["notification-campaigns", "detail", "none"],
    queryFn: () => customFetch<CampaignDetail>(`/api/notification-campaigns/${id}`),
    enabled: id != null,
    ...options,
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export type SaveCampaignInput = {
  title: string;
  body: string;
  audienceType: CreatableAudienceType;
  audienceConfig: AudienceConfig;
};

export function useCreateCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: SaveCampaignInput) =>
      customFetch<NotificationCampaign>("/api/notification-campaigns", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: campaignKeys.all }),
  });
}

export function useUpdateCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<SaveCampaignInput> }) =>
      customFetch<NotificationCampaign>(`/api/notification-campaigns/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: campaignKeys.all }),
  });
}

export function useDeleteCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => customFetch<void>(`/api/notification-campaigns/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: campaignKeys.all }),
  });
}

export function useArchiveCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => customFetch<NotificationCampaign>(`/api/notification-campaigns/${id}/archive`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: campaignKeys.all }),
  });
}

export function useSendCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => customFetch<CampaignSendResult>(`/api/notification-campaigns/${id}/send`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: campaignKeys.all }),
  });
}

export function useResumeCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => customFetch<CampaignResumeResult>(`/api/notification-campaigns/${id}/resume`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: campaignKeys.all }),
  });
}

/**
 * Preview is intentionally a plain async function, not a useQuery hook —
 * it is invoked imperatively (debounced, on audience-config change) from
 * the composer rather than driven by a stable query key, matching how the
 * backend itself treats it: a read-only, side-effect-free resolve that
 * never caches (a stale cached preview would be actively misleading, since
 * the whole point of Wave 3's architecture is that send() always re-resolves
 * fresh — see the composer's own doc comment).
 */
export async function fetchCampaignPreview(id: number): Promise<AudiencePreview> {
  return customFetch<AudiencePreview>(`/api/notification-campaigns/${id}/preview`, { method: "POST" });
}

// ─── Staleness (Wave 2.1 lease/resume) ───────────────────────────────────────
//
// Wave 4 review fix: staleness is now a server-computed field
// (NotificationCampaign.canResume — see isCampaignStaleSending in
// artifacts/api-server/src/lib/notificationCampaigns.ts). The client
// deliberately does NOT reproduce the configurable
// NOTIFICATION_CAMPAIGN_STALE_SENDING_MINUTES threshold itself anymore —
// there is no local isCampaignSafeToResume helper here on purpose. Read
// campaign.canResume directly wherever the Resume action is offered.
