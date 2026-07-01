import { Router, type IRouter } from "express";
import { and, desc, eq, gt, inArray, isNotNull, like, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  bookingsTable,
  classWhatsappGroupsTable,
  classesTable,
  db,
  marketingCampaignRecipientsTable,
  marketingCampaignsTable,
  marketingDeliveryLogsTable,
  marketingOptInsTable,
  marketingTemplatesTable,
  packageOrdersTable,
  schedulesTable,
  studentsTable,
} from "@workspace/db";
import { requireAdminAuth, requireAdminPermission } from "./adminAuth";
import {
  assertValidE164Phone,
  getWhatsAppCloudStatus,
  isWhatsAppCloudEnabled,
  sendTemplateMessage,
  WhatsAppCloudError,
  type WhatsAppTemplateParameter,
} from "../lib/whatsappCloud";
import {
  DeleteCampaignParams,
  GetCampaignParams,
  SendCampaignResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const audienceTypeValues = [
  "all",
  "students",
  "parents",
  "class",
  "schedule",
  "bookingStatus",
  "activePackage",
  "packageExpiringSoon",
  "manual",
] as const;

const CampaignBody = z.object({
  title: z.string().min(1),
  type: z.enum(["whatsapp", "email"]).default("whatsapp"),
  templateId: z.coerce.number().int().positive().nullish(),
  subject: z.string().nullish(),
  message: z.string().min(1),
  targetAudience: z.string().nullish(),
  audienceType: z.enum(audienceTypeValues).default("students"),
  audienceConfig: z.record(z.string(), z.unknown()).nullish(),
});

const UpdateCampaignBody = CampaignBody.partial();

const TemplateBody = z.object({
  name: z.string().min(1),
  category: z.enum(["utility", "marketing"]).default("marketing"),
  language: z.string().min(2).default("en"),
  body: z.string().min(1),
  status: z.enum(["draft", "approved", "archived"]).default("draft"),
  variables: z.array(z.string()).nullish(),
});

const ClassGroupBody = z.object({
  classId: z.coerce.number().int().positive(),
  scheduleId: z.coerce.number().int().positive().nullish(),
  title: z.string().nullish(),
  groupUrl: z.string().url(),
  isActive: z.boolean().default(true),
});

const PreviewBody = z.object({
  audienceType: z.enum(audienceTypeValues).optional(),
  audienceConfig: z.record(z.string(), z.unknown()).nullish(),
});

const WhatsAppTestSendBody = z.object({
  to: z.string().min(1),
  templateName: z.string().min(1),
  languageCode: z.string().min(1).default("en_US"),
  parameters: z.array(z.union([
    z.string(),
    z.number(),
    z.object({
      type: z.literal("text"),
      text: z.string(),
    }),
  ])).default([]),
});

type AudienceType = (typeof audienceTypeValues)[number];
type AudienceConfig = Record<string, unknown> | null | undefined;
type StudentRow = typeof studentsTable.$inferSelect;

function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  if (!trimmed) return null;

  let digits = trimmed.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  digits = digits.replace(/\D/g, "");

  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("01") && digits.length === 11) digits = `20${digits.slice(1)}`;
  if (digits.startsWith("1") && digits.length === 10) digits = `20${digits}`;

  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

function asNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumberArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.map((entry) => Number(entry)).filter((entry) => Number.isFinite(entry) && entry > 0)
    : [];
}

function mapAudienceToLegacyTarget(audienceType: AudienceType): string {
  if (audienceType === "all" || audienceType === "parents" || audienceType === "students") return audienceType;
  return audienceType;
}

async function countAudience(audienceType: AudienceType, audienceConfig: AudienceConfig): Promise<number> {
  const preview = await resolveRecipients(audienceType, audienceConfig, 0);
  return preview.eligibleCount;
}

async function studentsByIds(ids: number[]): Promise<StudentRow[]> {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return [];
  return db.select().from(studentsTable).where(inArray(studentsTable.id, uniqueIds));
}

