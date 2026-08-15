/**
 * Notifications Wave 2 — Manual Push Campaign core: audience resolution
 * (baseline "all" only), the frozen recipient snapshot, the send pipeline,
 * and live aggregate derivation for campaign detail.
 *
 * Deliberately separate from lib/notifications.ts (Wave 1's shared
 * student/broadcast notification helpers) and lib/pushNotifications.ts
 * (Expo delivery mechanics, which this module calls into via
 * sendCampaignPushNotification) — this file owns the *campaign* concerns
 * specifically: what "sendable", "frozen", and "aggregate result" mean for
 * one logical Manual Push Campaign.
 */
import { and, count, countDistinct, eq, sql } from "drizzle-orm";
import {
  db,
  notificationCampaignRecipientsTable,
  notificationCampaignsTable,
  notificationDeliveryLogsTable,
  notificationDevicesTable,
  notificationReadReceiptsTable,
  notificationsTable,
  studentsTable,
  type NotificationCampaign,
} from "@workspace/db";
import {
  NOTIFICATION_CAMPAIGN_SENDABLE_STATUSES,
  type NotificationCampaignStatus,
} from "@workspace/api-zod";
import { logger } from "./logger";
import { sendCampaignPushNotification } from "./pushNotifications";

export class NotificationCampaignError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "NotificationCampaignError";
  }
}

export type AudiencePreview = {
  matchedAccounts: number;
  pushEnabledAccounts: number;
  activeDevices: number;
  noActiveDeviceAccounts: number;
};

/**
 * Wave 2 supports exactly one audience type ("all" — every student
 * account). Segmented audiences (Specific Members, Students, Parents,
 * Ballet Families, Class Participants, Package Holders) are Wave 3+; this
 * function is the single place that widens when they land, so preview and
 * send can never drift onto different resolution logic.
 */
function assertSupportedAudience(audienceType: string): void {
  if (audienceType !== "all") {
    throw new NotificationCampaignError(
      "UNSUPPORTED_AUDIENCE_TYPE",
      `audienceType "${audienceType}" is not supported yet — Wave 2 only supports "all"`,
    );
  }
}

/**
 * Server-calculated preview — the SAME resolver semantics send() uses
 * (both are "all accounts" today), but this never writes anything. No
 * per-account list is returned, only counts, so a broad-segment preview
 * cannot be used to enumerate PII.
 */
export async function previewCampaignAudience(
  campaign: Pick<NotificationCampaign, "audienceType">,
): Promise<AudiencePreview> {
  assertSupportedAudience(campaign.audienceType);

  const [{ matchedAccounts }] = await db.select({ matchedAccounts: count() }).from(studentsTable);
  const [{ pushEnabledAccounts, activeDevices }] = await db
    .select({
      pushEnabledAccounts: countDistinct(notificationDevicesTable.studentId),
      activeDevices: count(),
    })
    .from(notificationDevicesTable)
    .where(and(
      eq(notificationDevicesTable.provider, "expo"),
      eq(notificationDevicesTable.isActive, true),
    ));

  return {
    matchedAccounts,
    pushEnabledAccounts,
    activeDevices,
    noActiveDeviceAccounts: Math.max(0, matchedAccounts - pushEnabledAccounts),
  };
}

export type FrozenRecipient = {
  id: number;
  studentId: number;
  hadActiveDeviceAtSnapshot: boolean;
  activeDeviceCountAtSnapshot: number;
};

/**
 * THE architectural core of Wave 2: freezes the recipient snapshot inside
 * the caller's transaction, in one set-based INSERT…SELECT (not an
 * app-side loop over fetched account ids) so the audience is resolved and
 * persisted atomically, with memory bounded by the RETURNING result set
 * rather than by holding the whole audience in JS twice.
 *
 * Idempotent per (campaignId, studentId) via the unique index — safe to
 * call at most once per campaign in practice (send() only calls this
 * inside the single send transaction), but ON CONFLICT DO NOTHING means a
 * hypothetical retry can never duplicate a recipient row.
 *
 * assertSupportedAudience() above is the single gate before this runs —
 * Wave 3 widens the SELECT below (or dispatches to a per-audienceType
 * query) when segmented audiences land; nothing else about this function's
 * shape needs to change.
 */
