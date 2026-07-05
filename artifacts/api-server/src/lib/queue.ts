import { Queue, type JobsOptions, type QueueOptions } from "bullmq";
import IORedis from "ioredis";
import { logger } from "./logger";

export const QUEUE_NAMES = {
  whatsappCampaigns: "whatsapp-campaigns",
  reports: "reports",
  notificationAutomation: "notification-automation",
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
};

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
    attempts: Number.parseInt(process.env["QUEUE_JOB_ATTEMPTS"] ?? "3", 10),
    backoff: { type: "exponential", delay: Number.parseInt(process.env["QUEUE_JOB_BACKOFF_MS"] ?? "5000", 10) },
    removeOnComplete: 100,
    removeOnFail: 500,
    ...options,
  });
}
