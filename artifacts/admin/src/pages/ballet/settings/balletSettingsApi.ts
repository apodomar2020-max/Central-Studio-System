/**
 * Ballet General Settings — shared fetch helper, types, and input
 * normalizers used across the focused settings sub-pages (Home Card,
 * Contact Information, Program Requirements, FAQ). Extracted from the
 * former single-page BalletSettingsPage.tsx so each focused page can import
 * only what it needs without duplicating this logic.
 *
 * All routes here already exist in adminBallet.ts and are unchanged by the
 * admin UX restructure — this file only re-exports the same request shapes
 * the monolithic page used, split by concern.
 */
import { normalizeMediaUrl } from "@workspace/api-client-react";

const API = import.meta.env.VITE_API_URL ?? "";
const API_KEY = (import.meta.env.VITE_API_KEY as string | undefined) ?? "";

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
    throw { data };
  }
  return res.json() as Promise<T>;
}

export function balletApiUrl(path: string): string {
  return `${API}/api/admin/ballet${path}`;
}

export interface BalletSettings {
  id: number;
  homeCardImageUrl: string | null;
  whatsappNumber: string | null;
  phoneNumber: string | null;
  email: string | null;
  studioLocationUrl: string | null;
  updatedAt: string;
}

export interface RequirementItem {
  id: number;
  sectionId: number;
  text: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RequirementSection {
  id: number;
  title: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  items: RequirementItem[];
}

export interface BalletFaqCategory {
  id: number;
  name: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BalletFaq {
  id: number;
  question: string;
  answer: string;
  sortOrder: number;
  isActive: boolean;
  // The FAQ's true category assignment, regardless of the category's own
  // active state (admin sees this even when the category is deactivated —
  // only the public Ballet FAQ response nulls it out in that case).
  category: BalletFaqCategory | null;
  createdAt: string;
  updatedAt: string;
}

export const BALLET_SETTINGS_QUERY_KEY = "admin-ballet-settings";
export const BALLET_REQUIREMENTS_QUERY_KEY = "admin-ballet-program-requirements";
export const BALLET_FAQS_QUERY_KEY = "admin-ballet-faqs";
export const BALLET_FAQ_CATEGORIES_QUERY_KEY = "admin-ballet-faq-categories";

export function normalizeHomeCardImageUrlInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const normalized = normalizeMediaUrl(trimmed, "image");
  if (!normalized) {
    throw new Error("Enter a direct image URL or a supported public Google Drive sharing URL.");
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("Enter a valid image URL.");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Image URL must use HTTPS.");
  }

  return parsed.toString();
}

export function normalizePhoneInput(value: string, label: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/[\s().-]+/g, "").replace(/^00/, "+");
  if (!/^\+?[0-9]{7,15}$/.test(normalized)) {
    throw new Error(`${label} must contain 7 to 15 digits and may start with +.`);
  }
  return normalized;
}

export function normalizeEmailInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    throw new Error("Enter a valid email address.");
  }
  return trimmed.toLowerCase();
}

export function normalizeHttpsUrlInput(value: string, label: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`${label} must use HTTPS.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${label} must not include credentials.`);
  }
  return parsed.toString();
}

export function parseSortOrder(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}
