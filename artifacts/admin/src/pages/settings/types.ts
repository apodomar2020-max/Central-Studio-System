import { z } from "zod";

// ─── API helpers ──────────────────────────────────────────────────────────────

export const API = import.meta.env.VITE_API_URL ?? "";
export const API_KEY = (import.meta.env.VITE_API_KEY as string | undefined) ?? "";

export function makeHeaders(token: string | null): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(API_KEY ? { "x-api-key": API_KEY } : {}),
    ...(token ? { "x-admin-token": token } : {}),
  };
}

export async function adminFetch<T>(url: string, init: RequestInit, token: string | null): Promise<T> {
  const res = await fetch(url, { ...init, headers: makeHeaders(token) });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw data;
  }
  return res.json() as Promise<T>;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DanceType {
  id: number;
  name: string;
  slug: string;
  description?: string | null;
  iconUrl?: string | null;
  iconSvg?: string | null;
  iconMime?: string | null;
  coverImageUrl?: string | null;
  color?: string | null;
  hasIconSvg?: boolean;
  iconSvgUrl?: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ClassPricingSettings {
  id: number;
  singleClassPriceEgp: number;
  adultsWalkinPriceEgp: number | null;
  teensWalkinPriceEgp: number | null;
  kidsWalkinPriceEgp: number | null;
  createdAt: string;
  updatedAt: string;
  // Admin-only visibility (not present on the public GET response): how many
  // ACTIVE classes are currently assigned to each category, regardless of
  // whether that category's price is configured. Used to warn when a
  // category has classes depending on it but no price set.
  activeClassCountsByCategory?: { adults: number; teens: number; kids: number };
}

export interface BackgroundMusicSettings {
  enabled: boolean;
  sourceUrl: string | null;
  sourceTitle: string | null;
  volume: number;
  loop: boolean;
  version: number;
  updatedAt: string;
}

export interface OverCapacityOccurrence {
  scheduleId: number;
  classId: number;
  classTitle: string;
  occurrenceDate: string | null;
  bookedCount: number;
  capacity: number;
}

export interface ClassCapacitySettings {
  id: number;
  classCapacityEnabled: boolean;
  enforcementEnabled: boolean;
  displayEnabled: boolean;
  overCapacityOccurrences: OverCapacityOccurrence[];
  updatedAt: string;
}

export interface ClassReminderSettings {
  id: number;
  automaticRemindersEnabled: boolean;
  classReminder24hEnabled: boolean;
  classReminder1hEnabled: boolean;
  postClassRating3hEnabled: boolean;
  updatedAt: string;
}

export type WorkerHealthStatus = "online" | "stale" | "unknown";

export interface ClassReminderStatus {
  settings: ClassReminderSettings;
  worker: {
    status: WorkerHealthStatus;
    queueWorkerEnabled: boolean | null;
    pushNotificationsEnabled: boolean | null;
    lastHeartbeatAt: string | null;
    lastReminderRunAt: string | null;
    lastReminderRunStatus: string | null;
    lastReminderRunSummary: Record<string, unknown> | null;
    deployedVersion: string | null;
  };
  api: {
    pushNotificationsEnabled: boolean;
  };
  pushConfigMismatch: boolean;
}

export interface BackgroundMusicTestResult {
  sourceUrl: string;
  sourceTitle: string | null;
  sourceType: "google_drive" | "direct";
  contentType: string | null;
  contentLength: number | null;
}

// ─── Form schemas ─────────────────────────────────────────────────────────────

export const danceTypeSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().max(2000).optional().or(z.literal("")),
  color: z
    .string()
    .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Use a hex color, e.g. #00B6D7")
    .optional()
    .or(z.literal("")),
  iconUrl: z.string().max(2000).optional().or(z.literal("")),
  coverImageUrl: z.string().max(2000).optional().or(z.literal("")),
  sortOrder: z.coerce.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});
export type DanceTypeForm = z.input<typeof danceTypeSchema>;

// Blank field = "leave this category unconfigured" (falls back to the legacy
// single price below) — distinct from 0, which is a deliberately free class.
const nullableCategoryPrice = z.preprocess(
  (value) => (value === "" || value == null ? null : Number(value)),
  z.number().int().min(0, "Price must be 0 or greater").nullable(),
);

export const classPricingSchema = z.object({
  singleClassPriceEgp: z.coerce.number().int().min(0, "Price must be 0 or greater"),
  adultsWalkinPriceEgp: nullableCategoryPrice,
  teensWalkinPriceEgp: nullableCategoryPrice,
  kidsWalkinPriceEgp: nullableCategoryPrice,
});
// z.output (not z.input): the nullable category price fields are
// preprocessed, so their input type is `unknown` — the form works with the
// already-resolved `number | null` shape, matching the `values`/`onSubmit`
// payloads used in ClassPricingTab.tsx.
export type ClassPricingForm = z.infer<typeof classPricingSchema>;

export const backgroundMusicSchema = z.object({
  enabled: z.boolean().default(false),
  sourceUrl: z.string().max(4000).optional().or(z.literal("")),
  sourceTitle: z.string().max(200).optional().or(z.literal("")),
  volume: z.coerce.number().min(0, "Volume must be between 0 and 1").max(1, "Volume must be between 0 and 1"),
  loop: z.boolean().default(true),
});
export type BackgroundMusicForm = z.input<typeof backgroundMusicSchema>;
