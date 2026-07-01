import { boolean, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { classesTable } from "./classes";
import { schedulesTable } from "./schedules";
import { studentsTable } from "./students";

export const marketingCampaignsTable = pgTable("marketing_campaigns", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  type: text("type").notNull().default("email"),
  status: text("status").notNull().default("draft"),
  templateId: integer("template_id"),
  subject: text("subject"),
  message: text("message").notNull().default(""),
  targetAudience: text("target_audience").notNull().default("students"),
  audienceType: text("audience_type").notNull().default("students"),
  audienceConfig: jsonb("audience_config").$type<Record<string, unknown> | null>(),
  recipientCount: integer("recipient_count").notNull().default(0),
  sentCount: integer("sent_count").notNull().default(0),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true, mode: "string" }),
  preparedAt: timestamp("prepared_at", { withTimezone: true, mode: "string" }),
  sentAt: timestamp("sent_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
});

export const insertMarketingCampaignSchema = createInsertSchema(marketingCampaignsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMarketingCampaign = z.infer<typeof insertMarketingCampaignSchema>;
export type MarketingCampaign = typeof marketingCampaignsTable.$inferSelect;

export const marketingTemplatesTable = pgTable("marketing_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull().default("marketing"),
  language: text("language").notNull().default("en"),
  body: text("body").notNull(),
  status: text("status").notNull().default("draft"),
  variables: jsonb("variables").$type<string[] | null>(),
  metaTemplateId: text("meta_template_id"),
  headerType: text("header_type"),
  headerText: text("header_text"),
  footer: text("footer"),
  buttons: jsonb("buttons").$type<any[] | null>(),
  rejectedReason: text("rejected_reason"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true, mode: "string" }),
  archivedAt: timestamp("archived_at", { withTimezone: true, mode: "string" }),
  rawMetaPayload: jsonb("raw_meta_payload").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
});

export const marketingCampaignRecipientsTable = pgTable("marketing_campaign_recipients", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").notNull().references(() => marketingCampaignsTable.id, { onDelete: "cascade" }),
  studentId: integer("student_id").references(() => studentsTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  normalizedPhone: text("normalized_phone"),
  audienceReason: text("audience_reason"),
  status: text("status").notNull().default("prepared"),
  errorMessage: text("error_message"),
  metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
});

export const marketingDeliveryLogsTable = pgTable("marketing_delivery_logs", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").references(() => marketingCampaignsTable.id, { onDelete: "cascade" }),
  recipientId: integer("recipient_id").references(() => marketingCampaignRecipientsTable.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("whatsapp_cloud"),
  providerMessageId: text("provider_message_id"),
  eventType: text("event_type").notNull(),
  status: text("status").notNull(),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  payload: jsonb("payload").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const marketingOptInsTable = pgTable("marketing_opt_ins", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").references(() => studentsTable.id, { onDelete: "cascade" }),
  phone: text("phone"),
  normalizedPhone: text("normalized_phone").notNull(),
  channel: text("channel").notNull().default("whatsapp"),
  status: text("status").notNull().default("opted_in"),
  source: text("source"),
  optedInAt: timestamp("opted_in_at", { withTimezone: true, mode: "string" }),
  optedOutAt: timestamp("opted_out_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
});

export const classWhatsappGroupsTable = pgTable("class_whatsapp_groups", {
  id: serial("id").primaryKey(),
  classId: integer("class_id").notNull().references(() => classesTable.id, { onDelete: "cascade" }),
  scheduleId: integer("schedule_id").references(() => schedulesTable.id, { onDelete: "cascade" }),
  title: text("title"),
  groupUrl: text("group_url").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
});

export const insertMarketingTemplateSchema = createInsertSchema(marketingTemplatesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertMarketingCampaignRecipientSchema = createInsertSchema(marketingCampaignRecipientsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertMarketingDeliveryLogSchema = createInsertSchema(marketingDeliveryLogsTable).omit({ id: true, createdAt: true });
export const insertMarketingOptInSchema = createInsertSchema(marketingOptInsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertClassWhatsappGroupSchema = createInsertSchema(classWhatsappGroupsTable).omit({ id: true, createdAt: true, updatedAt: true });

export type MarketingTemplate = typeof marketingTemplatesTable.$inferSelect;
export type MarketingCampaignRecipient = typeof marketingCampaignRecipientsTable.$inferSelect;
export type MarketingDeliveryLog = typeof marketingDeliveryLogsTable.$inferSelect;
export type MarketingOptIn = typeof marketingOptInsTable.$inferSelect;
export type ClassWhatsappGroup = typeof classWhatsappGroupsTable.$inferSelect;
