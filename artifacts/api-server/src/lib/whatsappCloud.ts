export type WhatsAppTemplateParameter =
  | string
  | number
  | {
      type: "text";
      text: string;
    };

export interface SendTemplateMessageInput {
  to: string;
  templateName: string;
  languageCode: string;
  parameters?: WhatsAppTemplateParameter[];
}

export interface SendTemplateMessageResult {
  providerMessageId: string | null;
  raw: {
    messagingProduct?: string;
    messaging_product?: string;
    contacts?: Array<{ input?: string; wa_id?: string }>;
    messages?: Array<{ id?: string; message_status?: string }>;
  };
}

export interface WhatsAppCloudStatus {
  enabled: boolean;
  configured: boolean;
  graphApiVersion: string;
  phoneNumberIdMasked: string | null;
  businessAccountIdMasked: string | null;
  testRecipientRestricted: boolean;
}

export class WhatsAppCloudError extends Error {
  readonly statusCode: number;
  readonly providerStatus?: number;
  readonly providerCode?: string | number;

  constructor(message: string, options: { statusCode?: number; providerStatus?: number; providerCode?: string | number } = {}) {
    super(message);
    this.name = "WhatsAppCloudError";
    this.statusCode = options.statusCode ?? 500;
    this.providerStatus = options.providerStatus;
    this.providerCode = options.providerCode;
  }
}

const DEFAULT_GRAPH_VERSION = "v20.0";

/**
 * Required Railway/server env vars for WhatsApp Cloud API test sending:
 *
 * WHATSAPP_ENABLED=true
 * WHATSAPP_CLOUD_ACCESS_TOKEN=<regenerated Meta access token>
 * WHATSAPP_PHONE_NUMBER_ID=<Meta phone number id>
 * WHATSAPP_BUSINESS_ACCOUNT_ID=<Meta business account id; reserved for later template sync>
 * WHATSAPP_GRAPH_API_VERSION=v20.0
 * WHATSAPP_TEST_RECIPIENT=+20110614656
 *
 * The access token is read server-side only. Never expose it to admin/mobile clients.
 */
function getConfig() {
  return {
    enabled: process.env["WHATSAPP_ENABLED"] === "true",
    token: process.env["WHATSAPP_CLOUD_ACCESS_TOKEN"]?.trim(),
    phoneNumberId: process.env["WHATSAPP_PHONE_NUMBER_ID"]?.trim(),
    businessAccountId: process.env["WHATSAPP_BUSINESS_ACCOUNT_ID"]?.trim(),
    version: process.env["WHATSAPP_GRAPH_API_VERSION"]?.trim() || DEFAULT_GRAPH_VERSION,
    testRecipient: process.env["WHATSAPP_TEST_RECIPIENT"]?.trim(),
  };
}

function maskValue(value: string | undefined): string | null {
  if (!value) return null;
  if (value.length <= 6) return `${value.slice(0, 2)}...`;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function isWhatsAppCloudEnabled(): boolean {
  return getConfig().enabled;
}

export function getWhatsAppCloudStatus(): WhatsAppCloudStatus {
  const config = getConfig();
  return {
    enabled: config.enabled,
    configured: Boolean(config.token && config.phoneNumberId),
    graphApiVersion: config.version,
    phoneNumberIdMasked: maskValue(config.phoneNumberId),
    businessAccountIdMasked: maskValue(config.businessAccountId),
    testRecipientRestricted: Boolean(config.testRecipient),
  };
}

export function assertValidE164Phone(value: string): string {
  const normalized = value.trim();
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    throw new WhatsAppCloudError("Invalid recipient phone number. Use E.164 format, for example +20110614656.", { statusCode: 400 });
  }
  return normalized;
}

function assertAllowedTestRecipient(to: string): void {
  const { testRecipient } = getConfig();
  if (!testRecipient) return;
  const normalizedTestRecipient = assertValidE164Phone(testRecipient);
  if (to !== normalizedTestRecipient) {
    throw new WhatsAppCloudError("WhatsApp test sending is restricted to the configured test recipient.", { statusCode: 403 });
  }
}

function requireConfigured() {
  const config = getConfig();
  if (!config.enabled) {
    throw new WhatsAppCloudError("WhatsApp Cloud API is disabled.", { statusCode: 503 });
  }
  if (!config.token || !config.phoneNumberId) {
    throw new WhatsAppCloudError("WhatsApp Cloud API is not configured.", { statusCode: 503 });
  }
  return config;
}

function templateParameters(parameters: WhatsAppTemplateParameter[]) {
  if (parameters.length === 0) return undefined;
  return [{
    type: "body",
    parameters: parameters.map((parameter) => {
      if (typeof parameter === "string" || typeof parameter === "number") {
        return { type: "text", text: String(parameter) };
      }
      return parameter;
    }),
  }];
}

function cleanProviderError(payload: unknown): { message: string; code?: string | number } {
  const error = typeof payload === "object" && payload && "error" in payload
    ? (payload as { error?: { message?: string; code?: string | number; type?: string } }).error
    : undefined;
  return {
    message: error?.message || "WhatsApp Cloud API request failed.",
    code: error?.code,
  };
}

export async function sendTemplateMessage(input: SendTemplateMessageInput): Promise<SendTemplateMessageResult> {
  const config = requireConfigured();
  const to = assertValidE164Phone(input.to);
  assertAllowedTestRecipient(to);

  const templateName = input.templateName.trim();
  const languageCode = input.languageCode.trim();
  if (!templateName) {
    throw new WhatsAppCloudError("Template name is required.", { statusCode: 400 });
  }
  if (!languageCode) {
    throw new WhatsAppCloudError("Language code is required.", { statusCode: 400 });
  }

  const url = `https://graph.facebook.com/${encodeURIComponent(config.version)}/${encodeURIComponent(config.phoneNumberId!)}/messages`;
  const body = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      components: templateParameters(input.parameters ?? []),
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const providerError = cleanProviderError(payload);
    throw new WhatsAppCloudError(providerError.message, {
      statusCode: 502,
      providerStatus: response.status,
      providerCode: providerError.code,
    });
  }

  const raw = payload as SendTemplateMessageResult["raw"];
  return {
    providerMessageId: raw.messages?.[0]?.id ?? null,
    raw: {
      messagingProduct: raw.messagingProduct ?? raw.messaging_product,
      contacts: raw.contacts,
      messages: raw.messages,
    },
  };
}
