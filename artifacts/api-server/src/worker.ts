import { DelayedError, Worker } from "bullmq";
import { logger } from "./lib/logger";
import { captureError, initErrorMonitoring } from "./lib/errorMonitoring";
import {
  defaultJobOptions,
  queueConcurrency,
  getQueue,
  getQueueConnection,
  BALLET_CANCELLATION_FINALIZATION_SCHEDULES,
  BALLET_AUTO_ABSENCE_SCHEDULES,
  NOTIFICATION_AUTOMATION_SCHEDULES,
  QUEUE_NAMES,
  type BalletCancellationFinalizationJob,
  type BalletAutoAbsenceJob,
  type NotificationAutomationJob,
  workerEnabled,
  type ReportJob,
  type WhatsAppCampaignSendJob,
  PACKAGE_CREDIT_EXPIRATION_SCHEDULES,
  type PackageCreditExpirationJob,
} from "./lib/queue";
import { processWhatsAppCampaignBatch } from "./lib/marketingCampaignSender";
import { processReportJob } from "./lib/reportJobs";
import {
  runClassReminderAutomation,
  runPackageReminderAutomation,
  runPostClassReminderAutomation,
} from "./lib/notificationReminders";
import { processBalletCancellationFinalizationJob } from "./lib/balletCancellationFinalization";
import { processBalletAutoAbsenceJob } from "./lib/balletAutoAbsence";
import { recordReminderWorkerRun } from "./lib/reminderWorkerHeartbeat";
import { getPushStatus } from "./lib/pushNotifications";
import { resolveCodeCommit } from "./lib/codeCommit";
import { runPackageCreditExpirationBatch } from "./lib/packageCreditExpiration";

const deployedVersion = await resolveCodeCommit();

await initErrorMonitoring();

if (!workerEnabled()) {
  logger.warn("Queue worker disabled. Set QUEUE_WORKER_ENABLED=true and REDIS_URL to process background jobs.");
  process.exit(0);
}

// Migrations are NOT run here. The worker never mutates the schema; the API
// service applies migrations via Railway's preDeployCommand (see railway.toml).
const connection = getQueueConnection();
if (!connection) {
  logger.warn("Queue worker disabled because REDIS_URL is not configured.");
  process.exit(0);
}

const whatsappWorker = new Worker<WhatsAppCampaignSendJob>(
  QUEUE_NAMES.whatsappCampaigns,
  async (job) => {
    logger.info({ jobId: job.id, campaignId: job.data.campaignId }, "Processing WhatsApp campaign job");
    return processWhatsAppCampaignBatch(job.data);
  },
  { connection, concurrency: queueConcurrency("WHATSAPP_QUEUE_CONCURRENCY") },
);

const reportsWorker = new Worker<ReportJob>(
  QUEUE_NAMES.reports,
  async (job) => {
    logger.info({ jobId: job.id, reportJobId: job.data.reportJobId }, "Processing report job");
    await processReportJob(job.data.reportJobId);
  },
  { connection, concurrency: queueConcurrency("REPORT_QUEUE_CONCURRENCY") },
);

const notificationAutomationWorker = new Worker<NotificationAutomationJob>(
  QUEUE_NAMES.notificationAutomation,
  async (job) => {
    logger.info({ jobId: job.id, type: job.data.type }, "Processing notification automation job");
    const heartbeatBase = {
      pushNotificationsEnabled: getPushStatus().enabled,
      queueWorkerEnabled: workerEnabled(),
      deployedVersion,
    };
    let result;
    try {
      switch (job.data.type) {
        case "class_reminders":
          result = await runClassReminderAutomation({ force: job.data.force });
          break;
        case "post_class_reminders":
          result = await runPostClassReminderAutomation({ force: job.data.force });
          break;
        case "package_reminders":
          result = await runPackageReminderAutomation();
          break;
        default:
          throw new Error(`Unsupported notification automation job type: ${(job.data as { type?: string }).type}`);
      }
    } catch (err) {
      await recordReminderWorkerRun({
        ...heartbeatBase,
        status: "error",
        summary: { jobType: job.data.type, errorCode: "worker_execution_failed" },
      }).catch((heartbeatErr) => captureError(heartbeatErr, { component: "queue-worker", phase: "reminder-heartbeat-after-failure" }));
      throw err;
    }
    await recordReminderWorkerRun({
      ...heartbeatBase,
      status: "ok",
      summary: { jobType: job.data.type, ...result },
    }).catch((heartbeatErr) => captureError(heartbeatErr, { component: "queue-worker", phase: "reminder-heartbeat-after-success" }));
    return result;
  },
  { connection, concurrency: queueConcurrency("NOTIFICATION_AUTOMATION_QUEUE_CONCURRENCY") },
);

