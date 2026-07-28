/**
 * Finance Phase 2D-1C — internal, read-only CLI for the zero-write historical
 * backfill dry-run planner (financeBackfillDryRun.ts).
 *
 * This module is the fully dependency-injected, testable core: argument
 * parsing, environment/database safety guards, Git/classifier identity
 * guards, and output formatting. It contains NO real I/O — the real
 * `pool`/`db`/`git`/`process` wiring lives in `financeBackfillDryRunCli.entry.ts`,
 * which is the only file this CLI's package.json script actually runs.
 *
 * Defense in depth: this file imports ONLY the dry-run planner
 * (`./../lib/financeBackfillDryRun`) — never a writer, never
 * `payment_backfill_batches`/`payment_backfill_progress` table access, never
 * a mutation helper. There is no write-mode flag anywhere in the argument
 * contract; any flag name that implies a write (write/execute/apply/mutate/
 * backfill-now/approve/commit as a bare flag) is rejected before it can even
 * reach filter construction.
 */
import {
  validateDryRunFilters,
  CLASSIFIER_VERSION,
  DRY_RUN_REPORT_SCHEMA_VERSION,
  SOURCE_FAMILIES,
  type DryRunFilters,
  type DryRunReport,
  type FamilyCursor,
  type SourceFamily,
  type EligibilityClass,
  type FinanceBackfillClassificationCode,
} from "../lib/financeBackfillDryRun";
import { decodeFinanceBackfillCursor } from "../lib/financeBackfillPagination";

export const READ_ONLY_BANNER =
  "=== Finance historical backfill DRY-RUN — READ-ONLY, ZERO-WRITE. No batch, no writer, no source mutation. ===";

export const EXIT_OK = 0;
export const EXIT_UNKNOWN_ERROR = 1;
export const EXIT_VALIDATION_ERROR = 2;
export const EXIT_SAFETY_ERROR = 3;
export const EXIT_PLANNER_ERROR = 4;

export class CliValidationError extends Error {}
export class CliSafetyError extends Error {}

// ── Argument contract ────────────────────────────────────────────────────────

const SINGLE_VALUE_FLAGS = new Set([
  "environment",
  "created-from",
  "created-to",
  "max-rows",
  "batch-size",
  "format",
  "expected-classifier-version",
  "expected-code-commit",
]);
const MULTI_VALUE_FLAGS = new Set(["source-family", "source-status", "cursor", "classification", "eligibility"]);
const KNOWN_FLAGS = new Set([...SINGLE_VALUE_FLAGS, ...MULTI_VALUE_FLAGS]);

/**
 * Flag NAMES (exact match) that imply a write/mutate/execute intent. Checked
 * only for flags that are not already in KNOWN_FLAGS, so a legitimate,
 * whitelisted flag like --expected-code-commit is never caught by the
 * substring "commit" — it is recognized as a known flag first.
 */
const WRITE_LIKE_FLAG_NAMES = new Set([
  "write",
  "write-mode",
  "enable-write",
  "execute",
  "apply",
  "apply-now",
  "mutate",
  "backfill-now",
  "approve",
  "approve-batch",
  "commit",
  "force-commit",
  "allow-production",
  "force-production",
]);

function tokenize(argv: string[]): Map<string, string[]> {
  const raw = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    // A bare "--" is the conventional end-of-options separator that npm/pnpm
    // scripts commonly forward verbatim when chaining `run` invocations
    // (e.g. root `pnpm run x -- ARGS` -> `pnpm --filter y run x -- ARGS`) —
    // treat it as a no-op, not a positional argument or unknown flag.
    if (token === "--") continue;
    if (!token.startsWith("--")) {
      throw new CliValidationError(`unexpected positional argument: "${token}"`);
    }
    const eqIndex = token.indexOf("=");
    let flag: string;
    let value: string;
    if (eqIndex !== -1) {
      flag = token.slice(2, eqIndex);
      value = token.slice(eqIndex + 1);
    } else {
      flag = token.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        value = next;
        i += 1;
      } else {
        value = "";
      }
    }

    if (!KNOWN_FLAGS.has(flag)) {
      if (WRITE_LIKE_FLAG_NAMES.has(flag)) {
        throw new CliValidationError(`write-like argument rejected: --${flag}`);
      }
      throw new CliValidationError(`unknown argument: --${flag}`);
    }

    const list = raw.get(flag) ?? [];
    list.push(value);
    raw.set(flag, list);
  }
  return raw;
}