async function resolveAudienceStudents(audienceType: AudienceType, audienceConfig: AudienceConfig): Promise<Array<StudentRow & { audienceReason?: string }>> {
  const config = audienceConfig ?? {};

  if (audienceType === "all") {
    return db.select().from(studentsTable);
  }

  if (audienceType === "students") {
    return db.select().from(studentsTable).where(sql`coalesce(${studentsTable.accountType}, 'student') <> 'parent'`);
  }

  if (audienceType === "parents") {
    return db.select().from(studentsTable).where(eq(studentsTable.accountType, "parent"));
  }

  if (audienceType === "manual") {
    return studentsByIds(asNumberArray(config["studentIds"]));
  }

  if (audienceType === "class" || audienceType === "schedule" || audienceType === "bookingStatus") {
    const classId = asNumber(config["classId"]);
    const scheduleId = asNumber(config["scheduleId"]);
    const bookingStatus = asString(config["bookingStatus"]);
    const occurrenceDate = asString(config["occurrenceDate"]);

    const rows = await db
      .select({
        studentId: bookingsTable.accountOwnerStudentId,
        studentEmail: bookingsTable.studentEmail,
      })
      .from(bookingsTable)
      .where(and(
        audienceType === "class" && classId ? eq(bookingsTable.classId, classId) : undefined,
        audienceType === "schedule" && scheduleId ? eq(bookingsTable.scheduleId, scheduleId) : undefined,
        audienceType === "schedule" && occurrenceDate ? eq(bookingsTable.occurrenceDate, occurrenceDate) : undefined,
        audienceType === "bookingStatus" && bookingStatus ? eq(bookingsTable.bookingStatus, bookingStatus) : undefined,
      ));

    const ids = rows.map((row) => row.studentId).filter((id): id is number => typeof id === "number");
    const emails = rows.map((row) => row.studentEmail?.trim().toLowerCase()).filter((email): email is string => Boolean(email));
    if (ids.length === 0 && emails.length === 0) return [];

    return db
      .select()
      .from(studentsTable)
      .where(or(
        ids.length > 0 ? inArray(studentsTable.id, [...new Set(ids)]) : undefined,
        emails.length > 0 ? inArray(sql`lower(trim(${studentsTable.email}))`, [...new Set(emails)]) : undefined,
      ));
  }

  if (audienceType === "activePackage" || audienceType === "packageExpiringSoon") {
    const now = new Date();
    const expiringBefore = new Date(now);
    expiringBefore.setDate(expiringBefore.getDate() + Number(config["days"] ?? 14));

    const rows = await db
      .select({
        studentId: packageOrdersTable.studentId,
        studentEmail: packageOrdersTable.studentEmail,
      })
      .from(packageOrdersTable)
      .where(and(
        eq(packageOrdersTable.status, "active"),
        gt(packageOrdersTable.remainingCredits, 0),
        audienceType === "packageExpiringSoon"
          ? and(
            isNotNull(packageOrdersTable.expiresAt),
            lte(packageOrdersTable.expiresAt, expiringBefore.toISOString()),
          )
          : undefined,
      ));

    const ids = rows.map((row) => row.studentId).filter((id): id is number => typeof id === "number");
    const emails = rows.map((row) => row.studentEmail?.trim().toLowerCase()).filter((email): email is string => Boolean(email));
    if (ids.length === 0 && emails.length === 0) return [];

    return db
      .select()
      .from(studentsTable)
      .where(or(
        ids.length > 0 ? inArray(studentsTable.id, [...new Set(ids)]) : undefined,
        emails.length > 0 ? inArray(sql`lower(trim(${studentsTable.email}))`, [...new Set(emails)]) : undefined,
      ));
  }

  return [];
}

