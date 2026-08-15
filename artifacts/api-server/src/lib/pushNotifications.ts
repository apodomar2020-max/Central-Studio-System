import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import {
  db,
  notificationCampaignRecipientsTable,
  notificationDeliveryLogsTable,
  notificationDevicesTable,
} from "@workspace/db";
import { logger } from "./logger";
import { isPushDeviceEligible } from "./pushDeviceEligibility";

type PushData = Record<string, unknown>;

type SendPushInput = {
  studentId: number;
  title: string;
  body: string;
  data?: PushData;
  notificationId?: number | null;
};

type SendBroadcastInput = {
  title: string;
  body: string;
  data?: PushData;
  notificationId?: number | null;
  /**
   * Devices fetched per DB page while walking the complete eligible
   * audience (Wave 1). Defaults to NOTIFICATION_PUSH_BROADCAST_LIMIT /
   * getPushStatus().broadcastLimit — that env var and field name are kept
   * for backward compatibility, but as of Wave 1 they control page size
   * only, never a total-recipient ceiling. See sendBroadcastPushNotification.
   */
  batchSize?: number;
};

type PushDevice = {
  id: number;
  pushToken: string;
  platform: string;
};

const ANDROID_NOTIFICATION_CHANNEL_ID = "central-default-v1";

// Expo's push API documents a maximum of 100 messages per request. Every
// current caller of sendToDevices passes one student's devices at a time
// (realistically 1-5), so this is a defensive ceiling rather than something
// normal traffic approaches — see sendToDevices.
const EXPO_PUSH_CHUNK_SIZE = 100;

// Hard safety backstop on the broadcast device-paging loop (Wave 1). At the
// default page size (25) this supports 250,000 devices; even at the
// smallest sane page size (1) it still covers the stated 10,000-device
// scale target many times over. Existing only to guarantee termination
// under a pathological configuration — not expected to ever be hit, and
// logged loudly (not silently) if it is, unlike the old LIMIT-25 defect.
// Read fresh on every call (same pattern as getPushStatus()'s broadcastLimit)
// rather than cached at module load, both for testability and because an
// env-var safety knob should take effect without a process restart.
function maxBroadcastBatches(): number {
  const value = Number.parseInt(process.env["NOTIFICATION_PUSH_BROADCAST_MAX_BATCHES"] ?? "10000", 10);
  return Number.isFinite(value) && value > 0 ? value : 10000;
}

function pushEnabled(): boolean {
  return process.env["PUSH_NOTIFICATIONS_ENABLED"] === "true";
}

// ─── Wave 2.1: delivery error classification (campaign recovery) ────────────
//
// notification_delivery_logs.error_code today holds one of:
//   - Expo's own ticket-level `details.error` values (documented by Expo):
//     "DeviceNotRegistered", "MessageTooBig", "MessageRateExceeded",
//     "InvalidCredentials" — or "" if Expo returned an error ticket with no
//     `details.error` at all.
//   - "expo_request_failed" — our own code for a network/fetch-level
//     failure reaching Expo at all (the whole HTTP request threw).
//   - "push_disabled" / "no_active_device" — sendPushNotification's skip
//     reasons (single-student path only; campaign device-level logs never
//     carry these, since a campaign only ever attempts devices it already
//     found live and active).
//
// RETRYABLE_DELIVERY_ERROR_CODES is an explicit allowlist, not a denylist —
// per the task's own instruction not to assume a failure is retryable by
// default. Anything not in this list (including an unrecognized/unknown
// future Expo error code) is treated as permanent, so recovery never
// endlessly hammers a device that can never succeed.
const RETRYABLE_DELIVERY_ERROR_CODES = new Set([
  "expo_request_failed", // transient network/HTTP failure reaching Expo
  "MessageRateExceeded",  // Expo-side rate limiting — expected to succeed later
]);

export function isRetryableDeliveryError(errorCode: string | null): boolean {
  if (!errorCode) return false;
  return RETRYABLE_DELIVERY_ERROR_CODES.has(errorCode);
}

// Bounds how many total delivery attempts (across the original send plus
// every resume) a single device may receive for one notification — the
// per-device analog of the campaign-level sendAttempt cap in
// lib/notificationCampaigns.ts. Prevents a systemic issue (e.g. a
// misconfigured Expo credential returning "MessageRateExceeded" forever)
// from producing unbounded retries against the same device.
function maxDeviceDeliveryAttempts(): number {
  const value = Number.parseInt(process.env["NOTIFICATION_CAMPAIGN_DEVICE_MAX_ATTEMPTS"] ?? "3", 10);
  return Number.isFinite(value) && value > 0 ? value : 3;
}

