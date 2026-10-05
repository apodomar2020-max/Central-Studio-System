import { and, asc, eq, or, sql } from "drizzle-orm";
import { db, notificationDevicesTable, studentsTable } from "@workspace/db";
import { resolveRegistrationSecret } from "./installationUnregister";

export class DeviceRegistrationConflict extends Error {}
export class DeviceRegistrationSessionInvalid extends Error {}

type Registration = {
  studentId: number;
  tokenVersion: number;
  pushToken: string;
  provider: "expo";
  platform: "ios" | "android" | "unknown";
  deviceId?: string;
  unregisterSecret?: string;
};

function retryable(error: unknown): boolean {
  // Drizzle wraps driver errors. Inspect codes only; never expose query text.
  let current: any = error;
  for (let depth = 0; current && depth < 5; depth++, current = current.cause) {
    if (current.code === "40001" || current.code === "40P01") return true;
  }
  return false;
}

export async function registerNotificationDevice(input: Registration) {
  const secret = resolveRegistrationSecret(input.unregisterSecret);
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction(async tx => {
        // Account lifecycle writers lock students before devices. Recheck the
        // verified session here so a request queued behind logout/deletion
        // cannot activate a row using a previously accepted session.
        const [student] = await tx.select().from(studentsTable)
          .where(eq(studentsTable.id, input.studentId)).for("update");
        if (!student || student.accountStatus !== "active" || student.tokenVersion !== input.tokenVersion) {
          throw new DeviceRegistrationSessionInvalid();
        }

        // Follow the existing transaction-scoped advisory-lock pattern. Locks
        // cover absent rows too; deterministic ordering prevents inverted locks.
        const keys = [`push-registration:token:${input.pushToken}`];
        if (input.deviceId) keys.push(`push-registration:installation:${input.deviceId}`);
        for (const key of keys.sort()) {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
        }
        const rows = await tx.select().from(notificationDevicesTable)
          .where(input.deviceId
            ? or(eq(notificationDevicesTable.pushToken, input.pushToken), eq(notificationDevicesTable.deviceId, input.deviceId))
            : eq(notificationDevicesTable.pushToken, input.pushToken))
          .orderBy(asc(notificationDevicesTable.id)).for("update");
        const existing = rows.find(row => row.pushToken === input.pushToken);
        if (existing && existing.studentId !== input.studentId && !(
          input.deviceId && input.unregisterSecret &&
          existing.deviceId === input.deviceId &&
          existing.unregisterSecretHash !== null && existing.unregisterSecretHash === secret.secretHash
        )) throw new DeviceRegistrationConflict();

        const now = new Date().toISOString();
        if (input.deviceId && input.unregisterSecret) {
          for (const row of rows) {
            if (row.deviceId === input.deviceId && (row.studentId === input.studentId || row.unregisterSecretHash === secret.secretHash)) {
              await tx.update(notificationDevicesTable).set({ isActive: false, updatedAt: now })
                .where(eq(notificationDevicesTable.id, row.id));
            }
          }
        }
        const fields = {
          studentId: input.studentId, pushToken: input.pushToken,
          provider: input.provider, platform: input.platform, deviceId: input.deviceId ?? null,
          // A cross-owner handoff must retain the proven capability.
          unregisterSecretHash: existing && existing.studentId !== input.studentId
            ? existing.unregisterSecretHash : secret.secretHash,
          isActive: true, lastSeenAt: now, updatedAt: now,
        };
        const [device] = existing
          ? await tx.update(notificationDevicesTable).set(fields).where(eq(notificationDevicesTable.id, existing.id)).returning()
          : await tx.insert(notificationDevicesTable).values(fields).returning();
        return { device, action: existing ? "updated" : "created", secret };
      });
    } catch (error) {
      if (attempt >= 2 || !retryable(error)) throw error;
      await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
}