const balletCancellationFinalizationWorker = new Worker<BalletCancellationFinalizationJob>(
  QUEUE_NAMES.balletCancellationFinalization,
  async (job) => {
    logger.info({ jobId: job.id, type: job.data.type }, "Processing Ballet cancellation finalization job");
    return processBalletCancellationFinalizationJob(job.data);
  },
  { connection, concurrency: queueConcurrency("BALLET_CANCELLATION_FINALIZATION_QUEUE_CONCURRENCY") },
);

const balletAutoAbsenceWorker = new Worker<BalletAutoAbsenceJob>(
  QUEUE_NAMES.balletAutoAbsence,
  async (job, token) => {
    logger.info({ jobId: job.id, type: job.data.type }, "Processing Ballet auto-absence job");
    return processBalletAutoAbsenceJob(job.data, {
      jobId: job.id,
      rescheduleAt: async (timestamp) => {
        await job.moveToDelayed(timestamp, token);
        throw new DelayedError();
      },
    });
  },
  { connection, concurrency: queueConcurrency("BALLET_AUTO_ABSENCE_QUEUE_CONCURRENCY") },
);

const packageCreditExpirationWorker = new Worker<PackageCreditExpirationJob>(
  QUEUE_NAMES.packageCreditExpiration,
  async (job) => {
    logger.info({ jobId: job.id, type: job.data.type }, "Processing package credit expiration job");
    if (job.data.type !== "expire_due_packages") throw new Error(`Unsupported package credit expiration job type: ${job.data.type}`);
    return runPackageCreditExpirationBatch({ batchSize: job.data.batchSize });
  },
  { connection, concurrency: queueConcurrency("PACKAGE_CREDIT_EXPIRATION_QUEUE_CONCURRENCY") },
);

for (const worker of [whatsappWorker, reportsWorker, notificationAutomationWorker, balletCancellationFinalizationWorker, balletAutoAbsenceWorker, packageCreditExpirationWorker]) {
  worker.on("failed", (job, err) => {
    captureError(err, { component: "queue-worker", queue: worker.name, jobId: job?.id });
  });
}

async function registerPackageCreditExpirationSchedulers(): Promise<void> {
  const queue = getQueue(QUEUE_NAMES.packageCreditExpiration);
  if (!queue) {
    logger.warn("Package credit expiration queue unavailable; skipping scheduler registration");
    return;
  }
  for (const schedule of PACKAGE_CREDIT_EXPIRATION_SCHEDULES) {
    try {
      await queue.upsertJobScheduler(
        schedule.schedulerId,
        { pattern: schedule.pattern },
        {
          name: "expire_due_packages",
          data: { type: "expire_due_packages", source: "scheduler" } satisfies PackageCreditExpirationJob,
          opts: defaultJobOptions(),
        },
      );
      logger.info({ schedulerId: schedule.schedulerId, pattern: schedule.pattern }, "Registered package credit expiration scheduler");
    } catch (err) {
      captureError(err, { component: "queue-worker", phase: "package-credit-expiration-scheduler-registration", schedulerId: schedule.schedulerId });
      logger.error({ err, schedulerId: schedule.schedulerId }, "Failed to register package credit expiration scheduler");
    }
  }
}

async function registerBalletCancellationFinalizationSchedulers(): Promise<void> {
  const queue = getQueue(QUEUE_NAMES.balletCancellationFinalization);
  if (!queue) {
    logger.warn("Ballet cancellation finalization queue unavailable; skipping scheduler registration");
    return;
  }
  for (const schedule of BALLET_CANCELLATION_FINALIZATION_SCHEDULES) {
    try {
      await queue.upsertJobScheduler(
        schedule.schedulerId,
        { pattern: schedule.pattern },
        {
          name: "reconcile_due_cancellations",
          data: { type: "reconcile_due_cancellations", source: "scheduler" } satisfies BalletCancellationFinalizationJob,
          opts: defaultJobOptions(),
        },
      );
      logger.info({ schedulerId: schedule.schedulerId, pattern: schedule.pattern }, "Registered Ballet cancellation finalization scheduler");
    } catch (err) {
      captureError(err, { component: "queue-worker", phase: "ballet-cancellation-scheduler-registration", schedulerId: schedule.schedulerId });
      logger.error({ err, schedulerId: schedule.schedulerId, pattern: schedule.pattern }, "Failed to register Ballet cancellation finalization scheduler");
    }
  }
}

