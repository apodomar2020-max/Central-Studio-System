import { db, marketingTemplatesTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";

const DEFAULT_GRAPH_VERSION = "v20.0";

export interface MetaTemplateComponent {
  type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS";
  format?: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";
  text?: string;
  buttons?: any[];
}

export interface MetaTemplateResponse extends Record<string, unknown> {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  components: MetaTemplateComponent[];
  rejected_reason?: string;
}

export function getMetaTemplatesConfig() {
  return {
    enabled: process.env["WHATSAPP_ENABLED"] === "true",
    token: process.env["WHATSAPP_CLOUD_ACCESS_TOKEN"]?.trim(),
    businessAccountId: process.env["WHATSAPP_BUSINESS_ACCOUNT_ID"]?.trim(),
    version: process.env["WHATSAPP_GRAPH_API_VERSION"]?.trim() || DEFAULT_GRAPH_VERSION,
  };
}

export class WhatsAppTemplatesError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = "WhatsAppTemplatesError";
    this.statusCode = statusCode;
  }
}

function requireConfig() {
  const config = getMetaTemplatesConfig();
  if (!config.enabled) {
    throw new WhatsAppTemplatesError("WhatsApp templates integration is disabled.", 503);
  }
  if (!config.token || !config.businessAccountId) {
    throw new WhatsAppTemplatesError("WhatsApp Business Account details are not configured.", 503);
  }
  return config;
}

/**
 * Normalizes Meta status names into local internal status codes
 */
export function normalizeStatus(metaStatus: string): string {
  const statusMap: Record<string, string> = {
    APPROVED: "approved",
    PENDING: "pending",
    REJECTED: "rejected",
    PAUSED: "paused",
    DISABLED: "disabled",
  };
  return statusMap[metaStatus.toUpperCase()] || metaStatus.toLowerCase();
}

/**
 * Extracts variable placeholders (e.g. ["1", "2"]) from text body
 */
function extractVariables(bodyText: string): string[] {
  const regex = /\{\{(\d+)\}\}/g;
  const matches = new Set<string>();
  let match;
  while ((match = regex.exec(bodyText)) !== null) {
    matches.add(match[1]);
  }
  return Array.from(matches).sort((a, b) => Number(a) - Number(b));
}

/**
 * Fetches templates from Meta WhatsApp Business Account
 */
export async function fetchMetaTemplates(): Promise<MetaTemplateResponse[]> {
  const config = requireConfig();
  const url = `https://graph.facebook.com/${encodeURIComponent(config.version)}/${encodeURIComponent(config.businessAccountId!)}/message_templates?limit=1000`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
  });

  const payload = (await response.json().catch(() => ({}))) as { data?: MetaTemplateResponse[] };
  if (!response.ok) {
    const errorMsg = typeof payload === "object" && payload && "error" in payload
      ? (payload as { error?: { message?: string } }).error?.message
      : "Failed to fetch templates from Meta.";
    throw new WhatsAppTemplatesError(errorMsg ?? "Failed to fetch templates from Meta.", 502);
  }

  return (payload.data || []) as MetaTemplateResponse[];
}

/**
 * Creates template on Meta WhatsApp Business Account
 */
export async function createMetaTemplate(input: {
  name: string;
  language: string;
  category: string;
  headerText?: string;
  bodyText: string;
  footerText?: string;
  buttons?: any[];
}): Promise<MetaTemplateResponse> {
  const config = requireConfig();
  const url = `https://graph.facebook.com/${encodeURIComponent(config.version)}/${encodeURIComponent(config.businessAccountId!)}/message_templates`;

  const components: any[] = [];

  if (input.headerText) {
    components.push({
      type: "HEADER",
      format: "TEXT",
      text: input.headerText,
    });
  }

  components.push({
    type: "BODY",
    text: input.bodyText,
  });

  if (input.footerText) {
    components.push({
      type: "FOOTER",
      text: input.footerText,
    });
  }

  if (input.buttons && input.buttons.length > 0) {
    components.push({
      type: "BUTTONS",
      buttons: input.buttons,
    });
  }

  const payload = {
    name: input.name.trim().toLowerCase(),
    language: input.language.trim(),
    category: input.category.trim().toUpperCase(),
    components,
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const resPayload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorMsg = typeof resPayload === "object" && resPayload && "error" in resPayload
      ? (resPayload as any).error?.message
      : "Failed to create template on Meta.";
    throw new WhatsAppTemplatesError(errorMsg, 502);
  }

  return resPayload as MetaTemplateResponse;
}

/**
 * Refreshes a single template status from Meta
 */