export function getPushStatus() {
  const limit = Number.parseInt(process.env["NOTIFICATION_PUSH_BROADCAST_LIMIT"] ?? "25", 10);
  return {
    enabled: pushEnabled(),
    provider: "expo",
    // Historically documented as a total-recipient ceiling; as of Wave 1 it
    // is the device page/batch size sendBroadcastPushNotification pages
    // through the full eligible audience with — see that function.
    broadcastLimit: Number.isFinite(limit) && limit > 0 ? limit : 25,
    accessTokenConfigured: Boolean(process.env["EXPO_ACCESS_TOKEN"]),
  };
}

function expoHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const token = process.env["EXPO_ACCESS_TOKEN"];
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function compactData(data: PushData | undefined, notificationId: number | null | undefined): PushData {
  return {
    ...(data ?? {}),
    ...(notificationId != null ? { notificationId } : {}),
  };
}

function platformCounts(devices: PushDevice[]): Record<string, number> {
  return devices.reduce<Record<string, number>>((counts, device) => {
    const platform = device.platform || "unknown";
    counts[platform] = (counts[platform] ?? 0) + 1;
    return counts;
  }, {});
}

/**
 * Sends to an arbitrary-length device list by splitting into
 * EXPO_PUSH_CHUNK_SIZE-sized requests to Expo (Wave 1) and aggregating the
 * results — a single failed chunk does not prevent the remaining chunks
 * from being attempted.
 */
async function sendToDevices(args: SendPushInput, devices: PushDevice[]) {
  if (devices.length === 0) return { sent: 0, failed: 0 };
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < devices.length; i += EXPO_PUSH_CHUNK_SIZE) {
    const chunk = devices.slice(i, i + EXPO_PUSH_CHUNK_SIZE);
    const result = await sendChunkToDevices(args, chunk);
    sent += result.sent;
    failed += result.failed;
  }
  return { sent, failed };
}

async function sendChunkToDevices(args: SendPushInput, devices: PushDevice[]) {
  if (devices.length === 0) return { sent: 0, failed: 0 };

  const messages = devices.map((device) => {
    const message: Record<string, unknown> = {
      to: device.pushToken,
      title: args.title,
      body: args.body,
      data: compactData(args.data, args.notificationId),
      sound: "default",
    };
    if (device.platform === "android") {
      message.channelId = ANDROID_NOTIFICATION_CHANNEL_ID;
    }
    return message;
  });

  try {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: expoHeaders(),
      body: JSON.stringify(messages),
    });
    const payload = await response.json().catch(() => null) as { data?: Array<Record<string, unknown>> } | null;
    const receipts = Array.isArray(payload?.data) ? payload.data : [];
    logger.info({
      notificationId: args.notificationId ?? null,
      studentId: args.studentId,
      expoHttpStatus: response.status,
      ticketCount: receipts.length,
      deviceCount: devices.length,
    }, "[PUSH_DIAG] Expo push response received");
    let sent = 0;
    let failed = 0;

    await Promise.all(devices.map(async (device, index) => {
      const receipt = receipts[index] ?? {};
      const ok = response.ok && receipt.status !== "error";
      if (ok) sent += 1; else failed += 1;
      logger.info({
        notificationId: args.notificationId ?? null,
        studentId: args.studentId,
        deviceId: device.id,
        platform: device.platform,
        ticketStatus: typeof receipt.status === "string" ? receipt.status : null,
        ticketId: typeof receipt.id === "string" ? receipt.id : null,
        ticketErrorCode: typeof receipt.details === "object" && receipt.details
          ? String((receipt.details as Record<string, unknown>).error ?? "")
          : null,
        ticketErrorMessage: typeof receipt.message === "string" ? receipt.message : null,
      }, "[PUSH_DIAG] Expo push ticket processed");
      await db.insert(notificationDeliveryLogsTable).values({
        notificationId: args.notificationId ?? null,
        studentId: args.studentId,
        deviceId: device.id,
        channel: "push",
        provider: "expo",
        status: ok ? "sent" : "failed",
        providerMessageId: typeof receipt.id === "string" ? receipt.id : null,
        errorCode: typeof receipt.details === "object" && receipt.details
          ? String((receipt.details as Record<string, unknown>).error ?? "")
          : null,
        errorMessage: ok ? null : typeof receipt.message === "string" ? receipt.message : `Expo push HTTP ${response.status}`,
        sentAt: ok ? new Date().toISOString() : null,
      });
    }));

    return { sent, failed };
  } catch (error) {
    logger.warn({ err: error, studentId: args.studentId }, "Expo push send failed");
    await Promise.all(devices.map((device) => db.insert(notificationDeliveryLogsTable).values({
      notificationId: args.notificationId ?? null,
      studentId: args.studentId,
      deviceId: device.id,
      channel: "push",
      provider: "expo",
      status: "failed",
      errorCode: "expo_request_failed",
      errorMessage: error instanceof Error ? error.message : "Expo push request failed",
    })));
    return { sent: 0, failed: devices.length };
  }
}

