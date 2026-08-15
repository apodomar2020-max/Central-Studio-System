/**
 * Manual Push Campaign — shared enums (Wave 2).
 *
 * Canonical, single-source-of-truth definitions, following the same
 * pattern as NOTIFICATION_SOURCES (notifications.ts) and
 * BALLET_APPLICATION_STATUSES (ballet.ts) — defined here so frontend and
 * backend packages import the exact same literals.
 */

/**
 * Campaign lifecycle:
 *   draft → ready → sending → completed
 *                            ↘ completed_with_errors
 *                            ↘ failed
 *   (any non-terminal-forever state) → archived
 *
 * "ready" is reserved for a future wave's explicit "lock in and prepare to
 * send" step — Wave 2's send endpoint accepts "draft" directly and never
 * itself produces "ready". Included now so the CHECK constraint doesn't
 * need a migration when that step is added.
 */
export const NOTIFICATION_CAMPAIGN_STATUSES = [
  "draft",
  "ready",
  "sending",
  "completed",
  "completed_with_errors",
  "failed",
  "archived",
] as const;

export type NotificationCampaignStatus = (typeof NOTIFICATION_CAMPAIGN_STATUSES)[number];

/** Statuses from which draft content (title/body/audience) may still be edited. */
export const NOTIFICATION_CAMPAIGN_EDITABLE_STATUSES = ["draft"] as const satisfies readonly NotificationCampaignStatus[];

/** Statuses from which POST .../send is accepted. */
export const NOTIFICATION_CAMPAIGN_SENDABLE_STATUSES = ["draft", "ready"] as const satisfies readonly NotificationCampaignStatus[];

/** Statuses from which the campaign row itself may be hard-deleted (never after a send attempt). */
export const NOTIFICATION_CAMPAIGN_DELETABLE_STATUSES = ["draft"] as const satisfies readonly NotificationCampaignStatus[];

/**
 * Audience types the resolver can safely act on. Wave 2 supports only the
 * broad baseline audience ("all") to prove the campaign/snapshot/delivery
 * architecture end-to-end — the seven segmented audiences (Specific
 * Members, Students, Parents, Ballet Families, Class Participants, Package
 * Holders) are Wave 3+. The DB CHECK constraint on this column (migration
 * 0104) mirrors this list, consistent with the project's enum-like-column
 * convention; widening it in Wave 3 is an additive, non-destructive
 * constraint-replacement migration (same pattern as every other
 * project "_check" constraint) — it never requires touching historical rows.
 */
export const NOTIFICATION_CAMPAIGN_AUDIENCE_TYPES = ["all"] as const;

export type NotificationCampaignAudienceType = (typeof NOTIFICATION_CAMPAIGN_AUDIENCE_TYPES)[number];

/** Per-recipient rollup status within a campaign's frozen snapshot. */
export const NOTIFICATION_CAMPAIGN_RECIPIENT_STATUSES = [
  "pending",
  "sent",
  "failed",
  "no_device",
] as const;

export type NotificationCampaignRecipientStatus = (typeof NOTIFICATION_CAMPAIGN_RECIPIENT_STATUSES)[number];