async function resolveRecipients(audienceType: AudienceType, audienceConfig: AudienceConfig, sampleLimit = 25) {
  const students = await resolveAudienceStudents(audienceType, audienceConfig);
  const seen = new Set<string>();
  const normalizedPhones = students.map((student) => normalizePhone(student.phone)).filter((phone): phone is string => Boolean(phone));
  const optOutRows = normalizedPhones.length > 0
    ? await db.select().from(marketingOptInsTable).where(and(
      inArray(marketingOptInsTable.normalizedPhone, [...new Set(normalizedPhones)]),
      eq(marketingOptInsTable.channel, "whatsapp"),
      or(eq(marketingOptInsTable.status, "opted_out"), isNotNull(marketingOptInsTable.optedOutAt)),
    ))
    : [];
  const optedOutPhones = new Set(optOutRows.map((row) => row.normalizedPhone));

  const excluded = { missingPhone: 0, invalidPhone: 0, optedOut: 0, duplicate: 0 };
  const eligible = [];

  for (const student of students) {
    if (!student.phone) {
      excluded.missingPhone += 1;
      continue;
    }
    const normalizedPhone = normalizePhone(student.phone);
    if (!normalizedPhone) {
      excluded.invalidPhone += 1;
      continue;
    }
    if (optedOutPhones.has(normalizedPhone)) {
      excluded.optedOut += 1;
      continue;
    }
    if (seen.has(normalizedPhone)) {
      excluded.duplicate += 1;
      continue;
    }
    seen.add(normalizedPhone);
    eligible.push({
      studentId: student.id,
      name: student.name,
      email: student.email,
      phone: student.phone,
      normalizedPhone,
      accountType: student.accountType,
      audienceReason: audienceType,
    });
  }

  return {
    totalCandidates: students.length,
    eligibleCount: eligible.length,
    excluded,
    sample: sampleLimit > 0 ? eligible.slice(0, sampleLimit) : [],
    recipients: eligible,
  };
}

router.get("/marketing/whatsapp/status", requireAdminAuth, requireAdminPermission("marketing", "view"), async (req, res): Promise<void> => {
  res.json(getWhatsAppCloudStatus());
});

router.post("/marketing/whatsapp/test-send", requireAdminAuth, requireAdminPermission("marketing", "send"), async (req, res): Promise<void> => {
  if (!isWhatsAppCloudEnabled()) {
    res.status(503).json({ error: "WhatsApp Cloud API is disabled. Set WHATSAPP_ENABLED=true to allow test sends." });
    return;
  }

  const parsed = WhatsAppTestSendBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const result = await sendTemplateMessage({
      to: assertValidE164Phone(parsed.data.to),
      templateName: parsed.data.templateName,
      languageCode: parsed.data.languageCode,
      parameters: parsed.data.parameters as WhatsAppTemplateParameter[],
    });
    res.json({
      success: true,
      provider: "whatsapp_cloud",
      messageId: result.providerMessageId,
      providerMessageId: result.providerMessageId,
      rawStatus: result.raw.messages?.[0]?.message_status ?? "accepted",
      raw: result.raw,
    });
  } catch (err) {
    if (err instanceof WhatsAppCloudError) {
      res.status(err.statusCode).json({
        error: err.message,
        providerStatus: err.providerStatus,
        providerCode: err.providerCode,
      });
      return;
    }
    res.status(500).json({ error: "WhatsApp test send failed." });
  }
});

router.get("/marketing/templates", requireAdminAuth, requireAdminPermission("marketing", "view"), async (req, res): Promise<void> => {
  const rows = await db.select().from(marketingTemplatesTable).orderBy(desc(marketingTemplatesTable.createdAt));
  res.json(rows);
});

router.post("/marketing/templates", requireAdminAuth, requireAdminPermission("marketing", "create"), async (req, res): Promise<void> => {
  const parsed = TemplateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.insert(marketingTemplatesTable).values(parsed.data).returning();
  res.status(201).json(row);
});

