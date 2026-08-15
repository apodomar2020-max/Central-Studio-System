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
import { LeaseLostError, sendCampaignPushNotification } from "./pushNotifications";

export class NotificationCampaignError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "NotificationCampaignError";
  }
}

// ─── Wave 2.1: recovery configuration ────────────────────────────────────────
//
// A "sending" campaign is stale only when its heartbeat (touched once per
// device page by sendCampaignPushNotification — see pushNotifications.ts)
// hasn't moved in this many minutes. This is deliberately NOT based on total
// elapsed time since sendStartedAt: a legitimately large/slow send keeps
// advancing its heartbeat every page, so it never looks stale no matter how
// long the whole run takes — only a run that has genuinely stopped
// progressing (crashed process) goes quiet long enough to cross this.
const STALE_SENDING_MINUTES_DEFAULT = 5;
function staleSendingThresholdMinutes(): number {
  const value = Number.parseInt(process.env["NOTIFICATION_CAMPAIGN_STALE_SENDING_MINUTES"] ?? String(STALE_SENDING_MINUTES_DEFAULT), 10);
  return Number.isFinite(value) && value > 0 ? value : STALE_SENDING_MINUTES_DEFAULT;
}

// Bounds total resume attempts for one campaign — the campaign-level analog
// of pushNotifications.ts's per-device attempt cap. Stops a campaign that
// keeps crashing for some unrelated systemic reason (e.g. a bad deploy)
// from remaining resumable forever; it terminates in "failed" instead.
const MAX_SEND_ATTEMPTS_DEFAULT = 5;
function maxCampaignSendAttempts(): number {
  const value = Number.parseInt(process.env["NOTIFICATION_CAMPAIGN_MAX_SEND_ATTEMPTS"] ?? String(MAX_SEND_ATTEMPTS_DEFAULT), 10);
  return Number.isFinite(value) && value > 0 ? value : MAX_SEND_ATTEMPTS_DEFAULT;
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

type RecipientSnapshotFacts = Pick<FrozenRecipient, "hadActiveDeviceAtSnapshot" | "activeDeviceCountAtSnapshot">;

/**
 * The TRUE cumulative per-device outcome across every attempt this
 * notification has ever had (original send + every resume) — a device
 * counts as "sent" if ANY of its log rows ever succeeded, regardless of how
 * many prior attempts failed; otherwise, if it was ever attempted at all,
 * it counts as "failed". This is what makes finalization correct after a
 * resume: pushResult.sent/failed from sendCampaignPushNotification is only
 * THIS RUN's delta, but the persisted campaign counters must reflect the
 * whole campaign's history, not just the latest run.
 */
async function computeFinalDeviceCounts(notificationId: number): Promise<{ sentDevices: number; failedDevices: number }> {
  const result = await db.execute(sql`
    select
      count(*) filter (where has_sent)::int as "sentDevices",
      count(*) filter (where not has_sent)::int as "failedDevices"
    from (
      select device_id, bool_or(status = 'sent') as has_sent
      from notification_delivery_logs
      where notification_id = ${notificationId} and device_id is not null
      group by device_id
    ) per_device
  `);
  const row = result.rows[0] as { sentDevices: number; failedDevices: number } | undefined;
  return { sentDevices: row?.sentDevices ?? 0, failedDevices: row?.failedDevices ?? 0 };
}

/**
 * Shared by both the initial sendCampaign() and resumeCampaign() — the one
 * place campaign status is decided, so the two paths can never drift onto
 * different finalization semantics. Snapshot-time counters come from the
 * (always fully re-fetched, never partial) recipient rows; delivery-time
 * counters come from computeFinalDeviceCounts's cumulative truth, not from
 * any single run's local pushResult.
 */
async function finalizeCampaignSend(
  campaignId: number,
  notificationId: number,
  recipients: RecipientSnapshotFacts[],
  truncated: boolean,
): Promise<CampaignSendResult> {
  const intendedRecipientCount = recipients.length;
  const pushEnabledAccountCount = recipients.filter((r) => r.hadActiveDeviceAtSnapshot).length;
  const activeDeviceCount = recipients.reduce((sum, r) => sum + r.activeDeviceCountAtSnapshot, 0);
  const noDeviceAccountCount = intendedRecipientCount - pushEnabledAccountCount;
  const { sentDevices: sentDeviceCount, failedDevices: failedDeviceCount } = await computeFinalDeviceCounts(notificationId);

  // Deterministic from the cumulative send results, per the task's own
  // requirement — no ambiguity, no admin judgment call:
  //   no accounts ever had a device to attempt  -> completed (nothing failed)
  //   every attempted device failed              -> failed
  //   some succeeded, some failed (whether from this run or an earlier one
  //   before a crash) -> completed_with_errors, never losing successful
  //   history from a prior run
  //   everything that was attempted succeeded     -> completed
  // A truncated run (safety-cap hit) can never be reported as a clean
  // "completed".
  let status: CampaignSendResult["status"];
  if (truncated) {
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
      lastError: null, // finalization succeeded — clear any stale diagnostic from a prior crashed attempt
    })
    .where(eq(notificationCampaignsTable.id, campaignId));

  return {
    status,
    intendedRecipientCount,
    pushEnabledAccountCount,
    activeDeviceCount,
    sentDeviceCount,
    failedDeviceCount,
    noDeviceAccountCount,
    truncated,
  };
}

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
 *
 * Wave 2.1: if the process crashes anywhere after this function's own
 * transaction commits (status already "sending", recipients frozen,
 * notification row created) but before finalizeCampaignSend() runs, the
 * campaign is left at "sending" with a heartbeat that will go stale — see
 * resumeCampaign() for how it gets recovered. This function itself does
 * NOT catch a mid-delivery exception and finalize as "failed": an
 * unexpected error here should leave the campaign recoverable, not
 * prematurely close it off.
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

    const now = new Date().toISOString();
    await tx
      .update(notificationCampaignsTable)
      .set({
        status: "sending",
        notificationId: notificationRow!.id,
        sentAt: now,
        sendStartedAt: now,
        lastSendHeartbeatAt: now,
        sendAttempt: 1,
      })
      .where(eq(notificationCampaignsTable.id, campaignId));

    return { notificationId: notificationRow!.id, recipients };
  });

  logger.info({ campaignId, notificationId, intendedRecipientCount: recipients.length }, "[CAMPAIGN] recipient snapshot frozen, sending");

  let pushResult;
  try {
    pushResult = await sendCampaignPushNotification({
      campaignId,
      notificationId,
      title: campaign.title,
      body: campaign.body,
      data: { type: "manual_campaign", campaignId },
      // The initial send transaction above always sets send_attempt = 1 —
      // that literal IS this sender's lease. See sendCampaignPushNotification's
      // doc comment and the Wave 2.1 concurrency review for the race this closes.
      leaseSendAttempt: 1,
    });
  } catch (error) {
    if (error instanceof LeaseLostError) {
      // Some concurrent resume has already reclaimed ownership of this
      // campaign — that resume (not this call) is responsible for
      // finishing and finalizing. Do NOT touch lastError or status here:
      // doing so could stomp the current owner's own diagnostic state or
      // race its finalization. Just surface a distinct, non-alarming
      // outcome to the caller.
      logger.warn({ campaignId, notificationId }, "[CAMPAIGN] initial send lost its lease to a concurrent resume — stopping without finalizing");
      throw new NotificationCampaignError("LEASE_LOST", `Campaign ${campaignId}'s send lease was reclaimed by a concurrent resume before this send finished.`);
    }
    // Leave status = "sending" — this is exactly the crash-recovery case
    // resumeCampaign() exists for. Record the diagnostic and let the caller
    // see the error too (the route's fire-and-forget dispatch logs it).
    await db.update(notificationCampaignsTable)
      .set({ lastError: error instanceof Error ? error.message : "Unknown error during campaign send" })
      .where(eq(notificationCampaignsTable.id, campaignId));
    throw error;
  }

  const result = await finalizeCampaignSend(campaignId, notificationId, recipients, pushResult.truncated);

  logger.info({
    campaignId, notificationId, status: result.status,
    intendedRecipientCount: result.intendedRecipientCount,
    sentDeviceCount: result.sentDeviceCount,
    failedDeviceCount: result.failedDeviceCount,
    truncated: pushResult.truncated,
  }, "[CAMPAIGN] send pipeline finished");

  return result;
}

