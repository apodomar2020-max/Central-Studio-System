import { boolean, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// One row per worker process (migration 0074), upserted by the BullMQ worker
// so Admin can see Worker-side reminder health — the API process only knows
// its own PUSH_NOTIFICATIONS_ENABLED value, not the Worker's. Keyed by
// workerName (not a singleton id) so a future multi-worker deployment can
// report independently without a schema change.
export const reminderWorkerHeartbeatsTable = pgTable("reminder_worker_heartbeats", {
  workerName: text("worker_name").primaryKey(),
  lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  lastReminderRunAt: timestamp("last_reminder_run_at", { withTimezone: true, mode: "string" }),
  lastReminderRunStatus: text("last_reminder_run_status"),
  // Safe, PII-free counters only (see AutomationSummary) — never raw provider
  // payloads, tokens, or student-identifying data.
  lastReminderRunSummary: jsonb("last_reminder_run_summary").$type<Record<string, unknown> | null>(),
  pushNotificationsEnabled: boolean("push_notifications_enabled").notNull().default(false),
  queueWorkerEnabled: boolean("queue_worker_enabled").notNull().default(false),
  deployedVersion: text("deployed_version"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
});

export type ReminderWorkerHeartbeat = typeof reminderWorkerHeartbeatsTable.$inferSelect;
