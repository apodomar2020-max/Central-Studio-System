/**
 * Manual Push Campaign — shared enums (Wave 2) and audience contract
 * (Wave 3).
 *
 * Canonical, single-source-of-truth definitions, following the same
 * pattern as NOTIFICATION_SOURCES (notifications.ts) and
 * BALLET_APPLICATION_STATUSES (ballet.ts) — defined here so frontend and
 * backend packages import the exact same literals/schemas.
 */
import * as zod from "zod";

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
 * Audience types the resolver can safely act on.
 *
 * "all" is Wave 2's original (and, until Wave 3, only) value — kept here
 * forever as a resolvable legacy alias of "all_members" (identical
 * resolution semantics) so any campaign row that already has
 * audience_type='all' keeps working exactly as it always did. It is
 * intentionally EXCLUDED from NOTIFICATION_CAMPAIGN_CREATABLE_AUDIENCE_TYPES
 * below — no new campaign is ever created or edited with it — "all_members"
 * is its canonical replacement per the Wave 3 contract. The DB CHECK
 * constraint on this column (migration 0104, widened by migration 0106)
 * mirrors this full list, consistent with the project's enum-like-column
 * convention.
 *
 * The other seven are the Wave 3 audience contract:
 *   all_members         — every student account (see notificationCampaignAudience.ts)
 *   specific_members     — an explicit, admin-selected set of account IDs
 *   students             — accountType 'student' (incl. legacy NULL)
 *   parents               — accountType 'parent'
 *   ballet_families       — parent/owner of at least one child with a
 *                           currently-active ballet_level_assignments row
 *   class_participants   — confirmed bookings for one class+schedule+occurrence
 *   package_holders       — active, non-expired, credit-remaining regular
 *                           Studio package_orders (Ballet packages excluded)
 */
export const NOTIFICATION_CAMPAIGN_AUDIENCE_TYPES = [
  "all",
  "all_members",
  "specific_members",
  "students",
  "parents",
  "ballet_families",
  "class_participants",
  "package_holders",
] as const;

export type NotificationCampaignAudienceType = (typeof NOTIFICATION_CAMPAIGN_AUDIENCE_TYPES)[number];

/** Audience types a NEW or EDITED campaign may be saved with — "all" is deliberately omitted, see the doc comment above. */
export const NOTIFICATION_CAMPAIGN_CREATABLE_AUDIENCE_TYPES = [
  "all_members",
  "specific_members",
  "students",
  "parents",
  "ballet_families",
  "class_participants",
  "package_holders",
] as const satisfies readonly NotificationCampaignAudienceType[];

export type NotificationCampaignCreatableAudienceType = (typeof NOTIFICATION_CAMPAIGN_CREATABLE_AUDIENCE_TYPES)[number];

/** Per-recipient rollup status within a campaign's frozen snapshot. */
export const NOTIFICATION_CAMPAIGN_RECIPIENT_STATUSES = [
  "pending",
  "sent",
  "failed",
  "no_device",
] as const;

export type NotificationCampaignRecipientStatus = (typeof NOTIFICATION_CAMPAIGN_RECIPIENT_STATUSES)[number];

// ─── Wave 3: per-audience audienceConfig schemas ─────────────────────────────
//
// One strict (unknown-key-rejecting) schema per audience type — the single
// server-side authority for what a valid audienceConfig looks like for that
// type. Used identically by:
//   - the create/update campaign routes (reject malformed config with 400
//     before anything is persisted)
//   - the audience resolver (defense in depth — re-validates whatever is
//     already stored, so a resolver bug can never silently trust a
//     malformed row)
// Broad/implicit audiences (all_members, students, parents, ballet_families)
// intentionally accept an EMPTY object only — there is nothing to configure,
// and .strict() means any extra field is rejected rather than silently
// ignored, so a client can never smuggle unused data through.

/** all_members / legacy all — no configuration. */
export const NotificationCampaignAllMembersConfigSchema = zod.object({}).strict();