async function freezeCampaignRecipients(
  tx: Pick<typeof db, "execute">,
  campaignId: number,
  audienceType: string,
): Promise<FrozenRecipient[]> {
  assertSupportedAudience(audienceType);

  const result = await tx.execute(sql`
    insert into notification_campaign_recipients
      (campaign_id, student_id, status, had_active_device_at_snapshot, active_device_count_at_snapshot)
    select
      ${campaignId},
      s.id,
      'pending',
      coalesce(d.device_count, 0) > 0,
      coalesce(d.device_count, 0)
    from students s
    left join (
      select student_id, count(*)::int as device_count
      from notification_devices
      where provider = 'expo' and is_active = true
      group by student_id
    ) d on d.student_id = s.id
    on conflict (campaign_id, student_id) do nothing
    returning id, student_id as "studentId",
      had_active_device_at_snapshot as "hadActiveDeviceAtSnapshot",
      active_device_count_at_snapshot as "activeDeviceCountAtSnapshot"
  `);

  return (result.rows as Array<{
    id: number;
    studentId: number;
    hadActiveDeviceAtSnapshot: boolean;
    activeDeviceCountAtSnapshot: number;
  }>);
}

/**
 * Two of these fields are SNAPSHOT-TIME facts and three are DELIVERY-TIME
 * outcomes — they describe different moments and are not required to add
 * up against each other. This is intentional, not a bug: delivery always
 * queries live device state (see sendCampaignPushNotification), so a
 * recipient who logs out between freeze and delivery is correctly skipped
 * even though the snapshot says they had a device, and a recipient who
 * registers a device in that same window correctly still receives the
 * push even though the snapshot says they didn't have one yet.
 *
 *   intendedRecipientCount, pushEnabledAccountCount, activeDeviceCount,
 *   noDeviceAccountCount  — frozen at snapshot time (send-transaction
 *     commit). `pushEnabledAccountCount + noDeviceAccountCount` always
 *     equals `intendedRecipientCount` — that invariant holds within this
 *     group.
 *
 *   sentDeviceCount, failedDeviceCount — actual delivery-time outcomes
 *     against whatever devices were active when each recipient's batch was
 *     processed. `sentDeviceCount + failedDeviceCount` is the true
 *     attempted-device count for this send — it will NOT generally equal
 *     `activeDeviceCount` (the snapshot-time figure) if any recipient's
 *     device state changed in between. See
 *     notificationCampaigns.send.integration.test.ts's
 *     "snapshot vs delivery" tests for a concrete worked example of both
 *     directions of this divergence.
 */
export type CampaignSendResult = {
  status: Extract<NotificationCampaignStatus, "completed" | "completed_with_errors" | "failed">;
  intendedRecipientCount: number;
  pushEnabledAccountCount: number;
  activeDeviceCount: number;
  sentDeviceCount: number;
  failedDeviceCount: number;
  noDeviceAccountCount: number;
  truncated: boolean;
};

/**
 * The full send pipeline (Wave 2 report §9 explains why this is
 * synchronous-fire-and-forget from the route, not a new Worker job):
 *   1. validate sendable
 *   2-4. resolve + freeze the recipient snapshot (transactional)
 *   5. create the one canonical mobile-visible notification row
 *   6. transition campaign -> sending
 *   7. send Push to the frozen snapshot (Wave 1 batching, campaign-scoped)
 *   8. delivery outcomes already persisted per-device by sendToDevices,
 *      and rolled up onto each recipient row, inside step 7
 *   9. compute the aggregate result
 *   10. transition to completed / completed_with_errors / failed
 *
 * Exported directly (not only reachable via the HTTP route) so tests can
 * await the full pipeline deterministically instead of racing a
 * fire-and-forget dispatch.
 */
