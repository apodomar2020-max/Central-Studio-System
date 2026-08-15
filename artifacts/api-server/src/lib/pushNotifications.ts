import { and, asc, eq, gt } from "drizzle-orm";
import {
  db,
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
