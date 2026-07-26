import { and, eq } from "drizzle-orm";
import {
  db,
  notificationDeliveryLogsTable,
  notificationDevicesTable,
} from "@workspace/db";
import { logger } from "./logger";

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
  limit?: number;
};

type PushDevice = {
  id: number;
  pushToken: string;
  platform: string;
};

const ANDROID_NOTIFICATION_CHANNEL_ID = "central-default-v1";

function pushEnabled(): boolean {
  return process.env["PUSH_NOTIFICATIONS_ENABLED"] === "true";
}

export function getPushStatus() {
  const limit = Number.parseInt(process.env["NOTIFICATION_PUSH_BROADCAST_LIMIT"] ?? "25", 10);
  return {
    enabled: pushEnabled(),
    provider: "expo",
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

async function sendToDevices(args: SendPushInput, devices: PushDevice[]) {
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
      })
      .from(notificationDevicesTable)
      .where(and(
        eq(notificationDevicesTable.studentId, input.studentId),
        eq(notificationDevicesTable.provider, "expo"),
        eq(notificationDevicesTable.isActive, true),
      ));
    logger.info({
      notificationId: input.notificationId ?? null,
      studentId: input.studentId,
      activeDeviceCount: devices.length,
      platformCounts: platformCounts(devices),
    }, "[PUSH_DIAG] active push devices loaded");
    if (devices.length === 0) {
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
    const result = await sendToDevices(input, devices);
    return { ...result, skipped: false, reason: result.sent > 0 ? "sent" : "failed" };
  } catch (error) {
    logger.warn({ err: error, studentId: input.studentId }, "Push notification failed safely");
    return { sent: 0, failed: 0, skipped: false, reason: "failed" };
  }
}

export async function sendBroadcastPushNotification(input: SendBroadcastInput): Promise<{ attemptedStudents: number }> {
  if (!pushEnabled()) {
    logger.info({ notificationId: input.notificationId ?? null }, "Broadcast push skipped: push disabled");
    return { attemptedStudents: 0 };
  }

  const limit = input.limit ?? getPushStatus().broadcastLimit;
  const devices = await db
    .select({
      id: notificationDevicesTable.id,
      studentId: notificationDevicesTable.studentId,
      pushToken: notificationDevicesTable.pushToken,
      platform: notificationDevicesTable.platform,
    })
    .from(notificationDevicesTable)
    .where(and(
      eq(notificationDevicesTable.provider, "expo"),
      eq(notificationDevicesTable.isActive, true),
    ))
    .limit(limit);

  const byStudent = new Map<number, PushDevice[]>();
  for (const device of devices) {
    const list = byStudent.get(device.studentId) ?? [];
    list.push({ id: device.id, pushToken: device.pushToken, platform: device.platform });
    byStudent.set(device.studentId, list);
  }
  if (byStudent.size === 0) {
    logger.info({ notificationId: input.notificationId ?? null }, "Broadcast push skipped: no active devices");
  }

  for (const [studentId, studentDevices] of byStudent) {
    await sendToDevices({ ...input, studentId }, studentDevices);
  }

  return { attemptedStudents: byStudent.size };
}
