import * as Sentry from "@sentry/node";
import { logger } from "./logger";

let initialized = false;

export function initErrorMonitoring(): void {
  const dsn = process.env["SENTRY_DSN"]?.trim();
  if (!dsn || initialized) return;
  Sentry.init({
    dsn,
    environment: process.env["NODE_ENV"] ?? "development",
    tracesSampleRate: Number(process.env["SENTRY_TRACES_SAMPLE_RATE"] ?? "0"),
  });
  initialized = true;
  logger.info("Error monitoring initialized");
}

export function captureError(error: unknown, context?: Record<string, unknown>): void {
  if (initialized) {
    Sentry.captureException(error, { extra: context });
    return;
  }
  logger.error({ err: error, ...context }, "Captured server error");
}
