/**
 * Finance Department API — Phase 1 (READ-ONLY).
 *
 *   GET /api/finance/overview      — classified financial summary
 *   GET /api/finance/transactions  — unified, paginated financial event feed
 *   GET /api/finance/export        — Unified Finance Activity Export (json|xlsx|pdf)
 *
 * There is intentionally NO POST/PATCH/PUT/DELETE here and none may be added
 * in Phase 1: every financial mutation stays in its existing operational page
 * (Package Orders, Bookings, Attendance, Ballet Payments, Ballet Refunds,
 * Promotions). Finance normalizes and deep-links; it never writes.
 *
 * Security
 * ────────
 * Admin-only, like /api/admin/logs — and, following that same established
 * convention, deliberately NOT part of the OpenAPI contract or the generated
 * clients (the Admin Finance pages use the raw x-admin-token fetch pattern).
 *
 * Phase 1 introduces NO new permission codes, so it needs no migration and no
 * production permission seed. It reuses the existing read permissions that
 * already gate each underlying operational page — see
 * FINANCE_FAMILY_PERMISSIONS in @workspace/api-zod. Authorization is applied
 * per event-source FAMILY and BEFORE counting/pagination, so an admin never
 * receives, and is never given a total for, a family they cannot view.
 */
import { Router, type IRouter, type NextFunction, type Response } from "express";
import { z } from "zod";
import { Workbook } from "exceljs";
import {
  FINANCE_AMOUNT_AVAILABILITIES,
  FINANCE_EVENT_NATURES,
  FINANCE_EVENT_TYPES,
  FINANCE_PAYMENT_METHODS,
  FINANCE_PAYMENT_STATUSES,
  FINANCE_REFUND_STATUSES,
  FINANCE_RELIABILITY_BADGES,
  FINANCE_SOURCE_FAMILIES,
  FINANCE_SOURCE_TABLES,
  type FinanceEventType,
} from "@workspace/api-zod";
import { blockStudentJwt } from "../middlewares/auth";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { logger } from "../lib/logger";
import { logActivity } from "../lib/activityLog";
import { buildFinanceOverview } from "../lib/financeOverview";
import {
  queryFinanceTransactions,
  queryFinanceTransactionsForExport,
  type FinanceTransactionFilters,
} from "../lib/financeSources";
import {
  financeAdminCan,
  financeRequiredPermissions,
  resolveRequestScope,
  resolveVisibleFamilies,
} from "../lib/financeAccess";
import {
  buildFinanceExportRows,
  buildFinanceExportSummary,
  FINANCE_EXPORT_COLUMNS,
  FINANCE_EXPORT_TITLE,
  FINANCE_EXPORT_WARNINGS,
} from "../lib/financeExport";
import { sanitizeCellText } from "../lib/exportSanitizer";
import { buildPdfBuffer } from "./pdfReport";

const router: IRouter = Router();

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
/**
 * Page is capped because the merge window is page × limit rows per family —
 * bounding the page bounds worst-case memory and query cost.
 */
const MAX_PAGE = 200;
/** Hard ceiling on export size, mirroring reports.ts's SUMMARY_MAX precedent. */
const EXPORT_MAX_ROWS = 5000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ─── Permission resolution ────────────────────────────────────────────────────
// All access logic lives in lib/financeAccess.ts so it is unit-testable without
// a database; this route is only the HTTP adapter over it.

/**
 * Deny with the repository-standard shape when an admin holds none of the
 * Finance-relevant read permissions. Listing the alternatives keeps the 403
 * actionable without leaking anything the admin could not already see.
 */
function requireAnyFinanceFamily(req: AdminRequest, res: Response, next: NextFunction): void {
  const admin = req.adminUser;
  if (!admin) {
    res.status(401).json({ error: "Admin authentication required" });
    return;
  }
  if (resolveVisibleFamilies(admin).length === 0) {
    res.status(403).json({
      error: "Permission denied",
      requiredPermissions: financeRequiredPermissions(),
    });
    return;
  }
  next();
}

