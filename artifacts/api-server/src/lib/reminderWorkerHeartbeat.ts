import { eq } from "drizzle-orm";
import { db, reminderWorkerHeartbeatsTable } from "@workspace/db";

export const REMINDER_WORKER_NAME = "notification-automation-worker";

// The class-reminders job now runs every 15 minutes (see queue.ts
// NOTIFICATION_AUTOMATION_SCHEDULES), and every run refreshes this row — so
// tying the heartbeat to automation-run execution (rather than a separate
// setInterval timer in the Worker process) already gives a real periodic
// signal at a ≤15-minute cadence. Stale threshold is one cadence + a buffer.
const WORKER_STALE_AFTER_MS = 20 * 60 * 1000;

export type WorkerHealth = "online" | "stale" | "unknown";

export type ReminderRunStatus = "ok" | "error";

export async function recordReminderWorkerRun(input: {
  workerName?: string;
  status: ReminderRunStatus;
  summary: Record<string, unknown>;
  pushNotificationsEnabled: boolean;
  queueWorkerEnabled: boolean;
  deployedVersion?: string | null;
}): Promise<void> {
  const now = new Date().toISOString();
  const workerName = input.workerName ?? REMINDER_WORKER_NAME;
  await db
    .insert(reminderWorkerHeartbeatsTable)
    .values({
      workerName,
      lastHeartbeatAt: now,
      lastReminderRunAt: now,
      lastReminderRunStatus: input.status,
      lastReminderRunSummary: input.summary,
      pushNotificationsEnabled: input.pushNotificationsEnabled,
      queueWorkerEnabled: input.queueWorkerEnabled,
      deployedVersion: input.deployedVersion ?? null,
    })
    .onConflictDoUpdate({
      target: reminderWorkerHeartbeatsTable.workerName,
      set: {
        lastHeartbeatAt: now,
        lastReminderRunAt: now,
        lastReminderRunStatus: input.status,
        lastReminderRunSummary: input.summary,
        pushNotificationsEnabled: input.pushNotificationsEnabled,
        queueWorkerEnabled: input.queueWorkerEnabled,
        deployedVersion: input.deployedVersion ?? null,
        updatedAt: now,
      },
    });
}

export async function getReminderWorkerHeartbeat(workerName: string = REMINDER_WORKER_NAME) {
  const [row] = await db
    .select()
    .from(reminderWorkerHeartbeatsTable)
    .where(eq(reminderWorkerHeartbeatsTable.workerName, workerName))
    .limit(1);
  return row ?? null;
}

export function classifyWorkerHealth(
  heartbeat: { lastHeartbeatAt: string } | null | undefined,
  now: Date = new Date(),
): WorkerHealth {
  if (!heartbeat) return "unknown";
  const last = new Date(heartbeat.lastHeartbeatAt).getTime();
  if (!Number.isFinite(last)) return "unknown";
  return now.getTime() - last <= WORKER_STALE_AFTER_MS ? "online" : "stale";
}
