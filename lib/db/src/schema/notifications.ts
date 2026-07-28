import { sql } from "drizzle-orm";
import { boolean, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { studentsTable } from "./students";

export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  target: text("target").notNull().default("all"),
  type: text("type"),
  relatedEntityType: text("related_entity_type"),
  relatedEntityId: integer("related_entity_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
  sentAt: timestamp("sent_at", { withTimezone: true, mode: "string" }),
  isDraft: boolean("is_draft").notNull().default(true),
  // Generic worker-write dedupe key (migration 0072, originally reminder-only,
  // generalized for any deterministic automated-notification key). Nullable so
  // ordinary notifications are never subject to this constraint — only rows
  // written by an automated process (reminders, automatic Ballet absence,
  // ...) set this column. Formats in use: reminders
  // "booking:{bookingId}:{reminderType}:{occurrenceDate}"; Ballet absence
  // "ballet_absence:{attendanceId}".
  reminderIdempotencyKey: text("reminder_idempotency_key"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
}, (table) => ([
  uniqueIndex("notifications_reminder_idempotency_key_unique")
    .on(table.reminderIdempotencyKey)
    .where(sql`${table.reminderIdempotencyKey} is not null`),
]));

export const insertNotificationSchema = createInsertSchema(notificationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notificationsTable.$inferSelect;

export const notificationReadReceiptsTable = pgTable(
  "notification_read_receipts",
  {
    id: serial("id").primaryKey(),
    notificationId: integer("notification_id").notNull().references(() => notificationsTable.id, { onDelete: "cascade" }),
    studentId: integer("student_id").notNull().references(() => studentsTable.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueNotificationStudent: uniqueIndex("notification_read_receipts_notification_student_unique")
      .on(table.notificationId, table.studentId),
  }),
);

export const notificationDevicesTable = pgTable(
  "notification_devices",
  {
    id: serial("id").primaryKey(),
    studentId: integer("student_id").notNull().references(() => studentsTable.id, { onDelete: "cascade" }),
    pushToken: text("push_token").notNull(),
    provider: text("provider").notNull().default("expo"),
    platform: text("platform").notNull().default("unknown"),
    deviceId: text("device_id"),
    unregisterSecretHash: text("unregister_secret_hash"),
    isActive: boolean("is_active").notNull().default(true),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
  },
  (table) => ({
    uniquePushToken: uniqueIndex("notification_devices_push_token_unique").on(table.pushToken),
  }),
);

export const notificationDeliveryLogsTable = pgTable("notification_delivery_logs", {
  id: serial("id").primaryKey(),
  notificationId: integer("notification_id").references(() => notificationsTable.id, { onDelete: "set null" }),
  studentId: integer("student_id").references(() => studentsTable.id, { onDelete: "set null" }),
  deviceId: integer("device_id").references(() => notificationDevicesTable.id, { onDelete: "set null" }),
  channel: text("channel").notNull().default("push"),
  provider: text("provider").notNull().default("expo"),
  status: text("status").notNull().default("queued"),
  providerMessageId: text("provider_message_id"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  sentAt: timestamp("sent_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const notificationTemplatesTable = pgTable(
  "notification_templates",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull(),
    titleTemplate: text("title_template").notNull(),
    bodyTemplate: text("body_template").notNull(),
    language: text("language").notNull().default("en"),
    type: text("type"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
  },
  (table) => ({
    uniqueKey: uniqueIndex("notification_templates_key_unique").on(table.key),
  }),
);