export type SendPushReason = "sent" | "push_disabled" | "no_active_device" | "failed";

export type SendPushResult = { sent: number; failed: number; skipped: boolean; reason: SendPushReason };

export async function sendPushNotification(input: SendPushInput): Promise<SendPushResult> {
  logger.info({
    notificationId: input.notificationId ?? null,
    studentId: input.studentId,
    pushNotificationsEnabled: process.env["PUSH_NOTIFICATIONS_ENABLED"] ?? null,
  }, "[PUSH_DIAG] sendPushNotification start");
  if (!pushEnabled()) {
    logger.info({ studentId: input.studentId, notificationId: input.notificationId ?? null }, "Push notification skipped: push disabled");
    // Operational/delivery result so a reminder notification row is never
    // left with no explanation for why no push arrived (Phase 7). No token,
    // no PII — just the reason.
    try {
      await db.insert(notificationDeliveryLogsTable).values({
        notificationId: input.notificationId ?? null,
        studentId: input.studentId,
        channel: "push",
        provider: "expo",
        status: "skipped",
        errorCode: "push_disabled",
        errorMessage: "Push notifications are disabled for this environment.",
      });
    } catch (logErr) {
      logger.warn({ err: logErr, studentId: input.studentId, notificationId: input.notificationId ?? null }, "Failed to write skipped push delivery log");
    }
    return { sent: 0, failed: 0, skipped: true, reason: "push_disabled" };
  }
  try {
    const devices = await db
      .select({
        id: notificationDevicesTable.id,
        pushToken: notificationDevicesTable.pushToken,
        platform: notificationDevicesTable.platform,
        provider: notificationDevicesTable.provider,
        isActive: notificationDevicesTable.isActive,
      })
      .from(notificationDevicesTable)
      .where(and(
        eq(notificationDevicesTable.studentId, input.studentId),
        eq(notificationDevicesTable.provider, "expo"),
        eq(notificationDevicesTable.isActive, true),
      ));
    const eligibleDevices = devices.filter(isPushDeviceEligible);
    logger.info({
      notificationId: input.notificationId ?? null,
      studentId: input.studentId,
      activeDeviceCount: eligibleDevices.length,
      platformCounts: platformCounts(eligibleDevices),
    }, "[PUSH_DIAG] active push devices loaded");
    if (eligibleDevices.length === 0) {
      logger.info({ studentId: input.studentId, notificationId: input.notificationId ?? null }, "Push notification skipped: no active devices");
      await db.insert(notificationDeliveryLogsTable).values({
        notificationId: input.notificationId ?? null,
        studentId: input.studentId,
        channel: "push",
        provider: "expo",
        status: "skipped",
        errorCode: "no_active_device",
        errorMessage: "No active push device registered for this student.",
      });
      return { sent: 0, failed: 0, skipped: false, reason: "no_active_device" };
    }
    const result = await sendToDevices(input, eligibleDevices);
    return { ...result, skipped: false, reason: result.sent > 0 ? "sent" : "failed" };
  } catch (error) {
    logger.warn({ err: error, studentId: input.studentId }, "Push notification failed safely");
    return { sent: 0, failed: 0, skipped: false, reason: "failed" };
  }
}

export type BroadcastPushResult = {
  /** Distinct active-eligible devices seen across every page. */
  matchedDevices: number;
  /** Distinct students those devices belong to. */
  matchedStudents: number;
  /** Devices actually included in a send attempt (== matchedDevices today — every matched device is attempted; kept distinct from matchedDevices for Wave 2, where a persisted audience snapshot could matter/differ). */
  attemptedDevices: number;
  /** Alias of matchedStudents, named for parity with attemptedDevices. */
  attemptedStudents: number;
  sent: number;
  failed: number;
  /** Number of device pages fetched (for observability, not a correctness signal). */
  batches: number;
  /**
   * True only when the MAX_BROADCAST_BATCHES safety backstop was hit before
   * the eligible audience was exhausted — i.e. this result is INCOMPLETE:
   * more eligible devices existed than were ever attempted. False in every
   * other case, including "push disabled" and "no eligible devices" (both
   * fully-processed states, not truncation). Callers must not treat a
   * `truncated: true` result as a successful complete broadcast.
   */
  truncated: boolean;
};

