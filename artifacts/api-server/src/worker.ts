import { Worker } from "bullmq";
import { logger } from "./lib/logger";
import { captureError, initErrorMonitoring } from "./lib/errorMonitoring";
import {
  defaultJobOptions,
  getQueue,
  getQueueConnection,
  NOTIFICATION_AUTOMATION_SCHEDULES,
  QUEUE_NAMES,
  type NotificationAutomationJob,
  workerEnabled,
  type ReportJob,
  type WhatsAppCampaignSendJob,
} from "./lib/queue";
import { processWhatsAppCampaignBatch } from "./lib/marketingCampaignSender";
import { processReportJob } from "./lib/reportJobs";
import {
  runClassReminderAutomation,
  runPackageReminderAutomation,
  runPostClassReminderAutomation,
} from "./lib/notificationReminders";

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
  { connection, concurrency: Number.parseInt(process.env["WHATSAPP_QUEUE_CONCURRENCY"] ?? "1", 10) },
);

const reportsWorker = new Worker<ReportJob>(
  QUEUE_NAMES.reports,
  async (job) => {
    logger.info({ jobId: job.id, reportJobId: job.data.reportJobId }, "Processing report job");
    await processReportJob(job.data.reportJobId);
  },
  { connection, concurrency: Number.parseInt(process.env["REPORT_QUEUE_CONCURRENCY"] ?? "1", 10) },
);

const notificationAutomationWorker = new Worker<NotificationAutomationJob>(
  QUEUE_NAMES.notificationAutomation,
  async (job) => {
    logger.info({ jobId: job.id, type: job.data.type }, "Processing notification automation job");
    switch (job.data.type) {
      case "class_reminders":
        return runClassReminderAutomation();
      case "post_class_reminders":
        return runPostClassReminderAutomation();
      case "package_reminders":
        return runPackageReminderAutomation();
      default:
        throw new Error(`Unsupported notification automation job type: ${(job.data as { type?: string }).type}`);
    }
  },
  { connection, concurrency: Number.parseInt(process.env["NOTIFICATION_AUTOMATION_QUEUE_CONCURRENCY"] ?? "1", 10) },
);

for (const worker of [whatsappWorker, reportsWorker, notificationAutomationWorker]) {
  worker.on("failed", (job, err) => {
    captureError(err, { component: "queue-worker", queue: worker.name, jobId: job?.id });
  });
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

await registerNotificationAutomationSchedulers();

logger.info("Queue worker started");

async function shutdown() {
  logger.info("Queue worker shutting down");
  const connectionQuit = connection ? connection.quit() : Promise.resolve();
  await Promise.all([whatsappWorker.close(), reportsWorker.close(), notificationAutomationWorker.close(), connectionQuit]);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