function single(raw: Map<string, string[]>, name: string, required: boolean): string | undefined {
  const values = raw.get(name);
  if (!values || values.length === 0) {
    if (required) throw new CliValidationError(`--${name} is required`);
    return undefined;
  }
  return values[values.length - 1];
}

function multiCsv(raw: Map<string, string[]>, name: string): string[] | undefined {
  const values = raw.get(name);
  if (!values || values.length === 0) return undefined;
  const flattened = values.flatMap((v) => v.split(",")).map((s) => s.trim()).filter((s) => s.length > 0);
  return flattened.length > 0 ? flattened : undefined;
}

function parseCursors(values: string[] | undefined): FamilyCursor[] | undefined {
  if (!values || values.length === 0) return undefined;
  return values
    .flatMap((v) => v.split(","))
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((entry) => {
      const sep = entry.indexOf(":");
      if (sep === -1) {
        throw new CliValidationError(`invalid --cursor value: "${entry}" (expected family:id)`);
      }
      const family = entry.slice(0, sep);
      const idStr = entry.slice(sep + 1);
      let afterId: number;
      if (/^\d+$/.test(idStr)) {
        // Temporary backward compatibility with the previously documented
        // family:id CLI form. New reports emit opaque cursors in pageInfo.
        afterId = Number(idStr);
      } else {
        try {
          afterId = decodeFinanceBackfillCursor(idStr, family as SourceFamily).afterId;
        } catch {
          throw new CliValidationError(`invalid --cursor value: "${entry}"`);
        }
      }
      if (!Number.isSafeInteger(afterId)) {
        throw new CliValidationError(`invalid --cursor value: "${entry}"`);
      }
      return { family: family as SourceFamily, afterId };
    });
}

export interface ParsedCli {
  environment: string;
  format: "human" | "json";
  expectedClassifierVersion: string;
  expectedCodeCommit: string;
  filters: DryRunFilters;
}

/**
 * Parses argv into a ParsedCli. All filter-shape/bounds/vocabulary rules are
 * delegated to `validateDryRunFilters` — this function never reimplements
 * those checks.
 */
export function parseCliArgs(argv: string[]): ParsedCli {
  const raw = tokenize(argv);

  const environment = single(raw, "environment", true)!;
  const expectedClassifierVersion = single(raw, "expected-classifier-version", true)!;
  const expectedCodeCommit = single(raw, "expected-code-commit", true)!;

  const formatRaw = single(raw, "format", false) ?? "human";
  if (formatRaw !== "human" && formatRaw !== "json") {
    throw new CliValidationError(`unsupported --format: "${formatRaw}" (expected human|json)`);
  }

  const maxRowsRaw = single(raw, "max-rows", true)!;
  const batchSizeRaw = single(raw, "batch-size", true)!;

  const filters: DryRunFilters = {
    sourceFamilies: (multiCsv(raw, "source-family") ?? []) as SourceFamily[],
    operationalStatuses: multiCsv(raw, "source-status"),
    createdAfter: single(raw, "created-from", false),
    createdBefore: single(raw, "created-to", false),
    cursors: parseCursors(raw.get("cursor")),
    maxRows: Number(maxRowsRaw),
    batchSize: Number(batchSizeRaw),
    classificationCodes: multiCsv(raw, "classification") as FinanceBackfillClassificationCode[] | undefined,
    eligibilityClasses: multiCsv(raw, "eligibility") as EligibilityClass[] | undefined,
  };

  try {
    validateDryRunFilters(filters);
  } catch (err) {
    throw new CliValidationError(err instanceof Error ? err.message : String(err));
  }

  return { environment, format: formatRaw, expectedClassifierVersion, expectedCodeCommit, filters };
}

// ── Environment / database-target safety ────────────────────────────────────