const EMPTY_BROADCAST_RESULT: BroadcastPushResult = {
  matchedDevices: 0,
  matchedStudents: 0,
  attemptedDevices: 0,
  attemptedStudents: 0,
  sent: 0,
  failed: 0,
  batches: 0,
  truncated: false,
};

/**
 * Processes the COMPLETE eligible active-device audience for a broadcast,
 * in bounded pages (Wave 1 fix — previously a single `LIMIT` on the device
 * query silently truncated any audience larger than
 * NOTIFICATION_PUSH_BROADCAST_LIMIT, default 25; see pushNotifications.test.ts
 * for the batching coverage this replaces that defect with).
 *
 * Pagination is keyset (id > cursor), not OFFSET: OFFSET pagination can
 * skip or duplicate rows when the underlying table is mutated between page
 * fetches (a device is registered/deactivated mid-broadcast); ascending-id
 * keyset pagination cannot, because every page's lower bound is a specific
 * already-seen row id, not a shifting position count. This also bounds
 * memory to one page (batchSize rows) at a time regardless of audience size.
 *
 * NOTIFICATION_PUSH_BROADCAST_LIMIT / batchSize now controls page size only
 * — it is never a total-recipient ceiling. The loop continues until a page
 * returns fewer rows than the page size.
 */
export async function sendBroadcastPushNotification(input: SendBroadcastInput): Promise<BroadcastPushResult> {
  if (!pushEnabled()) {
    logger.info({ notificationId: input.notificationId ?? null }, "Broadcast push skipped: push disabled");
    return EMPTY_BROADCAST_RESULT;
  }

  const pageSize = input.batchSize ?? getPushStatus().broadcastLimit;
  const maxBatches = maxBroadcastBatches();
  const attemptedStudentIds = new Set<number>();
  let matchedDevices = 0;
  let sent = 0;
  let failed = 0;
  let batches = 0;
  let cursor = 0;
  let truncated = false;

  for (;;) {
    if (batches >= maxBatches) {
      // The safety backstop stopped the loop with eligible devices still
      // unprocessed — this run must never be reported as a complete,
      // successful broadcast. Every delivery log already written for the
      // batches processed so far is untouched; only further pages are
      // skipped.
      truncated = true;
      logger.error({
        notificationId: input.notificationId ?? null,
        batches,
        maxBatches,
        matchedDevices,
        cursor,
      }, "[PUSH_DIAG] Broadcast push INCOMPLETE: MAX_BROADCAST_BATCHES safety backstop reached before the eligible audience was exhausted");
      break;
    }

    const page = await db
      .select({
        id: notificationDevicesTable.id,
        studentId: notificationDevicesTable.studentId,
        pushToken: notificationDevicesTable.pushToken,
        platform: notificationDevicesTable.platform,
        provider: notificationDevicesTable.provider,
        isActive: notificationDevicesTable.isActive,
      })
      .from(notificationDevicesTable)
      .where(and(
        eq(notificationDevicesTable.provider, "expo"),
        eq(notificationDevicesTable.isActive, true),
        gt(notificationDevicesTable.id, cursor),
      ))
      .orderBy(asc(notificationDevicesTable.id))
      .limit(pageSize);

    if (page.length === 0) break;
    batches += 1;
    cursor = page[page.length - 1]!.id;

    const eligible = page.filter(isPushDeviceEligible);
    matchedDevices += eligible.length;

    const byStudent = new Map<number, PushDevice[]>();
    for (const device of eligible) {
      const list = byStudent.get(device.studentId) ?? [];
      list.push({ id: device.id, pushToken: device.pushToken, platform: device.platform });
      byStudent.set(device.studentId, list);
    }

    for (const [studentId, studentDevices] of byStudent) {
      attemptedStudentIds.add(studentId);
      const result = await sendToDevices({ ...input, studentId }, studentDevices);
      sent += result.sent;
      failed += result.failed;
    }

    if (page.length < pageSize) break;
  }

  if (matchedDevices === 0 && !truncated) {
    logger.info({ notificationId: input.notificationId ?? null }, "Broadcast push skipped: no active devices");
  }

  logger.info({
    notificationId: input.notificationId ?? null,
    batches,
    matchedDevices,
    matchedStudents: attemptedStudentIds.size,
    sent,
    failed,
    truncated,
  }, truncated ? "[PUSH_DIAG] Broadcast push completed INCOMPLETE (truncated)" : "[PUSH_DIAG] Broadcast push completed");

  return {
    matchedDevices,
    matchedStudents: attemptedStudentIds.size,
    attemptedDevices: matchedDevices,
    attemptedStudents: attemptedStudentIds.size,
    sent,
    failed,
    batches,
    truncated,
  };
}