export type CampaignResumeResult = CampaignSendResult & {
  /** Always true — resumeCampaign() only ever runs against a stale campaign; kept explicit for callers/logs. */
  wasStale: boolean;
  sendAttempt: number;
  /** THIS resume run's counters — see pushNotifications.ts's CampaignPushResult for exact definitions. */
  devicesPreviouslySent: number;
  devicesAttemptedThisRun: number;
  sentThisRun: number;
  failedThisRun: number;
  skippedAlreadySent: number;
  /** Recipients whose status is still 'pending' after this run — normally 0; non-zero only if a page was never reached (e.g. this run also got interrupted). */
  remainingRecipients: number;
};

/**
 * Recovers a campaign stuck at status="sending" — see the Wave 2.1 report's
 * "Recovery Architecture" section for the full design rationale. Exported
 * directly (not only reachable via the HTTP route) for the same testability
 * reason as sendCampaign().
 *
 * Ownership/locking (requirement: safe if invoked more than once, safe if
 * two attempts race): a single atomic conditional UPDATE below is what lets
 * a resume START — it proves the campaign's heartbeat was genuinely stale
 * and atomically claims it by incrementing send_attempt. Concurrency
 * review addendum (original sender vs resume sender): that claim alone
 * does NOT stop an original sender that is still alive but stalled past
 * the stale threshold (slow Expo/network call) from continuing to send
 * after this resume has already started — the claim only gates who is
 * ALLOWED TO START a resume, not whether an already-running sender must
 * stop. The send_attempt value THIS call claims (returned as `sendAttempt`
 * below) doubles as a durable ownership LEASE, passed into
 * sendCampaignPushNotification as leaseSendAttempt: every page that
 * function processes re-verifies (atomically, via
 * touchCampaignHeartbeatIfLeaseHeld) that send_attempt on the live row
 * still equals this lease immediately before dispatching to Expo — an
 * original sender that stalled and lost the lease to this resume gets
 * LeaseLostError the moment it next checks, before it can send another
 * device. See pushNotifications.ts's sendCampaignPushNotification doc
 * comment for the full race trace and residual-window analysis.
 *
 * No pg_advisory_lock is held across this function's lifetime (existing
 * project precedent for that primitive — attendanceReversalService.ts,
 * packageRefundService.ts, promotionService.ts, balletAutoAbsence.ts — is
 * always a single short transaction; holding a session-scoped advisory
 * lock across a delivery loop that can run for minutes and pages through
 * many separate statements would tie up one pooled connection for that
 * entire duration, which is a materially worse fit for this specific
 * operation shape than a plain UPDATE...WHERE compare-and-swap on the
 * campaign's own row).
 *
 * Never calls freezeCampaignRecipients — the existing snapshot rows are
 * reused verbatim, queried, not written. Never creates a second
 * notifications row — campaign.notificationId (already set before
 * "sending" was ever reachable) is reused verbatim. audienceConfig is never
 * read or touched.
 */
