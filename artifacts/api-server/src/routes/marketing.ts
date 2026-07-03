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
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import {
  assertValidE164Phone,
  getWhatsAppCloudStatus,
  isWhatsAppCloudEnabled,
  sendTemplateMessage,
  WhatsAppCloudError,
  type WhatsAppTemplateParameter,
} from "../lib/whatsappCloud";
import {
  syncMetaTemplatesToLocal,
  createMetaTemplate,
  refreshTemplateStatus,
  normalizeStatus,
  getMetaTemplatesConfig
} from "../lib/whatsappTemplates";
import { enqueueJob, QUEUE_NAMES, queuesAvailable, type WhatsAppCampaignSendJob } from "../lib/queue";
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

const CreateTemplateBody = z.object({
  name: z.string().min(1),
  category: z.enum(["utility", "marketing"]).default("marketing"),
  language: z.string().min(2).default("en"),
  body: z.string().min(1),
  headerText: z.string().nullish(),
  footerText: z.string().nullish(),
  buttons: z.array(z.any()).nullish(),
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
  const result = rows.map((row) => ({
    ...row,
    source: row.metaTemplateId ? "meta_cache" : "legacy_local",
  }));
  res.json(result);
});

router.post("/marketing/templates/sync", requireAdminAuth, requireAdminPermission("marketing", "edit"), async (req, res): Promise<void> => {
  try {
    const summary = await syncMetaTemplatesToLocal();
    res.json(summary);
  } catch (err) {
    console.error("Sync templates error:", err);
    res.status(err instanceof Error && "statusCode" in err ? (err as any).statusCode : 500).json({
      error: err instanceof Error ? err.message : "Failed to sync templates from Meta.",
    });
  }
});

router.post("/marketing/templates", requireAdminAuth, requireAdminPermission("marketing", "create"), async (req: AdminRequest, res): Promise<void> => {
  const parsed = CreateTemplateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Duplicate check
  const existing = await db
    .select()
    .from(marketingTemplatesTable)
    .where(and(
      eq(marketingTemplatesTable.name, parsed.data.name),
      eq(marketingTemplatesTable.language, parsed.data.language)
    ))
    .limit(1);

  if (existing.length > 0) {
    res.status(400).json({ error: "A template with the same name and language already exists." });
    return;
  }

  try {
    // 1. Submit template to Meta first
    const metaResponse = await createMetaTemplate({
      name: parsed.data.name,
      language: parsed.data.language,
      category: parsed.data.category,
      bodyText: parsed.data.body,
      headerText: parsed.data.headerText ?? undefined,
      footerText: parsed.data.footerText ?? undefined,
      buttons: parsed.data.buttons ?? undefined,
    });

    // 2. Normalize and insert locally
    const status = normalizeStatus(metaResponse.status);
    // Extract variables
    const regex = /\{\{(\d+)\}\}/g;
    const matches = new Set<string>();
    let match;
    while ((match = regex.exec(parsed.data.body)) !== null) {
      matches.add(match[1]);
    }
    const variables = Array.from(matches).sort((a, b) => Number(a) - Number(b));

    const [row] = await db.insert(marketingTemplatesTable).values({
      metaTemplateId: metaResponse.id,
      name: parsed.data.name.trim().toLowerCase(),
      category: parsed.data.category,
      language: parsed.data.language,
      body: parsed.data.body,
      status,
      headerType: parsed.data.headerText ? "TEXT" : "NONE",
      headerText: parsed.data.headerText ?? null,
      footer: parsed.data.footerText ?? null,
      buttons: parsed.data.buttons ?? null,
      variables,
      rawMetaPayload: metaResponse,
    }).returning();

    res.status(201).json(row);
  } catch (err) {
    console.error("Create template error:", err);
    res.status(err instanceof Error && "statusCode" in err ? (err as any).statusCode : 500).json({
      error: err instanceof Error ? err.message : "Failed to create template on Meta.",
    });
  }
});