type SendCampaignPushInput = {
  campaignId: number;
  notificationId: number;
  title: string;
  body: string;
  data?: PushData;
  batchSize?: number;
  /**
   * Wave 2.1 — the caller's own send_attempt value, captured at the moment
   * it started (the initial send transaction) or claimed (resumeCampaign's
   * atomic claim). This IS the durable ownership lease: sendCampaignPushNotification
   * re-verifies it still matches the campaign's live send_attempt immediately
   * before every page's provider dispatch (see the lease checkpoint below),
   * and stops — throwing LeaseLostError, sending nothing further — the
   * moment it no longer does. See notificationCampaigns.ts's resumeCampaign()
   * doc comment for the full "original sender vs resume sender" race this
   * closes.
   */
  leaseSendAttempt: number;
  /**
   * TEST-ONLY HOOK. Never set by production callers (sendCampaign /
   * resumeCampaign never pass it). Invoked once per page, immediately after
   * device selection/idempotency filtering and immediately before the lease
   * re-check + provider dispatch — i.e. exactly the "selected the next
   * device(s) but before provider send" boundary a concurrency test needs
   * to pause at. Awaited before proceeding, so a test can hold a sender
   * here, mutate DB state (force staleness, let a resume claim the lease),
   * then release it to observe whether the lease check correctly aborts the
   * pending send.
   */
  onDevicesSelected?: (studentIds: number[]) => Promise<void> | void;
};

export type CampaignPushResult = {
  /** Distinct active-eligible devices seen across every recipient page. */
  matchedDevices: number;
  /** Distinct accounts that had at least one device attempted THIS run. */
  matchedStudents: number;
  /** Frozen-snapshot accounts with zero active eligible devices (this run). */
  noDeviceStudents: number;
  /** THIS run's Expo outcomes — kept as the original Wave 2 field names for backward compatibility. */
  sent: number;
  failed: number;
  /** Number of recipient-snapshot pages fetched. */
  batches: number;
  truncated: boolean;
  // ─── Wave 2.1 recovery-run counters (additive) ────────────────────────────
  /** Devices skipped this run because a 'sent' delivery log already existed — never resent. */
  devicesPreviouslySent: number;
  /** Same figure as devicesPreviouslySent, exposed under the name the Wave 2.1 task asked for explicitly. */
  skippedAlreadySent: number;
  /** Devices actually included in an Expo send attempt this run (sent + failed this run). */
  devicesAttemptedThisRun: number;
  /** Devices skipped this run because their most recent failure was permanent, or they hit the per-device attempt cap. */
  permanentlyFailedSkipped: number;
};

const EMPTY_CAMPAIGN_PUSH_RESULT: CampaignPushResult = {
  matchedDevices: 0,
  matchedStudents: 0,
  noDeviceStudents: 0,
  sent: 0,
  failed: 0,
  batches: 0,
  truncated: false,
  devicesPreviouslySent: 0,
  skippedAlreadySent: 0,
  devicesAttemptedThisRun: 0,
  permanentlyFailedSkipped: 0,
};

/**
 * Wave 2.1 — thrown when a sender (original or resumed) discovers, at a
 * lease checkpoint, that it no longer owns the campaign's send lease (some
 * other sender's resume claim has advanced send_attempt past the value this
 * sender captured when it started). The sender must stop immediately:
 * no further device pages, no further Expo calls, no finalization. Whoever
 * currently holds the lease is responsible for finishing and finalizing.
 */
export class LeaseLostError extends Error {
  constructor(public campaignId: number, public expectedSendAttempt: number) {
    super(`Campaign ${campaignId} lease lost — send_attempt no longer matches ${expectedSendAttempt} (a concurrent resume has claimed ownership)`);
    this.name = "LeaseLostError";
  }
}

/**
 * The entire ownership-race fix in one primitive: atomically verifies the
 * campaign's live send_attempt still equals the lease this sender captured
 * at start AND refreshes the heartbeat, in a single conditional UPDATE.
 * Both effects are load-bearing:
 *   - the WHERE clause is what makes this an OWNERSHIP CHECK, not just an
 *     observability ping — a sender whose lease was reclaimed by a resume
 *     (send_attempt incremented) gets zero rows back here, every time,
 *     forever, and must stop.
 *   - refreshing the heartbeat (only for the confirmed current owner) is
 *     what keeps resumeCampaign()'s stale-claim UPDATE from matching again
 *     while this sender is genuinely still working — see the "Stale
 *     Threshold Safety" analysis in the Wave 2.1 concurrency review for why
 *     one page's worth of prep-query time can never itself cross the stale
 *     threshold.
 * Fails CLOSED: if the UPDATE itself throws (transient DB error), ownership
 * is NOT confirmed — treated exactly like a lost lease. A heartbeat write
 * that silently swallowed its own failure (the pre-Wave-2.1 behavior) would
 * let a sender that can no longer prove ownership keep sending anyway,
 * which is exactly the race this function exists to close.
 */