export async function sendCampaign(campaignId: number): Promise<CampaignSendResult> {
  const [campaign] = await db.select().from(notificationCampaignsTable).where(eq(notificationCampaignsTable.id, campaignId)).limit(1);
  if (!campaign) {
    throw new NotificationCampaignError("NOT_FOUND", `Campaign ${campaignId} not found`);
  }
  if (!(NOTIFICATION_CAMPAIGN_SENDABLE_STATUSES as readonly string[]).includes(campaign.status)) {
    throw new NotificationCampaignError(
      "NOT_SENDABLE",
      `Campaign ${campaignId} is not sendable from status "${campaign.status}"`,
    );
  }

  const { notificationId, recipients } = await db.transaction(async (tx) => {
    const recipients = await freezeCampaignRecipients(tx, campaignId, campaign.audienceType);

    const [notificationRow] = await tx
      .insert(notificationsTable)
      .values({
        title: campaign.title,
        body: campaign.body,
        // New pattern (Wave 2) — visibility is resolved by joining the
        // frozen snapshot (routes/notifications.ts), not by pattern-matching
        // this string; it exists mainly for admin-side readability/debugging.
        target: `campaign:${campaignId}`,
        type: "manual_campaign",
        relatedEntityType: "notification_campaign",
        relatedEntityId: campaignId,
        source: "manual_admin",
        isDraft: false,
        sentAt: new Date().toISOString(),
      })
      .returning();

    await tx
      .update(notificationCampaignsTable)
      .set({ status: "sending", notificationId: notificationRow!.id, sentAt: new Date().toISOString() })
      .where(eq(notificationCampaignsTable.id, campaignId));

    return { notificationId: notificationRow!.id, recipients };
  });

  logger.info({ campaignId, notificationId, intendedRecipientCount: recipients.length }, "[CAMPAIGN] recipient snapshot frozen, sending");

  const pushResult = await sendCampaignPushNotification({
    campaignId,
    notificationId,
    title: campaign.title,
    body: campaign.body,
    data: { type: "manual_campaign", campaignId },
  });

  const intendedRecipientCount = recipients.length;
  const pushEnabledAccountCount = recipients.filter((r) => r.hadActiveDeviceAtSnapshot).length;
  const activeDeviceCount = recipients.reduce((sum, r) => sum + r.activeDeviceCountAtSnapshot, 0);
  const noDeviceAccountCount = intendedRecipientCount - pushEnabledAccountCount;
  const sentDeviceCount = pushResult.sent;
  const failedDeviceCount = pushResult.failed;

  // Deterministic from the send results, per the task's own requirement —
  // no ambiguity, no admin judgment call:
  //   no accounts ever had a device to attempt  -> completed (nothing failed)
  //   every attempted device failed              -> failed
  //   some succeeded, some failed                -> completed_with_errors
  //   everything that was attempted succeeded     -> completed
  // A truncated run (safety-cap hit) can never be reported as a clean
  // "completed" — see the `|| pushResult.truncated` branch below.
  let status: CampaignSendResult["status"];
  if (pushResult.truncated) {
    status = failedDeviceCount > 0 || sentDeviceCount === 0 ? "failed" : "completed_with_errors";
  } else if (pushEnabledAccountCount === 0) {
    status = "completed";
  } else if (sentDeviceCount === 0 && failedDeviceCount > 0) {
    status = "failed";
  } else if (failedDeviceCount > 0) {
    status = "completed_with_errors";
  } else {
    status = "completed";
  }

  await db
    .update(notificationCampaignsTable)
    .set({
      status,
      intendedRecipientCount,
      pushEnabledAccountCount,
      activeDeviceCount,
      sentDeviceCount,
      failedDeviceCount,
      noDeviceAccountCount,
    })
    .where(eq(notificationCampaignsTable.id, campaignId));

  logger.info({ campaignId, notificationId, status, intendedRecipientCount, sentDeviceCount, failedDeviceCount, truncated: pushResult.truncated }, "[CAMPAIGN] send pipeline finished");

  return {
    status,
    intendedRecipientCount,
    pushEnabledAccountCount,
    activeDeviceCount,
    sentDeviceCount,
    failedDeviceCount,
    noDeviceAccountCount,
    truncated: pushResult.truncated,
  };
}

/**
 * Same snapshot-time-vs-delivery-time split as CampaignSendResult, re-derived
 * live rather than read from the cache — see that type's doc comment for the
 * full explanation. `intendedRecipients`/`pushEnabledAccounts`/
 * `activeDevices`/`noDeviceAccounts` are snapshot-time; `attemptedDevices`/
 * `sentDevices`/`failedDevices`/`errorGroups` are delivery-time. `reads` is
 * its own third category (post-delivery, ongoing indefinitely — see
 * countCampaignReads).
 */
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

/**
 * Live-derived campaign detail aggregate — deliberately does NOT read the
 * campaigns table's cached device/account counters (those exist only as a
 * write-once list-view optimization; see the schema file's doc comment).
 * Every number here comes straight from notification_campaign_recipients +
 * notification_delivery_logs + notification_read_receipts, so a caching
 * bug in the write-once columns can never surface here — this is the one
 * place an operator would actually go looking for the truth.
 */