router.patch("/marketing/templates/:id", requireAdminAuth, requireAdminPermission("marketing", "edit"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const parsed = TemplateBody.partial().safeParse(req.body);
  if (!Number.isFinite(id) || !parsed.success) {
    res.status(400).json({ error: !parsed.success ? parsed.error.message : "Invalid template id" });
    return;
  }
  const [row] = await db.update(marketingTemplatesTable).set(parsed.data).where(eq(marketingTemplatesTable.id, id)).returning();
  if (!row) {
    res.status(404).json({ error: "Template not found" });
    return;
  }
  res.json(row);
});

router.get("/marketing/audience/search", requireAdminAuth, requireAdminPermission("marketing", "view"), async (req, res): Promise<void> => {
  const q = String(req.query.q ?? "").trim();
  if (q.length < 2) {
    res.json([]);
    return;
  }
  const pattern = `%${q.toLowerCase()}%`;
  const rows = await db
    .select({
      id: studentsTable.id,
      name: studentsTable.name,
      email: studentsTable.email,
      phone: studentsTable.phone,
      accountType: studentsTable.accountType,
    })
    .from(studentsTable)
    .where(or(
      like(sql`lower(${studentsTable.name})`, pattern),
      like(sql`lower(${studentsTable.email})`, pattern),
      like(sql`coalesce(${studentsTable.phone}, '')`, `%${q}%`),
    ))
    .limit(25);
  res.json(rows);
});

router.get("/marketing/class-groups", requireAdminAuth, requireAdminPermission("marketing", "view"), async (req, res): Promise<void> => {
  const rows = await db
    .select({
      id: classWhatsappGroupsTable.id,
      classId: classWhatsappGroupsTable.classId,
      scheduleId: classWhatsappGroupsTable.scheduleId,
      title: classWhatsappGroupsTable.title,
      groupUrl: classWhatsappGroupsTable.groupUrl,
      isActive: classWhatsappGroupsTable.isActive,
      createdAt: classWhatsappGroupsTable.createdAt,
      classTitle: classesTable.title,
      scheduleDate: schedulesTable.date,
      scheduleDayOfWeek: schedulesTable.dayOfWeek,
      scheduleStartTime: schedulesTable.startTime,
    })
    .from(classWhatsappGroupsTable)
    .leftJoin(classesTable, eq(classWhatsappGroupsTable.classId, classesTable.id))
    .leftJoin(schedulesTable, eq(classWhatsappGroupsTable.scheduleId, schedulesTable.id))
    .orderBy(desc(classWhatsappGroupsTable.createdAt));
  res.json(rows);
});

router.post("/marketing/class-groups", requireAdminAuth, requireAdminPermission("marketing", "edit"), async (req, res): Promise<void> => {
  const parsed = ClassGroupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.insert(classWhatsappGroupsTable).values(parsed.data).returning();
  res.status(201).json(row);
});

router.patch("/marketing/class-groups/:id", requireAdminAuth, requireAdminPermission("marketing", "edit"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const parsed = ClassGroupBody.partial().safeParse(req.body);
  if (!Number.isFinite(id) || !parsed.success) {
    res.status(400).json({ error: !parsed.success ? parsed.error.message : "Invalid group id" });
    return;
  }
  const [row] = await db.update(classWhatsappGroupsTable).set(parsed.data).where(eq(classWhatsappGroupsTable.id, id)).returning();
  if (!row) {
    res.status(404).json({ error: "Group link not found" });
    return;
  }
  res.json(row);
});