// ── Production scheduling (Option B) ─────────────────────────────────────────
// Register BullMQ Job Schedulers for notification automation at startup. This
// only runs here because reaching this point already guarantees the required
// preconditions: workerEnabled() (QUEUE_WORKER_ENABLED=true + REDIS_URL) passed
// above, and `connection` is non-null. upsertJobScheduler is keyed by a stable
// schedulerId, so restarting the worker — or running multiple worker replicas —
// upserts the same scheduler instead of creating duplicates. Duplicate
// notifications are additionally guarded by the existing per-run dedupe inside
// each automation runner.
async function registerNotificationAutomationSchedulers(): Promise<void> {
  const queue = getQueue(QUEUE_NAMES.notificationAutomation);
  if (!queue) {
    logger.warn("Notification automation queue unavailable; skipping scheduler registration");
    return;
  }
  for (const schedule of NOTIFICATION_AUTOMATION_SCHEDULES) {
    try {
      await queue.upsertJobScheduler(
        schedule.schedulerId,
        { pattern: schedule.pattern },
        {
          name: schedule.type,
          data: { type: schedule.type, source: "scheduler" } satisfies NotificationAutomationJob,
          opts: defaultJobOptions(),
        },
      );
      logger.info(
        { schedulerId: schedule.schedulerId, type: schedule.type, pattern: schedule.pattern },
        "Registered notification automation scheduler",
      );
    } catch (err) {
      captureError(err, {
        component: "queue-worker",
        phase: "scheduler-registration",
        schedulerId: schedule.schedulerId,
      });
      logger.error(
        { err, schedulerId: schedule.schedulerId, type: schedule.type, pattern: schedule.pattern },
        "Failed to register notification automation scheduler",
      );
    }
  }
}

// Recurring planner for automatic Ballet absence (see lib/balletAutoAbsence.ts
// for the two-stage plan/process design and the idempotency rationale).
async function registerBalletAutoAbsenceSchedulers(): Promise<void> {
  const queue = getQueue(QUEUE_NAMES.balletAutoAbsence);
  if (!queue) {
    logger.warn("Ballet auto-absence queue unavailable; skipping scheduler registration");
    return;
  }
  for (const schedule of BALLET_AUTO_ABSENCE_SCHEDULES) {
    try {
      await queue.upsertJobScheduler(
        schedule.schedulerId,
        { pattern: schedule.pattern },
        {
          name: "plan_due_occurrences",
          data: { type: "plan_due_occurrences", source: "scheduler" } satisfies BalletAutoAbsenceJob,
          opts: defaultJobOptions(),
        },
      );
      logger.info({ schedulerId: schedule.schedulerId, pattern: schedule.pattern }, "Registered Ballet auto-absence scheduler");
    } catch (err) {
      captureError(err, { component: "queue-worker", phase: "ballet-auto-absence-scheduler-registration", schedulerId: schedule.schedulerId });
      logger.error({ err, schedulerId: schedule.schedulerId, pattern: schedule.pattern }, "Failed to register Ballet auto-absence scheduler");
    }
  }
}

await registerNotificationAutomationSchedulers();
await registerBalletCancellationFinalizationSchedulers();
await registerBalletAutoAbsenceSchedulers();
await registerPackageCreditExpirationSchedulers();

logger.info("Queue worker started");

async function shutdown() {
  logger.info("Queue worker shutting down");
  const connectionQuit = connection ? connection.quit() : Promise.resolve();
  await Promise.all([whatsappWorker.close(), reportsWorker.close(), notificationAutomationWorker.close(), balletCancellationFinalizationWorker.close(), balletAutoAbsenceWorker.close(), packageCreditExpirationWorker.close(), connectionQuit]);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