async function touchCampaignHeartbeatIfLeaseHeld(campaignId: number, leaseSendAttempt: number): Promise<boolean> {
  try {
    const result = await db.execute(sql`
      update notification_campaigns
      set last_send_heartbeat_at = now()
      where id = ${campaignId} and send_attempt = ${leaseSendAttempt}
      returning id
    `);
    return result.rows.length > 0;
  } catch (error) {
    logger.warn({ err: error, campaignId, leaseSendAttempt }, "[PUSH_DIAG] Campaign lease-check/heartbeat update failed — treating as lease lost (fail closed)");
    return false;
  }
}

/**
 * Wave 2 — sends Push to the accounts in a campaign's FROZEN recipient
 * snapshot (notification_campaign_recipients), never to "whatever the
 * audience definition currently matches". This is the delivery-side half
 * of the same invariant that keeps mobile visibility frozen (see
 * routes/notifications.ts's campaignRecipientVisibilityCondition): a
 * device that registers after the snapshot was taken must not receive this
 * campaign's push, exactly as it must not see the notification in-app.
 *
 * Reuses Wave 1's exact keyset-pagination + Expo-chunking machinery
 * (sendToDevices, the page-size/MAX_BROADCAST_BATCHES safety backstop) —
 * paginating over notification_campaign_recipients instead of
 * notification_devices directly, since the recipient snapshot (not the
 * live device table) is this function's source of "who to attempt".
 * Updates each recipient row's status (sent/failed/no_device) in batched
 * per-page UPDATEs (not one write per student) to keep this bounded at
 * O(pages), not O(recipients), in round trips.
 *
 * Wave 2.1: this function is now idempotent by construction, which is what
 * makes campaign recovery safe without a separate "recovery-only" code
 * path — the ORIGINAL send and every RESUME both call this exact function.
 * Before attempting any device, its existing notification_delivery_logs
 * history (if any) is consulted:
 *   - a prior 'sent' row            -> never resend, counted as
 *                                       devicesPreviouslySent/skippedAlreadySent
 *   - a prior 'failed' row, permanent error (see isRetryableDeliveryError)
 *                                    -> never retried, counted as
 *                                       permanentlyFailedSkipped
 *   - a prior 'failed' row, retryable error, under the per-device attempt
 *     cap (maxDeviceDeliveryAttempts) -> retried
 *   - at/over the per-device attempt cap regardless of error type
 *                                    -> not retried, counted as
 *                                       permanentlyFailedSkipped (bounded
 *                                       retries, per the task's requirement)
 *   - no prior log at all           -> attempted as a first try (the
 *                                       original-send case)
 * A recipient's final status this page is 'sent' if they have ANY
 * successful device (from history OR this run), else 'failed' if they have
 * any live device at all (attempted or not — e.g. permanently skipped),
 * else 'no_device'. This generalizes the original Wave 2 logic rather than
 * forking it.
 *
 * Wave 2.1 concurrency review — ORIGINAL SENDER VS RESUME SENDER: the
 * per-device idempotency evidence above closes the race only for devices
 * that already have a COMMITTED delivery log. It does NOT by itself stop
 * two senders (an original sender that stalled mid-Expo-call past the
 * stale threshold, and a resume that has since claimed the campaign) from
 * both selecting the SAME not-yet-attempted device and both calling Expo
 * before either has written a log — a genuine TOCTOU race. The fix is the
 * lease checkpoint immediately below: input.leaseSendAttempt is the
 * send_attempt this specific caller captured when it started/claimed, and
 * touchCampaignHeartbeatIfLeaseHeld() re-verifies — atomically, in the same
 * statement that refreshes the heartbeat — that send_attempt on the live
 * row still matches, immediately after device selection and immediately
 * before dispatching that page's devices to Expo. A sender whose lease has
 * been reclaimed gets LeaseLostError thrown right there, before any further
 * Expo call, and never reaches another page. See resumeCampaign()'s doc
 * comment and the Wave 2.1 concurrency review report for the full race
 * trace and the residual-window analysis (bounded to "already in-flight
 * inside sendToDevices when staleness was crossed", which no DB-only
 * checkpoint can close without holding a lock across the network call —
 * explicitly out of scope here).
 */