router.get("/marketing/campaigns", requireAdminAuth, requireAdminPermission("marketing", "view"), async (req, res): Promise<void> => {
  const rows = await db
    .select({
      id: marketingCampaignsTable.id,
      title: marketingCampaignsTable.title,
      type: marketingCampaignsTable.type,
      status: marketingCampaignsTable.status,
      templateId: marketingCampaignsTable.templateId,
      subject: marketingCampaignsTable.subject,
      message: marketingCampaignsTable.message,
      targetAudience: marketingCampaignsTable.targetAudience,
      audienceType: marketingCampaignsTable.audienceType,
      audienceConfig: marketingCampaignsTable.audienceConfig,
      recipientCount: marketingCampaignsTable.recipientCount,
      sentCount: marketingCampaignsTable.sentCount,
      scheduledAt: marketingCampaignsTable.scheduledAt,
      preparedAt: marketingCampaignsTable.preparedAt,
      sentAt: marketingCampaignsTable.sentAt,
      createdAt: marketingCampaignsTable.createdAt,
      updatedAt: marketingCampaignsTable.updatedAt,
      failedCount: sql<number>`(select count(*)::int from marketing_campaign_recipients where campaign_id = ${marketingCampaignsTable.id} and status = 'failed')`,
      preparedCount: sql<number>`(select count(*)::int from marketing_campaign_recipients where campaign_id = ${marketingCampaignsTable.id} and status = 'prepared')`,
    })
    .from(marketingCampaignsTable)
    .orderBy(desc(marketingCampaignsTable.createdAt));
  res.json(rows);
});

router.post("/marketing/campaigns", requireAdminAuth, requireAdminPermission("marketing", "create"), async (req, res): Promise<void> => {
  const parsed = CampaignBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const audienceType = parsed.data.audienceType;
  const audienceConfig = parsed.data.audienceConfig ?? null;
  const recipientCount = await countAudience(audienceType, audienceConfig);
  const [row] = await db.insert(marketingCampaignsTable).values({
    ...parsed.data,
    targetAudience: parsed.data.targetAudience ?? mapAudienceToLegacyTarget(audienceType),
    audienceConfig,
    recipientCount,
    status: "draft",
  }).returning();
  res.status(201).json(row);
});