const ALLOWED_DB_HOSTS = new Set(["localhost", "127.0.0.1"]);
const MANAGED_HOST_SUFFIXES = [
  ".rlwy.net",
  ".railway.app",
  ".railway.internal",
  ".supabase.co",
  ".neon.tech",
  ".render.com",
  ".amazonaws.com",
];

function isRailwayContextDetected(getEnv: (key: string) => string | undefined): boolean {
  return Boolean(
    getEnv("RAILWAY_ENVIRONMENT") ||
      getEnv("RAILWAY_ENVIRONMENT_NAME") ||
      getEnv("RAILWAY_PROJECT_ID") ||
      getEnv("RAILWAY_SERVICE_ID"),
  );
}

export function assertEnvironmentSafe(opts: {
  environment: string;
  databaseUrl: string | undefined;
  getEnv: (key: string) => string | undefined;
}): void {
  const env = opts.environment.trim().toLowerCase();
  if (env === "production" || env === "prod") {
    throw new CliSafetyError("refusing to run: declared environment is production");
  }
  if (isRailwayContextDetected(opts.getEnv)) {
    throw new CliSafetyError("refusing to run: Railway production context detected");
  }
  if (!opts.databaseUrl) {
    throw new CliSafetyError("refusing to run: DATABASE_URL is not set");
  }
  let url: URL;
  try {
    url = new URL(opts.databaseUrl);
  } catch {
    throw new CliSafetyError("refusing to run: DATABASE_URL could not be safely parsed");
  }
  const hostname = url.hostname.toLowerCase();
  if (MANAGED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new CliSafetyError("refusing to run: database target resolves to a managed/remote host");
  }
  if (!ALLOWED_DB_HOSTS.has(hostname)) {
    throw new CliSafetyError("refusing to run: database target is not a recognized local/disposable host");
  }
  const sslMode = url.searchParams.get("sslmode");
  if (sslMode && sslMode !== "disable" && sslMode !== "prefer") {
    throw new CliSafetyError("refusing to run: sslmode configuration suggests a managed remote database");
  }
}

// ── Git / classifier identity guards ────────────────────────────────────────

export interface GitState {
  /** null when Git metadata could not be resolved (blocks execution). */
  commit: string | null;
  /** null when clean/dirty state is unknown (treated as not-provably-clean; blocks execution). */
  dirty: boolean | null;
}

export function assertIdentityGuards(opts: {
  expectedClassifierVersion: string;
  expectedCodeCommit: string;
  actualClassifierVersion: string;
  gitState: GitState;
}): void {
  if (opts.expectedClassifierVersion !== opts.actualClassifierVersion) {
    throw new CliSafetyError("refusing to run: classifier version mismatch");
  }
  if (opts.gitState.commit == null) {
    throw new CliSafetyError("refusing to run: Git metadata unavailable");
  }
  if (opts.gitState.dirty !== false) {
    throw new CliSafetyError(
      "refusing to run: worktree is not confirmed clean — a dry-run cannot claim reproducibility against a dirty worktree",
    );
  }
  if (opts.gitState.commit !== opts.expectedCodeCommit) {
    throw new CliSafetyError("refusing to run: code commit mismatch");
  }
}

// ── Output formatting ────────────────────────────────────────────────────────

function safeFiltersForHumanOutput(filters: DryRunFilters): Record<string, unknown> {
  return {
    sourceFamilies: filters.sourceFamilies,
    operationalStatuses: filters.operationalStatuses,
    createdAfter: filters.createdAfter,
    createdBefore: filters.createdBefore,
    hasCursors: Boolean(filters.cursors && filters.cursors.length > 0),
    maxRows: filters.maxRows,
    batchSize: filters.batchSize,
    classificationCodes: filters.classificationCodes,
    eligibilityClasses: filters.eligibilityClasses,
  };
}