export async function computeCampaignAggregate(campaignId: number): Promise<CampaignAggregate> {
  const [recipientCounts] = await db
    .select({
      intendedRecipients: count(),
      pushEnabledAccounts: sql<number>`count(*) filter (where ${notificationCampaignRecipientsTable.hadActiveDeviceAtSnapshot})::int`,
      activeDevices: sql<number>`coalesce(sum(${notificationCampaignRecipientsTable.activeDeviceCountAtSnapshot}), 0)::int`,
      noDeviceAccounts: sql<number>`count(*) filter (where not ${notificationCampaignRecipientsTable.hadActiveDeviceAtSnapshot})::int`,
    })
    .from(notificationCampaignRecipientsTable)
    .where(eq(notificationCampaignRecipientsTable.campaignId, campaignId));

  const [campaign] = await db
    .select({ notificationId: notificationCampaignsTable.notificationId })
    .from(notificationCampaignsTable)
    .where(eq(notificationCampaignsTable.id, campaignId))
    .limit(1);

  let sentDevices = 0;
  let failedDevices = 0;
  let attemptedDevices = 0;
  let reads = 0;
  const errorGroups: Array<{ errorCode: string | null; count: number }> = [];

  if (campaign?.notificationId != null) {
    const deliveryRows = await db
      .select({
        status: notificationDeliveryLogsTable.status,
        errorCode: notificationDeliveryLogsTable.errorCode,
        n: count(),
      })
      .from(notificationDeliveryLogsTable)
      .where(eq(notificationDeliveryLogsTable.notificationId, campaign.notificationId))
      .groupBy(notificationDeliveryLogsTable.status, notificationDeliveryLogsTable.errorCode);

    for (const row of deliveryRows) {
      if (row.status === "sent") sentDevices += row.n;
      if (row.status === "failed") {
        failedDevices += row.n;
        errorGroups.push({ errorCode: row.errorCode, count: row.n });
      }
    }
    attemptedDevices = sentDevices + failedDevices;

    // One account = one read, no matter how many devices they have — reads
    // are keyed by (notificationId, studentId), never by device, so this is
    // already a per-account count, not a per-device one. Bounded to the
    // frozen recipient set: a read from an account outside the snapshot
    // (impossible under the visibility join, but defensive regardless)
    // would never be counted here.
    const [{ readCount }] = await db
      .select({ readCount: countDistinct(notificationReadReceiptsTable.studentId) })
      .from(notificationReadReceiptsTable)
      .innerJoin(
        notificationCampaignRecipientsTable,
        and(
          eq(notificationCampaignRecipientsTable.campaignId, campaignId),
          eq(notificationCampaignRecipientsTable.studentId, notificationReadReceiptsTable.studentId),
        ),
      )
      .where(eq(notificationReadReceiptsTable.notificationId, campaign.notificationId));
    reads = readCount;
  }

  return {
    intendedRecipients: recipientCounts?.intendedRecipients ?? 0,
    pushEnabledAccounts: recipientCounts?.pushEnabledAccounts ?? 0,
    activeDevices: recipientCounts?.activeDevices ?? 0,
    attemptedDevices,
    sentDevices,
    failedDevices,
    noDeviceAccounts: recipientCounts?.noDeviceAccounts ?? 0,
    reads,
    errorGroups,
  };
}

/**
 * Campaign-level read count only (no per-device breakdown) — used by list
 * views that don't need the full aggregate. Same one-account-one-read
 * semantics as computeCampaignAggregate.
 */
export async function countCampaignReads(campaignId: number, notificationId: number | null): Promise<number> {
  if (notificationId == null) return 0;
  const [{ readCount }] = await db
    .select({ readCount: countDistinct(notificationReadReceiptsTable.studentId) })
    .from(notificationReadReceiptsTable)
    .innerJoin(
      notificationCampaignRecipientsTable,
      and(
        eq(notificationCampaignRecipientsTable.campaignId, campaignId),
        eq(notificationCampaignRecipientsTable.studentId, notificationReadReceiptsTable.studentId),
      ),
    )
    .where(eq(notificationReadReceiptsTable.notificationId, notificationId));
  return readCount;
}