router.get("/marketing/campaigns/:id", requireAdminAuth, requireAdminPermission("marketing", "view"), async (req, res): Promise<void> => {
  const params = GetCampaignParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.select().from(marketingCampaignsTable).where(eq(marketingCampaignsTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  res.json(row);
});

router.patch("/marketing/campaigns/:id", requireAdminAuth, requireAdminPermission("marketing", "edit"), async (req, res): Promise<void> => {
  const params = GetCampaignParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateCampaignBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updateData = { ...parsed.data };
  if (parsed.data.audienceType || parsed.data.audienceConfig) {
    const [existing] = await db.select().from(marketingCampaignsTable).where(eq(marketingCampaignsTable.id, params.data.id));
    if (!existing) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    const audienceType = parsed.data.audienceType ?? (existing.audienceType as AudienceType);
    const audienceConfig = parsed.data.audienceConfig ?? existing.audienceConfig;
    updateData.targetAudience = parsed.data.targetAudience ?? mapAudienceToLegacyTarget(audienceType);
    updateData.recipientCount = await countAudience(audienceType, audienceConfig);
  }
  const [row] = await db.update(marketingCampaignsTable).set(updateData).where(eq(marketingCampaignsTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  res.json(row);
});

router.delete("/marketing/campaigns/:id", requireAdminAuth, requireAdminPermission("marketing", "delete"), async (req, res): Promise<void> => {
  const params = DeleteCampaignParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.delete(marketingCampaignsTable).where(eq(marketingCampaignsTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  res.sendStatus(204);
});

router.post("/marketing/campaigns/:id/preview-recipients", requireAdminAuth, requireAdminPermission("marketing", "view"), async (req, res): Promise<void> => {
  const params = GetCampaignParams.safeParse(req.params);
  const body = PreviewBody.safeParse(req.body ?? {});
  if (!params.success || !body.success) {
    res.status(400).json({ error: !params.success ? params.error.message : body.error.message });
    return;
  }
  const [campaign] = await db.select().from(marketingCampaignsTable).where(eq(marketingCampaignsTable.id, params.data.id));
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  const audienceType = body.data.audienceType ?? (campaign.audienceType as AudienceType);
  const audienceConfig = body.data.audienceConfig ?? campaign.audienceConfig;
  const preview = await resolveRecipients(audienceType, audienceConfig, 25);
  res.json({
    audienceType,
    audienceConfig,
    totalCandidates: preview.totalCandidates,
    eligibleCount: preview.eligibleCount,
    excluded: preview.excluded,
    sample: preview.sample,
  });
});

router.post("/marketing/campaigns/:id/prepare", requireAdminAuth, requireAdminPermission("marketing", "send"), async (req, res): Promise<void> => {
  const params = GetCampaignParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [campaign] = await db.select().from(marketingCampaignsTable).where(eq(marketingCampaignsTable.id, params.data.id));
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  const preview = await resolveRecipients(campaign.audienceType as AudienceType, campaign.audienceConfig, 0);
  const preparedAt = new Date().toISOString();
  await db.transaction(async (tx) => {
    await tx.delete(marketingCampaignRecipientsTable).where(eq(marketingCampaignRecipientsTable.campaignId, campaign.id));
    if (preview.recipients.length > 0) {
      await tx.insert(marketingCampaignRecipientsTable).values(preview.recipients.map((recipient) => ({
        campaignId: campaign.id,
        studentId: recipient.studentId,
        name: recipient.name,
        email: recipient.email,
        phone: recipient.phone,
        normalizedPhone: recipient.normalizedPhone,
        audienceReason: recipient.audienceReason,
        status: "prepared",
        metadata: { accountType: recipient.accountType },
      })));
    }
    await tx.insert(marketingDeliveryLogsTable).values({
      campaignId: campaign.id,
      eventType: "prepared",
      status: "prepared",
      payload: { eligibleCount: preview.eligibleCount, excluded: preview.excluded },
    });
    await tx.update(marketingCampaignsTable).set({
      status: "prepared",
      preparedAt,
      recipientCount: preview.eligibleCount,
      sentCount: 0,
    }).where(eq(marketingCampaignsTable.id, campaign.id));
  });
  res.json({ success: true, preparedAt, recipientCount: preview.eligibleCount, excluded: preview.excluded });
});

router.get("/marketing/campaigns/:id/recipients", requireAdminAuth, requireAdminPermission("marketing", "view"), async (req, res): Promise<void> => {
  const params = GetCampaignParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const rows = await db
    .select()
    .from(marketingCampaignRecipientsTable)
    .where(eq(marketingCampaignRecipientsTable.campaignId, params.data.id))
    .orderBy(marketingCampaignRecipientsTable.id);
  res.json(rows);
});

router.post("/marketing/campaigns/:id/send", requireAdminAuth, requireAdminPermission("marketing", "send"), async (req, res): Promise<void> => {
  if (!isWhatsAppCloudEnabled()) {
    res.status(503).json({ error: "WhatsApp Cloud API is disabled. Set WHATSAPP_ENABLED=true to allow sends." });
    return;
  }

  const params = GetCampaignParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [campaign] = await db.select().from(marketingCampaignsTable).where(eq(marketingCampaignsTable.id, params.data.id));
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  if (campaign.status !== "prepared" && campaign.status !== "sending") {
    res.status(400).json({ error: "Campaign must be in 'prepared' or 'sending' status to send." });
    return;
  }

  if (!campaign.templateId) {
    res.status(400).json({ error: "Campaign must have an approved template to be sent." });
    return;
  }

  const [template] = await db.select().from(marketingTemplatesTable).where(eq(marketingTemplatesTable.id, campaign.templateId));
  if (!template) {
    res.status(400).json({ error: "Associated campaign template not found." });
    return;
  }

  if (template.status !== "approved") {
    res.status(400).json({ error: "Campaign template must be approved to send." });
    return;
  }

  const maxSend = process.env["WHATSAPP_MAX_CAMPAIGN_SEND"] ? Number(process.env["WHATSAPP_MAX_CAMPAIGN_SEND"]) : 5;

  // Fetch next batch of prepared recipients
  const recipients = await db
    .select()
    .from(marketingCampaignRecipientsTable)
    .where(and(
      eq(marketingCampaignRecipientsTable.campaignId, campaign.id),
      eq(marketingCampaignRecipientsTable.status, "prepared")
    ))
    .orderBy(marketingCampaignRecipientsTable.id)
    .limit(maxSend);

  if (recipients.length === 0) {
    // Transition status to sent if no prepared recipients are left
    const now = new Date().toISOString();
    await db.update(marketingCampaignsTable).set({
      status: "sent",
      sentAt: now,
    }).where(eq(marketingCampaignsTable.id, campaign.id));

    res.json(SendCampaignResponse.parse({
      success: true,
      sentCount: 0,
      sentAt: now,
    }));
    return;
  }

  // Check opted-out recipients in this batch
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

  // Process recipients sequentially to avoid holding DB connections open during HTTP calls
  for (const recipient of recipients) {
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
        payload: { status: "missing_phone" }
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
        payload: { status: "opted_out" }
      });
      continue;
    }

    // Convert normalized phone to E.164 with a leading + before Meta call
    const toPhone = `+${recipient.normalizedPhone}`;
    const templateVars = template.variables ?? [];

    const parameters = templateVars.map((v) => {
      const varName = v.toLowerCase().trim();
      if (varName === "student_name" || varName === "name" || varName === "1") {
        return recipient.name;
      }
      if (varName === "first_name") {
        return recipient.name.split(" ")[0] || recipient.name;
      }
      if (varName === "student_email" || varName === "email" || varName === "2") {
        return recipient.email || "";
      }
      if (varName === "student_phone" || varName === "phone" || varName === "3") {
        return recipient.phone || "";
      }
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
        payload: { error: err instanceof Error ? err.stack : err, providerStatus },
      });
    }
  }

  // Recount current stats to update campaign state
  const [counts] = await db
    .select({
      sent: sql<number>`count(case when status = 'sent' then 1 end)::int`,
      prepared: sql<number>`count(case when status = 'prepared' then 1 end)::int`,
    })
    .from(marketingCampaignRecipientsTable)
    .where(eq(marketingCampaignRecipientsTable.campaignId, campaign.id));

  const campaignFinished = (counts.prepared ?? 0) === 0;
  const newCampaignStatus = campaignFinished ? "sent" : "sending";
  const campaignSentAt = campaignFinished ? new Date().toISOString() : null;

  await db.update(marketingCampaignsTable).set({
    status: newCampaignStatus,
    sentCount: counts.sent ?? 0,
    sentAt: campaignSentAt,
  }).where(eq(marketingCampaignsTable.id, campaign.id));

  res.json(SendCampaignResponse.parse({
    success: true,
    sentCount: batchSentCount,
    sentAt: campaignSentAt,
  }));
});

router.post("/marketing/campaigns/:id/retry-failed", requireAdminAuth, requireAdminPermission("marketing", "send"), async (req, res): Promise<void> => {
  const params = GetCampaignParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [campaign] = await db.select().from(marketingCampaignsTable).where(eq(marketingCampaignsTable.id, params.data.id));
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  await db.transaction(async (tx) => {
    // Reset failed recipients back to prepared
    await tx.update(marketingCampaignRecipientsTable)
      .set({ status: "prepared", errorMessage: null, updatedAt: new Date().toISOString() })
      .where(and(
        eq(marketingCampaignRecipientsTable.campaignId, campaign.id),
        eq(marketingCampaignRecipientsTable.status, "failed")
      ));

    // Recount statistics
    const [counts] = await tx
      .select({
        sent: sql<number>`count(case when status = 'sent' then 1 end)::int`,
        prepared: sql<number>`count(case when status = 'prepared' then 1 end)::int`,
      })
      .from(marketingCampaignRecipientsTable)
      .where(eq(marketingCampaignRecipientsTable.campaignId, campaign.id));

    // Determine new status
    const hasSent = (counts.sent ?? 0) > 0;
    const newStatus = hasSent ? "sending" : "prepared";

    await tx.update(marketingCampaignsTable).set({
      status: newStatus,
      sentAt: null,
    }).where(eq(marketingCampaignsTable.id, campaign.id));
  });

  res.json({ success: true });
});

export default router;