router.get("/marketing/templates/:id/status", requireAdminAuth, requireAdminPermission("marketing", "view"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid template id" });
    return;
  }

  try {
    await refreshTemplateStatus(id);
    const [updated] = await db
      .select()
      .from(marketingTemplatesTable)
      .where(eq(marketingTemplatesTable.id, id));
    res.json(updated);
  } catch (err) {
    console.error("Refresh template status error:", err);
    res.status(err instanceof Error && "statusCode" in err ? (err as any).statusCode : 500).json({
      error: err instanceof Error ? err.message : "Failed to refresh template status.",
    });
  }
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

router.post("/marketing/campaigns", requireAdminAuth, requireAdminPermission("marketing", "create"), async (req: AdminRequest, res): Promise<void> => {
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

router.patch("/marketing/campaigns/:id", requireAdminAuth, requireAdminPermission("marketing", "edit"), async (req: AdminRequest, res): Promise<void> => {
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
  // Type the patch as a drizzle update shape for this table so recipientCount
  // (not part of the request body) can be set below. targetAudience is a
  // NOT NULL column, so it is only copied in when the client actually sent a
  // string — an explicit null is treated like "not provided" (previously it
  // would have failed the NOT NULL constraint at the DB level anyway).
  const { targetAudience: bodyTargetAudience, ...restPatch } = parsed.data;
  const updateData: Partial<typeof marketingCampaignsTable.$inferInsert> = { ...restPatch };
  if (bodyTargetAudience != null) {
    updateData.targetAudience = bodyTargetAudience;
  }
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

router.delete("/marketing/campaigns/:id", requireAdminAuth, requireAdminPermission("marketing", "delete"), async (req: AdminRequest, res): Promise<void> => {
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

router.post("/marketing/campaigns/:id/preview-recipients", requireAdminAuth, requireAdminPermission("marketing", "view"), async (req: AdminRequest, res): Promise<void> => {
  const params = GetCampaignParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = PreviewBody.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
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

router.post("/marketing/campaigns/:id/prepare", requireAdminAuth, requireAdminPermission("marketing", "send"), async (req: AdminRequest, res): Promise<void> => {
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

router.post("/marketing/campaigns/:id/send", requireAdminAuth, requireAdminPermission("marketing", "send"), async (req: AdminRequest, res): Promise<void> => {
  if (!isWhatsAppCloudEnabled()) {
    res.status(503).json({ error: "WhatsApp Cloud API is disabled. Set WHATSAPP_ENABLED=true to allow sends." });
    return;
  }

  const params = GetCampaignParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  if (!queuesAvailable()) {
    res.status(503).json({ error: "Queue backend is not configured. Set REDIS_URL to send campaigns asynchronously." });
    return;
  }

  const [campaign] = await db
    .select()
    .from(marketingCampaignsTable)
    .where(eq(marketingCampaignsTable.id, params.data.id));

  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  if (campaign.status !== "prepared") {
    res.status(400).json({ error: "Campaign must be prepared before sending." });
    return;
  }

  if (!campaign.templateId) {
    res.status(400).json({ error: "Campaign must use an approved WhatsApp template before sending." });
    return;
  }

  const [template] = await db
    .select()
    .from(marketingTemplatesTable)
    .where(eq(marketingTemplatesTable.id, campaign.templateId));

  if (!template || template.status !== "approved" || !template.metaTemplateId) {
    res.status(400).json({ error: "Campaign template is not approved in WhatsApp Manager yet." });
    return;
  }

  const job = await enqueueJob<WhatsAppCampaignSendJob>(
    QUEUE_NAMES.whatsappCampaigns,
    "send-campaign-batch",
    {
      campaignId: params.data.id,
      actorEmail: req.adminUser?.email ?? null,
      ipAddress: req.ip ?? null,
    },
  );

  if (!job) {
    res.status(503).json({ error: "Queue backend is not available." });
    return;
  }

  await db.update(marketingCampaignsTable).set({
    status: "sending",
  }).where(eq(marketingCampaignsTable.id, params.data.id));

  res.json(SendCampaignResponse.parse({
    success: true,
    sentCount: 0,
    sentAt: null,
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

    // Determine new status: if campaign already attempted sending (was sent/sending or has sent messages), it should stay in 'sending' status.
    const alreadyAttempted = campaign.status === "sending" || campaign.status === "sent" || (counts.sent ?? 0) > 0;
    const newStatus = alreadyAttempted ? "sending" : "prepared";

    await tx.update(marketingCampaignsTable).set({
      status: newStatus,
      sentAt: null,
    }).where(eq(marketingCampaignsTable.id, campaign.id));
  });

  res.json({ success: true });
});

router.delete("/marketing/templates/:id", requireAdminAuth, requireAdminPermission("marketing", "delete"), async (req: AdminRequest, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid template id" });
    return;
  }

  // Check if template is used by prepared/sending/sent campaigns
  const used = await db
    .select()
    .from(marketingCampaignsTable)
    .where(and(
      eq(marketingCampaignsTable.templateId, id),
      inArray(marketingCampaignsTable.status, ["prepared", "sending", "sent"])
    ))
    .limit(1);

  if (used.length > 0) {
    res.status(400).json({ error: "Template is used by existing campaigns." });
    return;
  }

  const [row] = await db.delete(marketingTemplatesTable).where(eq(marketingTemplatesTable.id, id)).returning();
  if (!row) {
    res.status(404).json({ error: "Template not found" });
    return;
  }
  res.sendStatus(204);
});

router.get("/marketing/campaigns/:id/logs", requireAdminAuth, requireAdminPermission("marketing", "view"), async (req, res): Promise<void> => {
  const params = GetCampaignParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const rows = await db
    .select({
      id: marketingDeliveryLogsTable.id,
      campaignId: marketingDeliveryLogsTable.campaignId,
      recipientId: marketingDeliveryLogsTable.recipientId,
      provider: marketingDeliveryLogsTable.provider,
      providerMessageId: marketingDeliveryLogsTable.providerMessageId,
      eventType: marketingDeliveryLogsTable.eventType,
      status: marketingDeliveryLogsTable.status,
      errorCode: marketingDeliveryLogsTable.errorCode,
      errorMessage: marketingDeliveryLogsTable.errorMessage,
      createdAt: marketingDeliveryLogsTable.createdAt,
      recipientName: marketingCampaignRecipientsTable.name,
      recipientPhone: marketingCampaignRecipientsTable.phone,
    })
    .from(marketingDeliveryLogsTable)
    .leftJoin(
      marketingCampaignRecipientsTable,
      eq(marketingDeliveryLogsTable.recipientId, marketingCampaignRecipientsTable.id)
    )
    .where(eq(marketingDeliveryLogsTable.campaignId, params.data.id))
    .orderBy(desc(marketingDeliveryLogsTable.createdAt));

  res.json(rows);
});

export default router;
