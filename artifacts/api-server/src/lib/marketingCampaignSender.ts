import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import {
  db,
  marketingCampaignRecipientsTable,
  marketingCampaignsTable,
  marketingDeliveryLogsTable,
  marketingOptInsTable,
  marketingTemplatesTable,
} from "@workspace/db";
import { isWhatsAppCloudEnabled, sendTemplateMessage, WhatsAppCloudError } from "./whatsappCloud";
import { logger } from "./logger";
import { enqueueJob, QUEUE_NAMES, type WhatsAppCampaignSendJob } from "./queue";

export type SendCampaignBatchInput = {
  campaignId: number;
  actorEmail?: string | null;
  ipAddress?: string | null;
};

export type SendCampaignBatchResult = {
  success: true;
  sentCount: number;
  sentAt: string | null;
  queued?: boolean;
};

function maxCampaignSendBatch(): number {
  const parsed = Number(process.env["WHATSAPP_MAX_CAMPAIGN_SEND"] ?? "5");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

export async function processWhatsAppCampaignBatch(input: SendCampaignBatchInput): Promise<SendCampaignBatchResult> {
  if (!isWhatsAppCloudEnabled()) {
    throw Object.assign(new Error("WhatsApp Cloud API is disabled. Set WHATSAPP_ENABLED=true to allow sends."), { status: 503 });
  }

  const [campaign] = await db.select().from(marketingCampaignsTable).where(eq(marketingCampaignsTable.id, input.campaignId));
  if (!campaign) {
    throw Object.assign(new Error("Campaign not found"), { status: 404 });
  }

  if (campaign.status !== "prepared" && campaign.status !== "sending") {
    throw Object.assign(new Error("Campaign must be in 'prepared' or 'sending' status to send."), { status: 400 });
  }

  if (!campaign.templateId) {
    throw Object.assign(new Error("Campaign must have an approved template to be sent."), { status: 400 });
  }

  const [template] = await db.select().from(marketingTemplatesTable).where(eq(marketingTemplatesTable.id, campaign.templateId));
  if (!template) {
    throw Object.assign(new Error("Associated campaign template not found."), { status: 400 });
  }

  if (template.status !== "approved" || !template.metaTemplateId) {
    throw Object.assign(new Error("Campaign template must be synced and approved on Meta to send."), { status: 400 });
  }

  const recipients = await db
    .select()
    .from(marketingCampaignRecipientsTable)
    .where(and(
      eq(marketingCampaignRecipientsTable.campaignId, campaign.id),
      eq(marketingCampaignRecipientsTable.status, "prepared"),
    ))
    .orderBy(marketingCampaignRecipientsTable.id)
    .limit(maxCampaignSendBatch());

  if (recipients.length === 0) {
    const [counts] = await db
      .select({
        failed: sql<number>`count(case when status = 'failed' then 1 end)::int`,
      })
      .from(marketingCampaignRecipientsTable)
      .where(eq(marketingCampaignRecipientsTable.campaignId, campaign.id));

    const finalStatus = (counts?.failed ?? 0) > 0 ? "partially_failed" : "completed";
    const now = new Date().toISOString();
    await db.update(marketingCampaignsTable).set({
      status: finalStatus,
      sentAt: now,
    }).where(eq(marketingCampaignsTable.id, campaign.id));

    return { success: true, sentCount: 0, sentAt: now };
  }

  const normalizedPhones = recipients.map((r) => r.normalizedPhone).filter((phone): phone is string => Boolean(phone));
  const optOutRows = normalizedPhones.length > 0
    ? await db.select().from(marketingOptInsTable).where(and(
      inArray(marketingOptInsTable.normalizedPhone, [...new Set(normalizedPhones)]),
      eq(marketingOptInsTable.channel, "whatsapp"),
      or(eq(marketingOptInsTable.status, "opted_out"), isNotNull(marketingOptInsTable.optedOutAt)),
    ))
    : [];
  const optedOutPhones = new Set(optOutRows.map((row) => row.normalizedPhone));

  let batchSentCount = 0;

  for (const recipient of recipients) {
    const [existingLogs] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(marketingDeliveryLogsTable)
      .where(eq(marketingDeliveryLogsTable.recipientId, recipient.id));
    const attempt = (existingLogs?.count ?? 0) + 1;

    if (!recipient.normalizedPhone) {
      await db.update(marketingCampaignRecipientsTable)
        .set({ status: "failed", errorMessage: "Missing normalized phone number.", updatedAt: new Date().toISOString() })
        .where(eq(marketingCampaignRecipientsTable.id, recipient.id));

      await db.insert(marketingDeliveryLogsTable).values({
        campaignId: campaign.id,
        recipientId: recipient.id,
        provider: "whatsapp_cloud",
        eventType: "failed",
        status: "failed",
        errorMessage: "Missing normalized phone number.",
        attempt,
        payload: { status: "missing_phone" },
      });
      continue;
    }

    if (optedOutPhones.has(recipient.normalizedPhone)) {
      await db.update(marketingCampaignRecipientsTable)
        .set({ status: "failed", errorMessage: "Recipient has opted out of WhatsApp messages.", updatedAt: new Date().toISOString() })
        .where(eq(marketingCampaignRecipientsTable.id, recipient.id));

      await db.insert(marketingDeliveryLogsTable).values({
        campaignId: campaign.id,
        recipientId: recipient.id,
        provider: "whatsapp_cloud",
        eventType: "failed",
        status: "failed",
        errorMessage: "Recipient has opted out of WhatsApp messages.",
        attempt,
        payload: { status: "opted_out" },
      });
      continue;
    }

    const toPhone = `+${recipient.normalizedPhone}`;
    const templateVars = template.variables ?? [];
    const parameters = templateVars.map((v) => {
      const varName = v.toLowerCase().trim();
      if (varName === "student_name" || varName === "name" || varName === "1") return recipient.name;
      if (varName === "first_name") return recipient.name.split(" ")[0] || recipient.name;
      if (varName === "student_email" || varName === "email" || varName === "2") return recipient.email || "";
      if (varName === "student_phone" || varName === "phone" || varName === "3") return recipient.phone || "";
      return "";
    });

    try {
      const result = await sendTemplateMessage({
        to: toPhone,
        templateName: template.name,
        languageCode: template.language,
        parameters,
      });

      await db.update(marketingCampaignRecipientsTable)
        .set({ status: "sent", updatedAt: new Date().toISOString() })
        .where(eq(marketingCampaignRecipientsTable.id, recipient.id));

      await db.insert(marketingDeliveryLogsTable).values({
        campaignId: campaign.id,
        recipientId: recipient.id,
        provider: "whatsapp_cloud",
        providerMessageId: result.providerMessageId,
        eventType: "sent",
        status: "sent",
        attempt,
        payload: result.raw,
      });

      batchSentCount++;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "WhatsApp Cloud API request failed.";
      let errorCode = undefined;
      let providerStatus = undefined;
      if (err instanceof WhatsAppCloudError) {
        errorCode = err.providerCode?.toString();
        providerStatus = err.providerStatus;
      }

      await db.update(marketingCampaignRecipientsTable)
        .set({ status: "failed", errorMessage: errorMsg, updatedAt: new Date().toISOString() })
        .where(eq(marketingCampaignRecipientsTable.id, recipient.id));

      await db.insert(marketingDeliveryLogsTable).values({
        campaignId: campaign.id,
        recipientId: recipient.id,
        provider: "whatsapp_cloud",
        eventType: "failed",
        status: "failed",
        errorCode,
        errorMessage: errorMsg,
        attempt,
        payload: { error: err instanceof Error ? err.stack : err, providerStatus },
      });
    }
  }

  const [counts] = await db
    .select({
      sent: sql<number>`count(case when status = 'sent' then 1 end)::int`,
      failed: sql<number>`count(case when status = 'failed' then 1 end)::int`,
      prepared: sql<number>`count(case when status = 'prepared' then 1 end)::int`,
    })
    .from(marketingCampaignRecipientsTable)
    .where(eq(marketingCampaignRecipientsTable.campaignId, campaign.id));

  const campaignFinished = (counts.prepared ?? 0) === 0;
  const newCampaignStatus = campaignFinished
    ? (counts.failed ?? 0) > 0 ? "partially_failed" : "completed"
    : "sending";
  const campaignSentAt = campaignFinished ? new Date().toISOString() : null;

  await db.update(marketingCampaignsTable).set({
    status: newCampaignStatus,
    sentCount: counts.sent ?? 0,
    sentAt: campaignSentAt,
  }).where(eq(marketingCampaignsTable.id, campaign.id));
  if (!campaignFinished) {
    try {
      await enqueueJob<WhatsAppCampaignSendJob>(
        QUEUE_NAMES.whatsappCampaigns,
        "send-campaign-batch",
        input,
        { delay: Number.parseInt(process.env["WHATSAPP_QUEUE_BATCH_DELAY_MS"] ?? "1000", 10) },
      );
    } catch (err) {
      logger.error({ err, campaignId: campaign.id }, "Failed to enqueue next WhatsApp campaign batch");
      throw err;
    }
  }

  return { success: true, sentCount: batchSentCount, sentAt: campaignSentAt };
}
