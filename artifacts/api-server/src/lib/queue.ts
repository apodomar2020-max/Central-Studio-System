import { Queue, type JobsOptions, type QueueOptions } from "bullmq";
import IORedis from "ioredis";
import { logger } from "./logger";

export const QUEUE_NAMES = {
  whatsappCampaigns: "whatsapp-campaigns",
  reports: "reports",
  notificationAutomation: "notification-automation",
  balletCancellationFinalization: "ballet-cancellation-finalization",
  balletAutoAbsence: "ballet-auto-absence",
} as const;

export type QueueName = typeof QUEUE_NAMES[keyof typeof QUEUE_NAMES];

export type WhatsAppCampaignSendJob = {
  campaignId: number;
  actorEmail?: string | null;
  ipAddress?: string | null;
};

export type ReportJob = {
  reportJobId: number;
  entity: string;
  filters?: Record<string, unknown>;
  format?: "json" | "xlsx" | "pdf";
};

export type NotificationAutomationJob = {
  type: "class_reminders" | "post_class_reminders" | "package_reminders";
  triggeredBy?: "admin" | "system";
  /**
   * Where the job originated. Optional so existing enqueue paths (which set
   * `triggeredBy`) stay backward-compatible; the startup schedulers set
   * `source: "scheduler"` so logs/audit can distinguish automated runs from
   * manual admin runs. The worker only switches on `type`, so this is purely
   * informational.
   */
  source?: "admin" | "scheduler" | "system";
  /**
   * Bypass reminder-category settings (Phase 6). Only ever set by the admin
   * enqueue route, which has already verified isSuperAdmin before setting
   * it — the scheduler never sets this field.
   */
  force?: boolean;
};

export type BalletCancellationFinalizationJob =
  | { type: "reconcile_due_cancellations"; source?: "scheduler" | "admin" | "system" }
  | { type: "finalize_cancellation_request"; requestId: number; source?: "scheduler" | "admin" | "system" };

/**
 * Automatic Ballet absence (see lib/balletAutoAbsence.ts). "plan_due_occurrences"
 * is the recurring planner: it discovers today's Ballet Schedule occurrences
 * whose end time (+ a small grace) is imminent and enqueues one deterministic
 * "process_occurrence" job per occurrence — deterministic jobId
 * (`ballet-auto-absence:{scheduleId}:{classDate}`) so re-running the planner
 * (restart, replica, overlapping lookahead windows) does not enqueue
 * duplicates. The occurrence-identity DB unique index
 * (attendance_ballet_unique_per_slot_date) is the ultimate idempotency
 * backstop regardless of queue-level dedup.
 */
export type BalletAutoAbsenceJob =
  | { type: "plan_due_occurrences"; source?: "scheduler" | "admin" | "system" }
  | { type: "process_occurrence"; balletScheduleId: number; classDate: string; source?: "scheduler" | "admin" | "system" }
  | { type: "deliver_absence_push"; notificationId: number; source?: "scheduler" | "system" };

/**
 * Production scheduling for notification automation (Option B — BullMQ Job
 * Schedulers registered by the worker at startup). Each entry has a STABLE
 * schedulerId: BullMQ keys a repeatable job by this id, so re-registering on
 * every worker restart (or from multiple worker replicas) upserts the same
 * scheduler instead of creating duplicates. Cron patterns are evaluated in UTC;
 * the cadence is timezone-agnostic and the actual time-window logic lives
 * inside each automation runner, not here.
 *
 * class_reminders runs every 15 minutes (not hourly): the 1h pre-class
 * window is only 15-60 minutes before class start, and an hourly scheduler
 * cannot reliably land inside that window for every class start time. Every
 * 15 minutes is the smallest cadence that guarantees at least one run falls
 * inside any 15-60m window, and reminder idempotency (migration 0072) makes
 * repeated selection across runs safe. post_class_reminders and
 * package_reminders keep their prior cadence — their windows are hours wide,
 * so hourly/6-hourly already lands inside them reliably.
 */
export type NotificationAutomationSchedule = {
  schedulerId: string;
  type: NotificationAutomationJob["type"];
  pattern: string;
};

export const NOTIFICATION_AUTOMATION_SCHEDULES: readonly NotificationAutomationSchedule[] = [
  { schedulerId: "notification-automation:class-reminders", type: "class_reminders", pattern: "*/15 * * * *" },
  { schedulerId: "notification-automation:post-class-reminders", type: "post_class_reminders", pattern: "20 * * * *" },
  { schedulerId: "notification-automation:package-reminders", type: "package_reminders", pattern: "0 */6 * * *" },
] as const;

export const BALLET_CANCELLATION_FINALIZATION_SCHEDULES: readonly { schedulerId: string; pattern: string }[] = [
  { schedulerId: "ballet-cancellation-finalization:hourly-reconciliation", pattern: "5 * * * *" },
] as const;

// Every 15 minutes — the planner's own LOOKAHEAD_MINUTES window (see
// balletAutoAbsence.ts) must exceed this cadence so no occurrence's end time
// ever falls in the gap between two consecutive planner runs.
export const BALLET_AUTO_ABSENCE_SCHEDULES: readonly { schedulerId: string; pattern: string }[] = [
  { schedulerId: "ballet-auto-absence:plan-due-occurrences", pattern: "*/15 * * * *" },
] as const;

/**
 * Default retry/cleanup options for enqueued jobs. Shared so both the ad-hoc
 * `enqueueJob` path and the startup schedulers register jobs with identical
 * resilience settings.
 */
export function defaultJobOptions(): JobsOptions {
  return {
    attempts: Number.parseInt(process.env["QUEUE_JOB_ATTEMPTS"] ?? "3", 10),
    backoff: { type: "exponential", delay: Number.parseInt(process.env["QUEUE_JOB_BACKOFF_MS"] ?? "5000", 10) },
    removeOnComplete: 100,
    removeOnFail: 500,
  };
}

let sharedConnection: IORedis | null = null;
const queues = new Map<QueueName, Queue>();

export function queueRedisUrl(): string | null {
  const url = process.env["REDIS_URL"]?.trim();
  return url || null;
}

export function queuesAvailable(): boolean {
  return Boolean(queueRedisUrl());
}

export function workerEnabled(): boolean {
  return process.env["QUEUE_WORKER_ENABLED"] === "true" && queuesAvailable();
}

export function getQueueConnection(): IORedis | null {
  const url = queueRedisUrl();
  if (!url) return null;
  if (!sharedConnection) {
    sharedConnection = new IORedis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    sharedConnection.on("error", (err) => {
      logger.error({ err }, "Redis queue connection error");
    });
  }
  return sharedConnection;
}

function queueOptions(): QueueOptions | null {
  const connection = getQueueConnection();
  return connection ? { connection } : null;
}

export function getQueue(name: QueueName): Queue | null {
  const options = queueOptions();
  if (!options) return null;
  const existing = queues.get(name);
  if (existing) return existing;
  const queue = new Queue(name, options);
  queues.set(name, queue);
  return queue;
}

export async function enqueueJob<T extends Record<string, unknown>>(
  queueName: QueueName,
  jobName: string,
  data: T,
  options: JobsOptions = {},
) {
  const queue = getQueue(queueName);
  if (!queue) return null;
  return queue.add(jobName, data, {
    ...defaultJobOptions(),
    ...options,
  });
}