export function formatHumanReport(report: DryRunReport): string {
  const lines: string[] = [];
  lines.push(READ_ONLY_BANNER);
  lines.push(`report schema version: ${report.reportSchemaVersion}`);
  lines.push(`classifier version:    ${report.classifierVersion}`);
  lines.push(`code commit:           ${report.codeCommit}`);
  lines.push(`applied filters:       ${JSON.stringify(safeFiltersForHumanOutput(report.appliedFilters))}`);
  lines.push(`scanned / classified:  ${report.scannedCount} / ${report.classifiedCount}`);
  lines.push(`has next page:         ${report.pageInfo.hasNextPage}`);
  for (const family of SOURCE_FAMILIES) {
    const present = report.pageInfo.nextCursors[family] != null;
    lines.push(`next cursor (${family}): ${present ? "present — re-run with --format json to continue" : "none"}`);
  }
  lines.push(`eligibility counts:    ${JSON.stringify(report.aggregates.eligibilityCounts)}`);
  lines.push(`classification counts: ${JSON.stringify(report.aggregates.classificationCounts)}`);
  lines.push(`manual review:         ${report.aggregates.manualReviewCount}`);
  lines.push(`corrupt:               ${report.aggregates.corruptCount}`);
  lines.push(`authoritative totals (exact source-backed evidence only): ${JSON.stringify(report.authoritativeTotals)}`);
  lines.push(`estimated totals (NON-AUTHORITATIVE, excluded from Finance revenue): ${JSON.stringify(report.estimatedTotals)}`);
  lines.push(
    `unknown-amount rows:   ${report.unknownAmountPopulation.rowCount} (count only — never substituted as zero revenue)`,
  );
  return lines.join("\n");
}

const CONNECTION_STRING_PATTERN = /postgres(?:ql)?:\/\/[^\s"']+/gi;

function redact(message: string): string {
  return message.replace(CONNECTION_STRING_PATTERN, "[redacted-connection-string]");
}

function formatSafeError(errorCode: string, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return JSON.stringify({ errorCode, message: redact(message) });
}

/**
 * Planner-layer errors originate from the drizzle/pg driver, whose own
 * `.message` (e.g. "Failed query: SELECT ... WHERE id = $1") can carry raw
 * SQL text and bound parameter values — never safe to forward verbatim.
 * Unlike validation/safety errors (self-authored, safe strings), a planner
 * error always gets a fixed generic message; the errorCode + exit code
 * carry enough signal for an operator to investigate through proper access.
 */
function formatSafePlannerError(): string {
  return JSON.stringify({ errorCode: "planner_error", message: "the dry-run query failed" });
}

// ── CLI dependency contract (fully injectable — no real I/O in this file) ───

export interface CliDeps {
  runDryRun: (filters: DryRunFilters) => Promise<DryRunReport>;
  getEnv: (key: string) => string | undefined;
  getGitState: () => Promise<GitState>;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  exit: (code: number) => void;
}

export async function runCli(argv: string[], deps: CliDeps): Promise<void> {
  let parsed: ParsedCli;
  try {
    parsed = parseCliArgs(argv);
  } catch (err) {
    deps.stderr(formatSafeError("validation_error", err));
    deps.exit(EXIT_VALIDATION_ERROR);
    return;
  }

  try {
    assertEnvironmentSafe({
      environment: parsed.environment,
      databaseUrl: deps.getEnv("DATABASE_URL"),
      getEnv: deps.getEnv,
    });

    const gitState = await deps.getGitState();
    assertIdentityGuards({
      expectedClassifierVersion: parsed.expectedClassifierVersion,
      expectedCodeCommit: parsed.expectedCodeCommit,
      actualClassifierVersion: CLASSIFIER_VERSION,
      gitState,
    });
  } catch (err) {
    deps.stderr(formatSafeError("safety_error", err));
    deps.exit(EXIT_SAFETY_ERROR);
    return;
  }

  deps.stdout(READ_ONLY_BANNER);

  let report: DryRunReport;
  try {
    report = await deps.runDryRun(parsed.filters);
  } catch {
    deps.stderr(formatSafePlannerError());
    deps.exit(EXIT_PLANNER_ERROR);
    return;
  }

  deps.stdout(parsed.format === "json" ? JSON.stringify(report, null, 2) : formatHumanReport(report));
  deps.exit(EXIT_OK);
}

export { DRY_RUN_REPORT_SCHEMA_VERSION, CLASSIFIER_VERSION };
