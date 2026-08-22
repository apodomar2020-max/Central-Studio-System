/**
 * Finance Admin data layer (Phase 1 — read-only).
 *
 * The Finance endpoints are admin-only and, following the same convention as
 * /api/admin/logs and /api/promotions, are deliberately not part of the
 * generated API client — so these use the standard raw fetch with the
 * x-admin-token header.
 *
 * Every type here mirrors @workspace/api-zod's Finance contract, which is the
 * single source of truth for the vocabulary, the labels, and the mandatory
 * caveat wording. Nothing in this folder re-spells a label or re-derives an
 * amount.
 */
import type {
  FinanceOverviewResponse,
  FinanceSourceFamily,
  FinanceTransactionsResponse,
  UnifiedFinanceTransaction,
} from "@workspace/api-zod";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

export function financeHeaders(token: string | null): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(token ? { "x-admin-token": token } : {}),
  };
}

/** Thrown for a non-2xx Finance response, carrying the status for 403 handling. */
export class FinanceRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "FinanceRequestError";
  }
}

async function financeFetch<T>(path: string, token: string | null): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { headers: financeHeaders(token) });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new FinanceRequestError(response.status, body.error ?? "Failed to load finance data");
  }
  return response.json() as Promise<T>;
}

// ─── Filters ──────────────────────────────────────────────────────────────────

/**
 * UI filter state. Multi-select dimensions are arrays and serialize to the
 * comma-separated form the API validates against its allowlists.
 */
export interface FinanceFilterState {
  from: string;
  to: string;
  search: string;
  eventTypes: string[];
  eventNatures: string[];
  families: FinanceSourceFamily[];
  paymentMethods: string[];
  paymentStatuses: string[];
  refundStatuses: string[];
  reliability: string[];
  amountAvailability: string[];
}

export const EMPTY_FINANCE_FILTERS: FinanceFilterState = {
  from: "",
  to: "",
  search: "",
  eventTypes: [],
  eventNatures: [],
  families: [],
  paymentMethods: [],
  paymentStatuses: [],
  refundStatuses: [],
  reliability: [],
  amountAvailability: [],
};

/** True when anything is narrowing the result set (drives the Clear button). */
export function hasActiveFinanceFilters(filters: FinanceFilterState): boolean {
  return (
    Boolean(filters.from || filters.to || filters.search) ||
    filters.eventTypes.length > 0 ||
    filters.eventNatures.length > 0 ||
    filters.paymentMethods.length > 0 ||
    filters.paymentStatuses.length > 0 ||
    filters.refundStatuses.length > 0 ||
    filters.reliability.length > 0 ||
    filters.amountAvailability.length > 0
  );
}

/**
 * Serialize filter state to query params.
 *
 * `lockedFamilies` is how the source-filtered pages (Package Payments, Ballet
 * Finance, …) are built: they pass a fixed family set instead of duplicating any
 * query or table logic. A page-level lock always wins over user-selected
 * families so a scoped page cannot be widened out of its own scope.
 */
export function financeQueryParams(
  filters: FinanceFilterState,
  extra: { page?: number; limit?: number; format?: string; lockedFamilies?: FinanceSourceFamily[] } = {},
): URLSearchParams {
  const params = new URLSearchParams();
  if (extra.page != null) params.set("page", String(extra.page));
  if (extra.limit != null) params.set("limit", String(extra.limit));
  if (extra.format) params.set("format", extra.format);

  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.search) params.set("search", filters.search);

  const families = extra.lockedFamilies ?? filters.families;
  if (families.length > 0) params.set("family", families.join(","));
  if (filters.eventTypes.length > 0) params.set("eventType", filters.eventTypes.join(","));
  if (filters.eventNatures.length > 0) params.set("eventNature", filters.eventNatures.join(","));
  if (filters.paymentMethods.length > 0) params.set("paymentMethod", filters.paymentMethods.join(","));
  if (filters.paymentStatuses.length > 0) params.set("paymentStatus", filters.paymentStatuses.join(","));
  if (filters.refundStatuses.length > 0) params.set("refundStatus", filters.refundStatuses.join(","));
  if (filters.reliability.length > 0) params.set("reliability", filters.reliability.join(","));
  if (filters.amountAvailability.length > 0) {
    params.set("amountAvailability", filters.amountAvailability.join(","));
  }
  return params;
}

// ─── Requests ─────────────────────────────────────────────────────────────────

export function fetchFinanceOverview(token: string | null): Promise<FinanceOverviewResponse> {
  return financeFetch<FinanceOverviewResponse>("/api/finance/overview", token);
}

export function fetchFinanceTransactions(
  token: string | null,
  filters: FinanceFilterState,
  page: number,
  limit: number,
  lockedFamilies?: FinanceSourceFamily[],
): Promise<FinanceTransactionsResponse> {
  const params = financeQueryParams(filters, { page, limit, lockedFamilies });
  return financeFetch<FinanceTransactionsResponse>(`/api/finance/transactions?${params}`, token);
}

/**
 * Download an export with the current filters. Uses the same endpoint and the
 * same permission filtering as the table, so a file can never contain a row the
 * admin could not already see on screen.
 */
export async function downloadFinanceExport(
  token: string | null,
  filters: FinanceFilterState,
  format: "xlsx" | "pdf",
  lockedFamilies?: FinanceSourceFamily[],
): Promise<void> {
  const params = financeQueryParams(filters, { format, lockedFamilies });
  const response = await fetch(`${API_BASE}/api/finance/export?${params}`, {
    headers: financeHeaders(token),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new FinanceRequestError(response.status, body.error ?? "Export failed");
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `unified-finance-activity-${new Date().toISOString().slice(0, 10)}.${format}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

// ─── Formatting ───────────────────────────────────────────────────────────────

/**
 * en-EG EGP formatting. Whole pounds only — every stored amount is an integer
 * number of EGP, and showing decimals would imply precision that is not there.
 */
const EGP_FORMATTER = new Intl.NumberFormat("en-EG", {
  style: "currency",
  currency: "EGP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * Format an amount for display. A null amount renders as "Unknown" — NEVER as
 * EGP 0, which would assert the studio received nothing.
 */
export function formatEgp(value: number | null | undefined): string {
  if (value == null) return "Unknown";
  return EGP_FORMATTER.format(value);
}

/** Signed session-credit units, e.g. "−1 credit" / "+8 credits". */
export function formatCreditUnits(delta: number | null | undefined): string {
  if (delta == null) return "—";
  const magnitude = Math.abs(delta);
  const unit = magnitude === 1 ? "credit" : "credits";
  // U+2212 minus sign reads better than a hyphen next to a number.
  return `${delta < 0 ? "−" : "+"}${magnitude} ${unit}`;
}

export function formatFinanceDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", {
    timeZone: "Africa/Cairo",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatFinanceDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", {
    timeZone: "Africa/Cairo",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** "underReview" → "Under Review" (matches the Ballet pages' titleCase). */
export function humanizeFinanceToken(value: string | null | undefined): string {
  if (!value) return "—";
  return value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export type { UnifiedFinanceTransaction, FinanceOverviewResponse, FinanceTransactionsResponse };