/**
 * specific_members — an explicit set of account (student) IDs, the ONLY
 * audience type where the client supplies identity directly. Empty
 * selections are rejected (400) rather than silently treated as "nobody" or
 * "everybody" — a campaign with zero chosen recipients is never a
 * meaningful send, and treating it as "everybody" would be a dangerous
 * silent audience-widening bug. IDs are deduplicated by the resolver, not
 * here (this schema only guarantees "a non-empty array of positive
 * integers" — server-side existence + identity-kind checks happen in the
 * resolver, which is what makes "child IDs cannot become independent
 * recipient accounts" and "nonexistent ID" handling possible).
 */
export const NotificationCampaignSpecificMembersConfigSchema = zod.object({
  studentIds: zod.array(zod.number().int().positive()).min(1, "studentIds must include at least one account id"),
}).strict();

/** students — accountType 'student' (including legacy NULL). No configuration. */
export const NotificationCampaignStudentsConfigSchema = zod.object({}).strict();

/** parents — accountType 'parent'. No configuration. */
export const NotificationCampaignParentsConfigSchema = zod.object({}).strict();

/** ballet_families — parent/owner of a child with a currently-active ballet enrollment. No configuration. */
export const NotificationCampaignBalletFamiliesConfigSchema = zod.object({}).strict();

/**
 * class_participants — targets ONE concrete occurrence (Class → Schedule →
 * Occurrence Date), never an entire historical class. The three IDs are the
 * minimum canonical identifiers needed to reproduce that occurrence safely
 * at both preview and send time — see notificationCampaignAudience.ts's
 * validateClassParticipantsConfig for the additional async checks (schedule
 * belongs to class, schedule is active, occurrenceDate is a real projected
 * date for that schedule) this shape alone cannot express.
 */
export const NotificationCampaignClassParticipantsConfigSchema = zod.object({
  classId: zod.number().int().positive(),
  scheduleId: zod.number().int().positive(),
  occurrenceDate: zod.string().regex(/^\d{4}-\d{2}-\d{2}$/, "occurrenceDate must be an ISO calendar date (YYYY-MM-DD)"),
}).strict();

/**
 * package_holders — regular Studio packages only (Ballet subscriptions are
 * a separate domain and are never included). Two modes, discriminated on
 * `scope`: every active holder, or holders of one specific price package.
 */
export const NotificationCampaignPackageHoldersConfigSchema = zod.discriminatedUnion("scope", [
  zod.object({ scope: zod.literal("all_active") }).strict(),
  zod.object({ scope: zod.literal("package"), packageId: zod.number().int().positive() }).strict(),
]);

/** Canonical map: audienceType → its strict Zod config schema. Includes the legacy "all" alias (same empty shape as all_members). */
export const NOTIFICATION_CAMPAIGN_AUDIENCE_CONFIG_SCHEMAS = {
  all: NotificationCampaignAllMembersConfigSchema,
  all_members: NotificationCampaignAllMembersConfigSchema,
  specific_members: NotificationCampaignSpecificMembersConfigSchema,
  students: NotificationCampaignStudentsConfigSchema,
  parents: NotificationCampaignParentsConfigSchema,
  ballet_families: NotificationCampaignBalletFamiliesConfigSchema,
  class_participants: NotificationCampaignClassParticipantsConfigSchema,
  package_holders: NotificationCampaignPackageHoldersConfigSchema,
} as const satisfies Record<NotificationCampaignAudienceType, zod.ZodTypeAny>;

export type NotificationCampaignAudienceConfigByType = {
  all: zod.infer<typeof NotificationCampaignAllMembersConfigSchema>;
  all_members: zod.infer<typeof NotificationCampaignAllMembersConfigSchema>;
  specific_members: zod.infer<typeof NotificationCampaignSpecificMembersConfigSchema>;
  students: zod.infer<typeof NotificationCampaignStudentsConfigSchema>;
  parents: zod.infer<typeof NotificationCampaignParentsConfigSchema>;
  ballet_families: zod.infer<typeof NotificationCampaignBalletFamiliesConfigSchema>;
  class_participants: zod.infer<typeof NotificationCampaignClassParticipantsConfigSchema>;
  package_holders: zod.infer<typeof NotificationCampaignPackageHoldersConfigSchema>;
};