export async function refreshTemplateStatus(templateId: number): Promise<void> {
  const config = requireConfig();
  const [template] = await db
    .select()
    .from(marketingTemplatesTable)
    .where(eq(marketingTemplatesTable.id, templateId));

  if (!template) {
    throw new WhatsAppTemplatesError("Template not found locally.", 404);
  }

  // If it does not have a metaTemplateId, it cannot be synced
  if (!template.metaTemplateId) {
    throw new WhatsAppTemplatesError("Cannot refresh a legacy local template without a Meta ID.", 400);
  }

  const url = `https://graph.facebook.com/${encodeURIComponent(config.version)}/${encodeURIComponent(template.metaTemplateId)}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.token}`,
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorMsg = typeof payload === "object" && payload && "error" in payload
      ? (payload as any).error?.message
      : "Failed to refresh template status from Meta.";
    throw new WhatsAppTemplatesError(errorMsg, response.status);
  }

  const metaTemplate = payload as MetaTemplateResponse;
  const status = normalizeStatus(metaTemplate.status);

  await db
    .update(marketingTemplatesTable)
    .set({
      status,
      rejectedReason: metaTemplate.rejected_reason || null,
      lastSyncedAt: new Date().toISOString(),
      rawMetaPayload: metaTemplate,
    })
    .where(eq(marketingTemplatesTable.id, templateId));
}

/**
 * Pulls all templates from Meta and synchronizes local database cache
 */
export async function syncMetaTemplatesToLocal(): Promise<{ added: number; updated: number; archived: number }> {
  const metaTemplates = await fetchMetaTemplates();
  const nowStr = new Date().toISOString();

  let added = 0;
  let updated = 0;

  // Track Meta template IDs fetched in this run
  const activeMetaIds = new Set<string>();

  for (const metaT of metaTemplates) {
    activeMetaIds.add(metaT.id);

    const bodyComp = metaT.components.find((c) => c.type === "BODY");
    const headerComp = metaT.components.find((c) => c.type === "HEADER");
    const footerComp = metaT.components.find((c) => c.type === "FOOTER");
    const buttonsComp = metaT.components.find((c) => c.type === "BUTTONS");

    const body = bodyComp?.text || "";
    const headerType = headerComp ? (headerComp.format || "TEXT") : "NONE";
    const headerText = headerComp?.text || null;
    const footer = footerComp?.text || null;
    const buttons = buttonsComp?.buttons || null;
    const variables = extractVariables(body);
    const status = normalizeStatus(metaT.status);
    const category = metaT.category.toLowerCase();

    // Check if exists locally
    const [existing] = await db
      .select()
      .from(marketingTemplatesTable)
      .where(
        sql`meta_template_id = ${metaT.id} OR (name = ${metaT.name} AND language = ${metaT.language})`
      );

    if (existing) {
      await db
        .update(marketingTemplatesTable)
        .set({
          metaTemplateId: metaT.id,
          category,
          status,
          body,
          headerType,
          headerText,
          footer,
          buttons,
          variables,
          rejectedReason: metaT.rejected_reason || null,
          lastSyncedAt: nowStr,
          rawMetaPayload: metaT,
          archivedAt: null, // Reactivate if it was archived
        })
        .where(eq(marketingTemplatesTable.id, existing.id));
      updated++;
    } else {
      await db.insert(marketingTemplatesTable).values({
        metaTemplateId: metaT.id,
        name: metaT.name,
        category,
        language: metaT.language,
        status,
        body,
        headerType,
        headerText,
        footer,
        buttons,
        variables,
        rejectedReason: metaT.rejected_reason || null,
        lastSyncedAt: nowStr,
        rawMetaPayload: metaT,
      });
      added++;
    }
  }

  // Deactivate/archive templates that are not present in activeMetaIds
  // Ignore legacy local templates (which have no metaTemplateId)
  const allTemplates = await db.select().from(marketingTemplatesTable);
  let archived = 0;

  for (const t of allTemplates) {
    if (t.metaTemplateId && !activeMetaIds.has(t.metaTemplateId) && t.status !== "archived") {
      await db
        .update(marketingTemplatesTable)
        .set({
          status: "archived",
          archivedAt: nowStr,
        })
        .where(eq(marketingTemplatesTable.id, t.id));
      archived++;
    }
  }

  // Flag any legacy local templates that don't have metaTemplateId as legacy_local_template
  await db
    .update(marketingTemplatesTable)
    .set({ status: "legacy_local_template" })
    .where(sql`meta_template_id IS NULL AND status != 'legacy_local_template' AND status != 'archived'`);

  return { added, updated, archived };
}