/**
 * Finance Roles & Permissions integration — the master gate for the whole
 * Finance section. Every route in this file requires finance.view in
 * addition to whatever operational-family scoping (resolveVisibleFamilies)
 * already narrows the actual data returned. Super Admin bypasses via
 * requireAdminPermission itself.
 */
function requireFinanceView(req: AdminRequest, res: Response, next: NextFunction): void {
  requireAdminPermission("finance", "view")(req, res, next);
}

// ─── Query validation ─────────────────────────────────────────────────────────

/**
 * Comma-separated multi-select, validated against an allowlist. Unknown values
 * are rejected with 400 rather than ignored — silently dropping a filter would
 * show an admin more rows than they asked for.
 */
function csvEnum<T extends string>(values: readonly T[]) {
  const allowed = new Set<string>(values);
  return z
    .string()
    .optional()
    .transform((raw, ctx): T[] => {
      if (!raw) return [];
      const parts = raw.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
      const unknown = parts.filter((part) => !allowed.has(part));
      if (unknown.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unsupported value(s): ${unknown.join(", ")}. Allowed: ${values.join(", ")}`,
        });
        return [];
      }
      return Array.from(new Set(parts)) as T[];
    });
}

const TransactionsQuery = z.object({
  page: z.coerce.number().int().min(1).max(MAX_PAGE).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  from: z.string().regex(DATE_RE, "from must be YYYY-MM-DD").optional(),
  to: z.string().regex(DATE_RE, "to must be YYYY-MM-DD").optional(),
  eventType: csvEnum(FINANCE_EVENT_TYPES),
  eventNature: csvEnum(FINANCE_EVENT_NATURES),
  source: csvEnum(FINANCE_SOURCE_TABLES),
  family: csvEnum(FINANCE_SOURCE_FAMILIES),
  paymentMethod: csvEnum(FINANCE_PAYMENT_METHODS),
  paymentStatus: csvEnum(FINANCE_PAYMENT_STATUSES),
  refundStatus: csvEnum(FINANCE_REFUND_STATUSES),
  reliability: csvEnum(FINANCE_RELIABILITY_BADGES),
  amountAvailability: csvEnum(FINANCE_AMOUNT_AVAILABILITIES),
  search: z.string().trim().min(1).max(120).optional(),
});

const ExportQuery = TransactionsQuery.omit({ page: true, limit: true }).extend({
  format: z.enum(["json", "xlsx", "pdf"]).default("json"),
  limit: z.coerce.number().int().min(1).max(EXPORT_MAX_ROWS).default(EXPORT_MAX_ROWS),
});

type ParsedQuery = z.infer<typeof TransactionsQuery>;

function buildFilters(query: ParsedQuery, eventTypes: FinanceEventType[]): FinanceTransactionFilters {
  return {
    // Inclusive whole-day bounds in UTC — the same convention reports.ts uses.
    fromIso: query.from ? `${query.from}T00:00:00.000Z` : undefined,
    toIso: query.to ? `${query.to}T23:59:59.999Z` : undefined,
    eventTypes,
    families: [],
    paymentMethods: query.paymentMethod,
    paymentStatuses: query.paymentStatus,
    refundStatuses: query.refundStatus,
    reliabilityBadges: query.reliability,
    amountAvailabilities: query.amountAvailability,
    search: query.search,
  };
}

// ─── GET /api/finance/overview ────────────────────────────────────────────────

/**
 * Requires the same permission that already gates the Dashboard's financial
 * metrics (dashboard.view) — the overview exposes no figure the Dashboard does
 * not already show, only a clearer classification of it. Discounts are the one
 * addition and are gated separately.
 */
router.get(
  "/finance/overview",
  blockStudentJwt,
  requireAdminAuth,
  requireFinanceView,
  async (req: AdminRequest, res): Promise<void> => {
    const admin = req.adminUser!;
    res.json(
      await buildFinanceOverview({
        includeDiscounts: financeAdminCan(admin, "promotions", "view"),
      }),
    );
  },
);

// ─── GET /api/finance/transactions ────────────────────────────────────────────

router.get(
  "/finance/transactions",
  blockStudentJwt,
  requireAdminAuth,
  requireFinanceView,
  requireAnyFinanceFamily,
  async (req: AdminRequest, res): Promise<void> => {
    const parsed = TransactionsQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid query parameters" });
      return;
    }

    const admin = req.adminUser!;
    const visibleFamilies = resolveVisibleFamilies(admin);
    const scope = resolveRequestScope(parsed.data, visibleFamilies);
    const filters = buildFilters(parsed.data, scope.eventTypes);

    const { page, limit } = parsed.data;
    const { data, total } = await queryFinanceTransactions(scope.families, filters, page, limit);

    // Same pagination headers the other admin list endpoints expose (already
    // allowlisted in the CORS exposedHeaders config).
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    res.setHeader("X-Total-Count", String(total));
    res.setHeader("X-Page", String(page));
    res.setHeader("X-Page-Size", String(limit));
    res.setHeader("X-Total-Pages", String(totalPages));

    res.json({ data, total, page, limit, totalPages, visibleFamilies });
  },
);

// ─── GET /api/finance/export ──────────────────────────────────────────────────

/**
 * Finance Roles & Permissions integration: exporting Finance data requires
 * finance.exports IN ADDITION to finance.view (already enforced by
 * requireFinanceView earlier in this route's middleware chain) — a user
 * with only finance.view can read Finance pages but must not download
 * exports. Checked before any export data is queried or generated.
 */
function requireFinanceExportPermission(req: AdminRequest, res: Response, next: NextFunction): void {
  requireAdminPermission("finance", "exports")(req, res, next);
}

/**
 * Meta lines printed above the data in every export. Prefixed with a fixed
 * label so the interpolated value can never begin the cell (formula injection
 * only triggers on a cell's first character) — the same reasoning reports.ts
 * documents for its own meta block.
 */
function exportMetaLines(query: z.infer<typeof ExportQuery>, rowCount: number, truncated: boolean): string[] {
  const range = query.from || query.to ? `${query.from ?? "—"} to ${query.to ?? "—"}` : "All dates";
  const lines = [
    `Generated: ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC`,
    `Date range: ${range}`,
    `Rows: ${rowCount}`,
  ];
  if (truncated) {
    // Never let a capped export read as a complete one.
    lines.push(`NOTE: results were capped at ${query.limit} rows. Narrow the filters for a complete export.`);
  }
  return lines;
}

/**
 * Single-worksheet XLSX built from the same rows as the JSON preview. Uses the
 * exceljs dependency the repository already ships for reports — no new export
 * library is introduced.
 */
async function buildFinanceXlsxBuffer(
  rows: Record<string, string | number>[],
  summary: Record<string, string | number>,
  meta: string[],
): Promise<Buffer> {
  const workbook = new Workbook();
  workbook.creator = "Central Studio Admin";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(FINANCE_EXPORT_TITLE, { views: [] });

  const titleRow = sheet.addRow([FINANCE_EXPORT_TITLE]);
  titleRow.font = { bold: true, size: 14 };
  for (const line of meta) sheet.addRow([line]);

  sheet.addRow([]);
  const limitationsHeader = sheet.addRow(["Limitations"]);
  limitationsHeader.font = { bold: true };
  for (const warning of FINANCE_EXPORT_WARNINGS) {
    // Warnings are fixed constants, but they run through the sanitizer anyway
    // so the "every text cell is sanitized" rule has no exceptions to audit.
    sheet.addRow([sanitizeCellText(warning)]);
  }

  sheet.addRow([]);
  const summaryHeader = sheet.addRow(["Summary"]);
  summaryHeader.font = { bold: true };
  for (const [key, value] of Object.entries(summary)) {
    sheet.addRow([key, typeof value === "number" ? value : sanitizeCellText(String(value))]);
  }

  sheet.addRow([]);
  const headerRow = sheet.addRow(FINANCE_EXPORT_COLUMNS.map((column) => column.label));
  headerRow.font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: headerRow.number }];

  for (const row of rows) {
    sheet.addRow(
      FINANCE_EXPORT_COLUMNS.map((column) => {
        const value = row[column.key];
        // "" is deliberate for an unknown amount — never coerce it to 0.
        if (value == null) return "";
        return typeof value === "number" ? value : sanitizeCellText(String(value));
      }),
    );
  }

  sheet.columns.forEach((column) => {
    let widest = 12;
    column.eachCell?.({ includeEmpty: false }, (cell) => {
      const length = cell.value == null ? 0 : String(cell.value).length;
      if (length > widest) widest = length;
    });
    column.width = Math.min(widest + 2, 60);
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

router.get(
  "/finance/export",
  blockStudentJwt,
  requireAdminAuth,
  requireFinanceView,
  requireAnyFinanceFamily,
  requireFinanceExportPermission,
  async (req: AdminRequest, res): Promise<void> => {
    const parsed = ExportQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid query parameters" });
      return;
    }

    const admin = req.adminUser!;
    // Identical permission filtering to the transactions endpoint — the export
    // can never widen what an admin is allowed to see.
    const visibleFamilies = resolveVisibleFamilies(admin);
    const scope = resolveRequestScope(parsed.data, visibleFamilies);
    const filters = buildFilters({ ...parsed.data, page: 1 } as ParsedQuery, scope.eventTypes);

    const { data, total, truncated } = await queryFinanceTransactionsForExport(
      scope.families,
      filters,
      parsed.data.limit,
    );

    const rows = buildFinanceExportRows(data);
    const summary = buildFinanceExportSummary(data);
    const meta = exportMetaLines(parsed.data, rows.length, truncated);
    const stamp = new Date().toISOString().slice(0, 10);

    if (parsed.data.format === "xlsx") {
      try {
        const buffer = await buildFinanceXlsxBuffer(rows, summary, meta);
        await logActivity(req, {
          action: "exportExcel",
          module: "reports",
          entityType: "finance_export",
          entityId: "finance-activity",
          entityLabel: FINANCE_EXPORT_TITLE,
          after: {
            format: "xlsx",
            from: parsed.data.from ?? null,
            to: parsed.data.to ?? null,
            rowCount: rows.length,
            truncated,
            families: scope.families,
          },
          summary: `Exported ${FINANCE_EXPORT_TITLE} as Excel`,
        });
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="unified-finance-activity-${stamp}.xlsx"`);
        res.send(buffer);
      } catch (error) {
        logger.error({ err: error }, "[finance] xlsx export failed");
        res.status(500).json({ error: "Failed to generate Excel export" });
      }
      return;
    }

    if (parsed.data.format === "pdf") {
      try {
        const buffer = await buildPdfBuffer({
          title: FINANCE_EXPORT_TITLE,
          entityLabel: "Finance Activity",
          columns: [...FINANCE_EXPORT_COLUMNS],
          rows,
          // Limitations ride in the summary block so they appear on page 1 of
          // the PDF without changing the shared builder's layout contract.
          summary: {
            ...summary,
            limitation1: FINANCE_EXPORT_WARNINGS[0]!,
            limitation2: FINANCE_EXPORT_WARNINGS[1]!,
          },
          filters: { from: parsed.data.from, to: parsed.data.to },
          generatedBy: admin.username,
        });
        await logActivity(req, {
          action: "exportPdf",
          module: "reports",
          entityType: "finance_export",
          entityId: "finance-activity",
          entityLabel: FINANCE_EXPORT_TITLE,
          after: {
            format: "pdf",
            from: parsed.data.from ?? null,
            to: parsed.data.to ?? null,
            rowCount: rows.length,
            truncated,
            families: scope.families,
          },
          summary: `Exported ${FINANCE_EXPORT_TITLE} as PDF`,
        });
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="unified-finance-activity-${stamp}.pdf"`);
        res.send(buffer);
      } catch (error) {
        logger.error({ err: error }, "[finance] pdf export failed");
        res.status(500).json({ error: "Failed to generate PDF export" });
      }
      return;
    }

    res.json({
      title: FINANCE_EXPORT_TITLE,
      generatedAt: new Date().toISOString(),
      limitations: FINANCE_EXPORT_WARNINGS,
      columns: FINANCE_EXPORT_COLUMNS,
      rows,
      summary,
      total,
      truncated,
      visibleFamilies,
    });
  },
);

export default router;