export async function sendCampaignPushNotification(input: SendCampaignPushInput): Promise<CampaignPushResult> {
  if (!pushEnabled()) {
    logger.info({ campaignId: input.campaignId, notificationId: input.notificationId }, "Campaign push skipped: push disabled");
    return EMPTY_CAMPAIGN_PUSH_RESULT;
  }

  const pageSize = input.batchSize ?? getPushStatus().broadcastLimit;
  const maxBatches = maxBroadcastBatches();
  const maxDeviceAttempts = maxDeviceDeliveryAttempts();
  let matchedDevices = 0;
  let matchedStudents = 0;
  let noDeviceStudents = 0;
  let sent = 0;
  let failed = 0;
  let batches = 0;
  let cursor = 0;
  let truncated = false;
  let devicesPreviouslySent = 0;
  let devicesAttemptedThisRun = 0;
  let permanentlyFailedSkipped = 0;

  for (;;) {
    if (batches >= maxBatches) {
      truncated = true;
      logger.error({
        campaignId: input.campaignId,
        notificationId: input.notificationId,
        batches,
        maxBatches,
        matchedDevices,
        cursor,
      }, "[PUSH_DIAG] Campaign push INCOMPLETE: MAX_BROADCAST_BATCHES safety backstop reached before the recipient snapshot was exhausted");
      break;
    }

    const page = await db
      .select({
        id: notificationCampaignRecipientsTable.id,
        studentId: notificationCampaignRecipientsTable.studentId,
      })
      .from(notificationCampaignRecipientsTable)
      .where(and(
        eq(notificationCampaignRecipientsTable.campaignId, input.campaignId),
        gt(notificationCampaignRecipientsTable.id, cursor),
      ))
      .orderBy(asc(notificationCampaignRecipientsTable.id))
      .limit(pageSize);

    if (page.length === 0) break;
    batches += 1;
    cursor = page[page.length - 1]!.id;

    // A recipient's studentId can be NULL only if the account was deleted
    // after the snapshot was frozen (ON DELETE SET NULL) — nothing to send
    // to, and its status (whatever it already was) is left as-is.
    const studentIds = page.map((r) => r.studentId).filter((id): id is number => id != null);
    if (studentIds.length === 0) continue;

    const devices = await db
      .select({
        id: notificationDevicesTable.id,
        studentId: notificationDevicesTable.studentId,
        pushToken: notificationDevicesTable.pushToken,
        platform: notificationDevicesTable.platform,
        provider: notificationDevicesTable.provider,
        isActive: notificationDevicesTable.isActive,
      })
      .from(notificationDevicesTable)
      .where(and(
        inArray(notificationDevicesTable.studentId, studentIds),
        eq(notificationDevicesTable.provider, "expo"),
        eq(notificationDevicesTable.isActive, true),
      ));
    const eligible = devices.filter(isPushDeviceEligible);
    matchedDevices += eligible.length;

    // ─── Idempotency evidence: what has already happened to these devices? ──
    const eligibleDeviceIds = eligible.map((d) => d.id);
    const priorLogs = eligibleDeviceIds.length > 0
      ? await db
        .select({
          deviceId: notificationDeliveryLogsTable.deviceId,
          status: notificationDeliveryLogsTable.status,
          errorCode: notificationDeliveryLogsTable.errorCode,
        })
        .from(notificationDeliveryLogsTable)
        .where(and(
          eq(notificationDeliveryLogsTable.notificationId, input.notificationId),
          inArray(notificationDeliveryLogsTable.deviceId, eligibleDeviceIds),
        ))
        .orderBy(asc(notificationDeliveryLogsTable.id))
      : [];
    const latestByDevice = new Map<number, { status: string; errorCode: string | null }>();
    const attemptCountByDevice = new Map<number, number>();
    for (const row of priorLogs) {
      if (row.deviceId == null) continue;
      attemptCountByDevice.set(row.deviceId, (attemptCountByDevice.get(row.deviceId) ?? 0) + 1);
      latestByDevice.set(row.deviceId, { status: row.status, errorCode: row.errorCode }); // ascending-id iteration -> ends up latest
    }

    let attemptCountThisPage = 0;
    const studentHasSuccess = new Set<number>();
    const byStudent = new Map<number, PushDevice[]>();
    for (const device of eligible) {
      const latest = latestByDevice.get(device.id);
      if (latest?.status === "sent") {
        devicesPreviouslySent += 1;
        studentHasSuccess.add(device.studentId);
        continue;
      }
      const attempts = attemptCountByDevice.get(device.id) ?? 0;
      if (latest?.status === "failed" && !isRetryableDeliveryError(latest.errorCode)) {
        permanentlyFailedSkipped += 1;
        continue;
      }
      if (attempts >= maxDeviceAttempts) {
        permanentlyFailedSkipped += 1;
        continue;
      }
      attemptCountThisPage += 1;
      const list = byStudent.get(device.studentId) ?? [];
      list.push({ id: device.id, pushToken: device.pushToken, platform: device.platform });
      byStudent.set(device.studentId, list);
    }
    devicesAttemptedThisRun += attemptCountThisPage;

    // ─── Lease checkpoint (Wave 2.1 concurrency fix) ────────────────────────
    // Positioned deliberately HERE: device selection for this page is done
    // (byStudent above is final), but no provider dispatch or recipient-
    // status write for this page has happened yet. This is exactly the
    // "selected the next device(s) but before provider send" boundary — the
    // test hook fires here, then the lease is re-verified. A sender that no
    // longer owns the lease stops dead: no Expo call, no recipient-status
    // write, for this page or any later one.
    await input.onDevicesSelected?.(Array.from(byStudent.keys()));
    const leaseHeld = await touchCampaignHeartbeatIfLeaseHeld(input.campaignId, input.leaseSendAttempt);
    if (!leaseHeld) {
      logger.warn({
        campaignId: input.campaignId,
        notificationId: input.notificationId,
        leaseSendAttempt: input.leaseSendAttempt,
        batches,
      }, "[CAMPAIGN] send lease lost mid-run — stopping before this page's provider dispatch, no finalization by this sender");
      throw new LeaseLostError(input.campaignId, input.leaseSendAttempt);
    }

    const liveDeviceStudentIds = new Set(eligible.map((d) => d.studentId));
    const noDeviceIdsThisPage = studentIds.filter((id) => !liveDeviceStudentIds.has(id));
    noDeviceStudents += noDeviceIdsThisPage.length;
    if (noDeviceIdsThisPage.length > 0) {
      await db.update(notificationCampaignRecipientsTable)
        .set({ status: "no_device" })
        .where(and(
          eq(notificationCampaignRecipientsTable.campaignId, input.campaignId),
          inArray(notificationCampaignRecipientsTable.studentId, noDeviceIdsThisPage),
        ));
    }

    for (const [studentId, studentDevices] of byStudent) {
      matchedStudents += 1;
      const result = await sendToDevices(
        { studentId, title: input.title, body: input.body, data: input.data, notificationId: input.notificationId },
        studentDevices,
      );
      sent += result.sent;
      failed += result.failed;
      // One recipient row = "sent" if ANY of their devices got through —
      // mirrors how a person experiences it (they got the notification),
      // not a strict all-devices-must-succeed bar.
      if (result.sent > 0) studentHasSuccess.add(studentId);
    }

    // Final per-student status this page: success (from history or this
    // run) beats a live-but-unsuccessful device, which beats no device at
    // all. This is the generalized rule that makes a recipient who was
    // already fully delivered before a crash correctly stay 'sent' on
    // resume even if this run attempts zero new devices for them.
    const finalSentIds: number[] = [];
    const finalFailedIds: number[] = [];
    for (const studentId of studentIds) {
      if (studentHasSuccess.has(studentId)) finalSentIds.push(studentId);
      else if (liveDeviceStudentIds.has(studentId)) finalFailedIds.push(studentId);
      // else: already counted into noDeviceIdsThisPage above.
    }
    if (finalSentIds.length > 0) {
      await db.update(notificationCampaignRecipientsTable)
        .set({ status: "sent" })
        .where(and(
          eq(notificationCampaignRecipientsTable.campaignId, input.campaignId),
          inArray(notificationCampaignRecipientsTable.studentId, finalSentIds),
        ));
    }
    if (finalFailedIds.length > 0) {
      await db.update(notificationCampaignRecipientsTable)
        .set({ status: "failed" })
        .where(and(
          eq(notificationCampaignRecipientsTable.campaignId, input.campaignId),
          inArray(notificationCampaignRecipientsTable.studentId, finalFailedIds),
        ));
    }

    if (page.length < pageSize) break;
  }

  logger.info({
    campaignId: input.campaignId,
    notificationId: input.notificationId,
    batches,
    matchedDevices,
    matchedStudents,
    noDeviceStudents,
    sent,
    failed,
    truncated,
    devicesPreviouslySent,
    devicesAttemptedThisRun,
    permanentlyFailedSkipped,
  }, truncated ? "[PUSH_DIAG] Campaign push completed INCOMPLETE (truncated)" : "[PUSH_DIAG] Campaign push completed");

  return {
    matchedDevices,
    matchedStudents,
    noDeviceStudents,
    sent,
    failed,
    batches,
    truncated,
    devicesPreviouslySent,
    skippedAlreadySent: devicesPreviouslySent,
    devicesAttemptedThisRun,
    permanentlyFailedSkipped,
  };
}
