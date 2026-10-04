import { and, eq, lte, sql } from "drizzle-orm";
import { db, notificationDeliveryLogsTable, notificationDevicesTable } from "@workspace/db";
import { canRetirePushToken, parseExpoResult } from "./pushReceiptProtocol";

export async function retireAttemptedPushToken(deviceId: number | null, tokenHash: string | null, attemptedAt: string | null) {
  if (deviceId === null || !tokenHash || !attemptedAt) return;
  await db.transaction(async tx => {
    const [device] = await tx.select().from(notificationDevicesTable).where(eq(notificationDevicesTable.id, deviceId)).for("update");
    if (device && canRetirePushToken(device.pushToken, tokenHash, device.lastSeenAt, attemptedAt)) {
      await tx.update(notificationDevicesTable).set({ isActive: false }).where(eq(notificationDevicesTable.id, deviceId));
    }
  });
}
export async function reconcilePushReceipts() {
  const now = new Date().toISOString();
  // A short DB lease recovers after process failure, independent of Redis job retention.
  const logs = await db.transaction(async tx => {
    const selected = await tx.select().from(notificationDeliveryLogsTable).where(and(
      eq(notificationDeliveryLogsTable.receiptStatus, "pending"), lte(notificationDeliveryLogsTable.receiptNextCheckAt, now),
    )).orderBy(notificationDeliveryLogsTable.receiptNextCheckAt, notificationDeliveryLogsTable.id).limit(100).for("update", { skipLocked: true });
    for (const row of selected) await tx.update(notificationDeliveryLogsTable).set({ receiptNextCheckAt: new Date(Date.now() + 60000).toISOString(), receiptAttempts: row.receiptAttempts + 1 })
      .where(eq(notificationDeliveryLogsTable.id, row.id));
    return selected;
  });
  const due = [];
  for (const row of logs) {
    if (!row.providerMessageId || row.receiptAttempts >= 10 || Date.now() - new Date(row.createdAt).getTime() >= 86400000) {
      await db.update(notificationDeliveryLogsTable).set({ receiptStatus: "unavailable", receiptCheckedAt: now,
        errorCode: "receipt_unavailable", errorMessage: "Expo delivery receipt could not be confirmed." }).where(eq(notificationDeliveryLogsTable.id, row.id));
    } else due.push(row);
  }
  if (!due.length) return;
  let receipts: Record<string, unknown> = {};
  try {
    const response = await fetch("https://exp.host/--/api/v2/push/getReceipts", { method: "POST", signal: AbortSignal.timeout(10000),
      headers: { "Content-Type": "application/json", ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}) },
      body: JSON.stringify({ ids: due.map(row => row.providerMessageId) }) });
    if (!response.ok) throw new Error();
    const body = await response.json() as { data?: Record<string, unknown> };
    if (!body.data || typeof body.data !== "object" || Array.isArray(body.data)) throw new Error();
    receipts = body.data;
  } catch { /* Each claimed row remains pending with a bounded delayed retry. */ }
  for (const row of due) {
    const value = receipts[row.providerMessageId!];
    if (!value) {
      await db.update(notificationDeliveryLogsTable).set({ receiptNextCheckAt: new Date(Date.now() + Math.min(3600000, 60000 * 2 ** row.receiptAttempts)).toISOString() })
        .where(eq(notificationDeliveryLogsTable.id, row.id));
      continue;
    }
    const receipt = parseExpoResult(value);
    if (receipt.error === "DeviceNotRegistered") await retireAttemptedPushToken(row.deviceId, row.attemptedTokenHash, row.attemptedAt);
    await db.update(notificationDeliveryLogsTable).set({ receiptStatus: receipt.ok ? "ok" : "error", receiptCheckedAt: now,
      ...(receipt.ok ? {} : { status: "failed", errorCode: receipt.error, errorMessage: "Expo reported a push delivery error." }),
    }).where(eq(notificationDeliveryLogsTable.id, row.id));
  }
}
