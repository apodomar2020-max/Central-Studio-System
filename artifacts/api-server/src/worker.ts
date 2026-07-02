import { Worker } from "bullmq";
import { logger } from "./lib/logger";
import { runMigrations } from "./lib/migrate";
import { captureError, initErrorMonitoring } from "./lib/errorMonitoring";
import {
  getQueueConnection,
  QUEUE_NAMES,
  workerEnabled,
  type ReportJob,
  type WhatsAppCampaignSendJob,
} from "./lib/queue";
import { processWhatsAppCampaignBatch } from "./lib/marketingCampaignSender";
import { processReportJob } from "./lib/reportJobs";

initErrorMonitoring();

if (!workerEnabled()) {
  logger.warn("Queue worker disabled. Set QUEUE_WORKER_ENABLED=true and REDIS_URL to process background jobs.");
  process.exit(0);
}

try {
  await runMigrations();
  logger.info("Worker database migrations up to date");
} catch (err) {
  captureError(err, { component: "queue-worker", phase: "migrate" });
  process.exit(1);
}

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

for (const worker of [whatsappWorker, reportsWorker]) {
  worker.on("failed", (job, err) => {
    captureError(err, { component: "queue-worker", queue: worker.name, jobId: job?.id });
  });
}

logger.info("Queue worker started");

async function shutdown() {
  logger.info("Queue worker shutting down");
  await Promise.all([whatsappWorker.close(), reportsWorker.close(), connection.quit()]);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