export async function resumeCampaign(campaignId: number): Promise<CampaignResumeResult> {
  const [campaign] = await db.select().from(notificationCampaignsTable).where(eq(notificationCampaignsTable.id, campaignId)).limit(1);
  if (!campaign) {
    throw new NotificationCampaignError("NOT_FOUND", `Campaign ${campaignId} not found`);
  }
  if (campaign.notificationId == null) {
    // Structurally should be impossible — notificationId is set in the same
    // transaction that first sets status="sending" — but fail loudly rather
    // than risk ever creating a second canonical notification row.
    throw new NotificationCampaignError(
      "MISSING_NOTIFICATION",
      `Campaign ${campaignId} has status "${campaign.status}" but no canonical notification row — refusing to resume.`,
    );
  }

  const staleMinutes = staleSendingThresholdMinutes();
  const maxAttempts = maxCampaignSendAttempts();

  // ─── The atomic claim (the actual safety primitive) ────────────────────
  // Succeeds ONLY if, at the exact instant this statement runs, the
  // campaign is still "sending" AND its heartbeat is older than
  // staleMinutes (or was never set at all, matching the crash-before-any-
  // heartbeat case). Postgres serializes concurrent UPDATEs to the same
  // row: if two resume requests race, the first to commit sets
  // last_send_heartbeat_at = now(); the second's WHERE clause can then
  // never match "now() - interval" against a heartbeat that is now(),
  // so it sees zero rows updated and safely no-ops into the rejection path
  // below. Exactly one caller ever proceeds past this point for a given
  // stale campaign.
  const claimResult = await db.execute(sql`
    update notification_campaigns
    set last_send_heartbeat_at = now(),
        send_attempt = send_attempt + 1
    where id = ${campaignId}
      and status = 'sending'
      and (last_send_heartbeat_at is null or last_send_heartbeat_at < now() - make_interval(mins => ${staleMinutes}))
    returning send_attempt as "sendAttempt"
  `);

  if (claimResult.rows.length === 0) {
    const [current] = await db
      .select({ status: notificationCampaignsTable.status, lastSendHeartbeatAt: notificationCampaignsTable.lastSendHeartbeatAt })
      .from(notificationCampaignsTable)
      .where(eq(notificationCampaignsTable.id, campaignId))
      .limit(1);
    if (current?.status !== "sending") {
      throw new NotificationCampaignError(
        "NOT_RESUMABLE",
        `Campaign ${campaignId} is not in a resumable state (status "${current?.status}") — resume only applies to a stale "sending" campaign.`,
      );
    }
    throw new NotificationCampaignError(
      "NOT_STALE",
      `Campaign ${campaignId} is still actively sending (heartbeat within the last ${staleMinutes} minute(s)) — an actively-running send must not be treated as crashed.`,
    );
  }

  const sendAttempt = (claimResult.rows[0] as { sendAttempt: number }).sendAttempt;
  logger.warn({ campaignId, notificationId: campaign.notificationId, sendAttempt, staleMinutes }, "[CAMPAIGN] stale sending campaign claimed for resume");

  if (sendAttempt > maxAttempts) {
    await db.update(notificationCampaignsTable)
      .set({ status: "failed", lastError: `Exceeded maximum send attempts (${maxAttempts})` })
      .where(eq(notificationCampaignsTable.id, campaignId));
    throw new NotificationCampaignError(
      "MAX_ATTEMPTS_EXCEEDED",
      `Campaign ${campaignId} exceeded the maximum number of send attempts (${maxAttempts}) and has been marked failed.`,
    );
  }

  // Reuse the existing frozen recipient snapshot verbatim — a plain SELECT,
  // never freezeCampaignRecipients. The campaign's audienceConfig is never
  // read here at all.
  const recipients: RecipientSnapshotFacts[] = await db
    .select({
      hadActiveDeviceAtSnapshot: notificationCampaignRecipientsTable.hadActiveDeviceAtSnapshot,
      activeDeviceCountAtSnapshot: notificationCampaignRecipientsTable.activeDeviceCountAtSnapshot,
    })
    .from(notificationCampaignRecipientsTable)
    .where(eq(notificationCampaignRecipientsTable.campaignId, campaignId));

  let pushResult;
  try {
    pushResult = await sendCampaignPushNotification({
      campaignId,
      notificationId: campaign.notificationId,
      title: campaign.title,
      body: campaign.body,
      data: { type: "manual_campaign", campaignId },
      // sendAttempt above is exactly what the atomic claim just wrote to
      // the row — THIS resume's lease. See sendCampaignPushNotification's
      // doc comment and the Wave 2.1 concurrency review.
      leaseSendAttempt: sendAttempt,
    });
  } catch (error) {
    if (error instanceof LeaseLostError) {
      // A THIRD sender (another resume, claimed after this one) has since
      // reclaimed ownership — extremely unlikely inside one resume's own
      // run (nothing else can go stale that fast), but handled identically
      // to sendCampaign()'s case for the same reason: whoever holds the
      // lease now owns finalization, not us.
      logger.warn({ campaignId, notificationId: campaign.notificationId, sendAttempt }, "[CAMPAIGN] resume lost its lease to a further concurrent resume — stopping without finalizing");
      throw new NotificationCampaignError("LEASE_LOST", `Campaign ${campaignId}'s send lease was reclaimed again before this resume finished.`);
    }
    await db.update(notificationCampaignsTable)
      .set({ lastError: error instanceof Error ? error.message : "Unknown error during campaign resume" })
      .where(eq(notificationCampaignsTable.id, campaignId));
    throw error;
  }

  const result = await finalizeCampaignSend(campaignId, campaign.notificationId, recipients, pushResult.truncated);

  const [{ remainingRecipients }] = await db
    .select({ remainingRecipients: count() })
    .from(notificationCampaignRecipientsTable)
    .where(and(
      eq(notificationCampaignRecipientsTable.campaignId, campaignId),
      eq(notificationCampaignRecipientsTable.status, "pending"),
    ));

  logger.info({
    campaignId,
    notificationId: campaign.notificationId,
    status: result.status,
    sendAttempt,
    snapshotRecipients: recipients.length,
    devicesPreviouslySent: pushResult.devicesPreviouslySent,
    devicesAttemptedThisRun: pushResult.devicesAttemptedThisRun,
    sentThisRun: pushResult.sent,
    failedThisRun: pushResult.failed,
    skippedAlreadySent: pushResult.skippedAlreadySent,
    finalSentDevices: result.sentDeviceCount,
    finalFailedDevices: result.failedDeviceCount,
    remainingRecipients,
  }, "[CAMPAIGN] resume finished");

  return {
    ...result,
    wasStale: true,
    sendAttempt,
    devicesPreviouslySent: pushResult.devicesPreviouslySent,
    devicesAttemptedThisRun: pushResult.devicesAttemptedThisRun,
    sentThisRun: pushResult.sent,
    failedThisRun: pushResult.failed,
    skippedAlreadySent: pushResult.skippedAlreadySent,
    remainingRecipients,
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
