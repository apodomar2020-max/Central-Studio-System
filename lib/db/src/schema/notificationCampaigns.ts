import { boolean, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import {
  NOTIFICATION_CAMPAIGN_AUDIENCE_TYPES,
  NOTIFICATION_CAMPAIGN_RECIPIENT_STATUSES,
  NOTIFICATION_CAMPAIGN_STATUSES,
  type NotificationCampaignAudienceType,
  type NotificationCampaignRecipientStatus,
  type NotificationCampaignStatus,
} from "@workspace/api-zod";
import { notificationsTable } from "./notifications";
import { studentsTable } from "./students";
import { systemUsersTable } from "./systemUsers";

export {
  NOTIFICATION_CAMPAIGN_AUDIENCE_TYPES,
  NOTIFICATION_CAMPAIGN_RECIPIENT_STATUSES,
  NOTIFICATION_CAMPAIGN_STATUSES,
};
export type {
  NotificationCampaignAudienceType,
  NotificationCampaignRecipientStatus,
  NotificationCampaignStatus,
};

/**
 * notification_campaigns — Wave 2: one logical Manual Push Campaign.
 *
 * Deliberately a distinct entity from marketing_campaigns (WhatsApp/email):
 * different channel, different delivery mechanics (Expo push devices, not
 * phone numbers), different recipient model (account-level push devices,
 * not opt-in phone contacts) — reusing marketing_campaigns would overload
 * a schema already shaped around WhatsApp Cloud specifics (templates,
 * opt-ins, provider message ids in a different shape). See the Wave 2
 * report for the full reasoning.
 *
 * Lifecycle: draft → ready → sending → completed | completed_with_errors | failed
 *            (any status) → archived
 * See NOTIFICATION_CAMPAIGN_STATUSES / _EDITABLE_ / _SENDABLE_ / _DELETABLE_.
 *
 * Aggregate device/account counters below (intendedRecipientCount ..
 * noDeviceAccountCount) are a WRITE-ONCE snapshot computed authoritatively
 * from notification_campaign_recipients + notification_delivery_logs the
 * moment send() finishes, and never updated again afterward — Wave 2 has no
 * retry/reconciliation path that would change them post-send, so treating
 * them as an immutable settled fact (mirroring "sent campaign content must
 * not mutate historically") is safe. They exist purely as a fast list-view
 * cache; the campaign-recipients/delivery-logs tables remain the
 * authoritative source of truth and campaign detail re-derives from them
 * live rather than trusting the cache, so a cache bug can never surface as
 * a wrong number in the one place an operator would actually check it.
 *
 * Read count is intentionally NOT cached here (no readAccountCount column):
 * unlike the device counters, reads keep accumulating for the lifetime of
 * the campaign (including after archive), so a write-once cache would
 * drift by design, not by bug. It is always derived live — see
 * lib/notificationCampaigns.ts's aggregateCampaignReads.
 */
export const notificationCampaignsTable = pgTable(
  "notification_campaigns",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    audienceType: text("audience_type").notNull().default("all"),
    audienceConfig: jsonb("audience_config").$type<Record<string, unknown> | null>(),
    status: text("status").notNull().default("draft"),
    createdByAdminId: integer("created_by_admin_id").references(() => systemUsersTable.id, { onDelete: "set null" }),
    // The one canonical mobile-visible notifications row for this campaign —
    // created at send time (never at draft time), target = "campaign:{id}".
    // See routes/notifications.ts's visibility extension.
    notificationId: integer("notification_id").references(() => notificationsTable.id, { onDelete: "set null" }),
    previewedAt: timestamp("previewed_at", { withTimezone: true, mode: "string" }),
    sentAt: timestamp("sent_at", { withTimezone: true, mode: "string" }),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "string" }),
    // Write-once at send completion — see the table-level doc comment above.
    intendedRecipientCount: integer("intended_recipient_count").notNull().default(0),
    pushEnabledAccountCount: integer("push_enabled_account_count").notNull().default(0),
    activeDeviceCount: integer("active_device_count").notNull().default(0),
    sentDeviceCount: integer("sent_device_count").notNull().default(0),
    failedDeviceCount: integer("failed_device_count").notNull().default(0),
    noDeviceAccountCount: integer("no_device_account_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
  },
  (table) => ([
    index("notification_campaigns_status_created_at_idx").on(table.status, table.createdAt),
    index("notification_campaigns_notification_id_idx").on(table.notificationId),
  ]),
);

export const insertNotificationCampaignSchema = createInsertSchema(notificationCampaignsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertNotificationCampaign = z.infer<typeof insertNotificationCampaignSchema>;
export type NotificationCampaign = typeof notificationCampaignsTable.$inferSelect;

/**
 * notification_campaign_recipients — the frozen recipient snapshot.
 *
 * One row per intended ACCOUNT (never per device, never per child) at the
 * moment send() resolves the audience — this is the architectural core of
 * Wave 2 (see the report's "Recipient Snapshot Model" section). Frozen
 * means literally that: these rows are written once, at send time, and are
 * never re-derived, re-resolved, or deleted afterward — a later change to
 * who technically matches the campaign's audienceConfig (e.g. a new
 * account, a device change) has zero effect on this table.
 *
 * No push token, no email/phone, no name is stored here — a snapshot row
 * establishes "this account was in scope" and "what happened for them",
 * not a durable copy of their contact details. Historical display, if ever
 * needed, joins to students.id live (already how notification_delivery_logs
 * displays student identity).
 */
export const notificationCampaignRecipientsTable = pgTable(
  "notification_campaign_recipients",
  {
    id: serial("id").primaryKey(),
    campaignId: integer("campaign_id").notNull().references(() => notificationCampaignsTable.id, { onDelete: "cascade" }),
    // SET NULL (not CASCADE) — mirrors notification_delivery_logs.studentId:
    // if the account is later deleted, this historical aggregate row (and
    // the campaign's intendedRecipientCount it contributes to) must survive.
    studentId: integer("student_id").references(() => studentsTable.id, { onDelete: "set null" }),
    status: text("status").notNull().default("pending"),
    // Facts as they stood at the moment of freezing — never re-queried or
    // updated afterward, so historical display never silently reinterprets
    // what was actually true when the campaign was sent. Push delivery
    // itself queries notification_devices fresh at send time (not these
    // columns), so `status` below can legitimately disagree with these —
    // e.g. hadActiveDeviceAtSnapshot=true but status='no_device' (the
    // recipient logged out in between), or the reverse (they registered a
    // device in between and still received the push). Not a bug — see
    // CampaignSendResult's doc comment in lib/notificationCampaigns.ts.
    hadActiveDeviceAtSnapshot: boolean("had_active_device_at_snapshot").notNull().default(false),
    activeDeviceCountAtSnapshot: integer("active_device_count_at_snapshot").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
  },
  (table) => ([
    uniqueIndex("notification_campaign_recipients_campaign_student_unique").on(table.campaignId, table.studentId),
    index("notification_campaign_recipients_campaign_id_idx").on(table.campaignId),
    index("notification_campaign_recipients_student_id_idx").on(table.studentId),
    index("notification_campaign_recipients_status_idx").on(table.status),
  ]),
);

export const insertNotificationCampaignRecipientSchema = createInsertSchema(notificationCampaignRecipientsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertNotificationCampaignRecipient = z.infer<typeof insertNotificationCampaignRecipientSchema>;
export type NotificationCampaignRecipient = typeof notificationCampaignRecipientsTable.$inferSelect;
