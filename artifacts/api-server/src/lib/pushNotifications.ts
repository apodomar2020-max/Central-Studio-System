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

function expoHeaders(): HeadersInit {
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

async function sendToDevices(args: SendPushInput, devices: Array<{ id: number; pushToken: string }>) {
  if (devices.length === 0) return { sent: 0, failed: 0 };

  const messages = devices.map((device) => ({
    to: device.pushToken,
    title: args.title,
    body: args.body,
    data: compactData(args.data, args.notificationId),
    sound: "default",
  }));

  try {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: expoHeaders(),
      body: JSON.stringify(messages),
    });
    const payload = await response.json().catch(() => null) as { data?: Array<Record<string, unknown>> } | null;
    const receipts = Array.isArray(payload?.data) ? payload.data : [];
    let sent = 0;
    let failed = 0;

    await Promise.all(devices.map(async (device, index) => {
      const receipt = receipts[index] ?? {};
      const ok = response.ok && receipt.status !== "error";
      if (ok) sent += 1; else failed += 1;
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

export async function sendPushNotification(input: SendPushInput): Promise<{ sent: number; failed: number; skipped: boolean }> {
  if (!pushEnabled()) return { sent: 0, failed: 0, skipped: true };
  try {
    const devices = await db
      .select({ id: notificationDevicesTable.id, pushToken: notificationDevicesTable.pushToken })
      .from(notificationDevicesTable)
      .where(and(
        eq(notificationDevicesTable.studentId, input.studentId),
        eq(notificationDevicesTable.provider, "expo"),
        eq(notificationDevicesTable.isActive, true),
      ));
    const result = await sendToDevices(input, devices);
    return { ...result, skipped: false };
  } catch (error) {
    logger.warn({ err: error, studentId: input.studentId }, "Push notification failed safely");
    return { sent: 0, failed: 0, skipped: false };
  }
}

export async function sendBroadcastPushNotification(input: SendBroadcastInput): Promise<{ attemptedStudents: number }> {
  if (!pushEnabled()) return { attemptedStudents: 0 };

  const limit = input.limit ?? getPushStatus().broadcastLimit;
  const devices = await db
    .select({
      id: notificationDevicesTable.id,
      studentId: notificationDevicesTable.studentId,
      pushToken: notificationDevicesTable.pushToken,
    })
    .from(notificationDevicesTable)
    .where(and(
      eq(notificationDevicesTable.provider, "expo"),
      eq(notificationDevicesTable.isActive, true),
    ))
    .limit(limit);

  const byStudent = new Map<number, Array<{ id: number; pushToken: string }>>();
  for (const device of devices) {
    const list = byStudent.get(device.studentId) ?? [];
    list.push({ id: device.id, pushToken: device.pushToken });
    byStudent.set(device.studentId, list);
  }

  for (const [studentId, studentDevices] of byStudent) {
    await sendToDevices({ ...input, studentId }, studentDevices);
  }

  return { attemptedStudents: byStudent.size };
}
