import { logger } from "./logger";

type SentryModule = typeof import("@sentry/node");

let initialized = false;
let sentry: SentryModule | null = null;

export async function initErrorMonitoring(): Promise<void> {
  const dsn = process.env["SENTRY_DSN"]?.trim();
  if (!dsn || initialized) return;
  try {
    sentry = await import("@sentry/node");
    sentry.init({
      dsn,
      environment: process.env["NODE_ENV"] ?? "development",
      tracesSampleRate: Number(process.env["SENTRY_TRACES_SAMPLE_RATE"] ?? "0"),
      sendDefaultPii: false,
      beforeSend(event) {
        delete event.user; delete event.request; delete event.extra; delete event.breadcrumbs;
        delete event.message; delete event.contexts;
        for (const exception of event.exception?.values ?? []) exception.value = "Server error (details removed for privacy)";
        return event;
      },
    });
    initialized = true;
    logger.info("Error monitoring initialized");
  } catch (err) {
    logger.error({ err }, "Error monitoring failed to initialize");
  }
}

export function captureError(error: unknown, context?: Record<string, unknown>): void {
  if (initialized && sentry) {
    sentry.captureException(error, { extra: context });
    return;
  }
  logger.error({ err: error, ...context }, "Captured server error");
}
