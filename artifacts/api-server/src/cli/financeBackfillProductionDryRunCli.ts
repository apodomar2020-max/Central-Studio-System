/**
 * Finance Phase 2D-4 — dedicated production-capable read-only dry-run
 * command. Entirely separate from financeBackfillDryRunCli.ts (the
 * permanently local-only command, unmodified and unweakened by this file)
 * and from financeBackfillExecuteCli.ts (the disabled-by-default write
 * command, also unmodified here — production writes remain unavailable).
 *
 * Imports ONLY the canonical classifier + zero-write planner
 * (financeBackfillDryRun.ts) — never financeBackfillWriter.ts,
 * financeBackfillExecutionService.ts, or financeBackfillBatchService.ts.
 * This command cannot create or approve a batch, and cannot write a single
 * Finance or source row.
 *
 * Unlike the local dry-run CLI (which unconditionally REJECTS
 * `--environment production`), this command REQUIRES it — but only ever
 * proceeds after POSITIVELY proving the actual Railway production context
 * (project ID, environment name, deployed commit) from real Railway-
 * injected environment variables, not merely trusting the caller's
 * `--environment` string. A generic remote Postgres that merely calls
 * itself "production" is rejected exactly like the local CLI would reject
 * it — see assertProductionContext.
 */
import {
  formatHumanReport,
  CliValidationError,
  CliSafetyError,
} from "./financeBackfillDryRunCli";
import {
  validateDryRunFilters,
  SOURCE_FAMILIES,
  CLASSIFIER_VERSION,
  MAX_ROWS_LIMIT,
  MAX_BATCH_SIZE,
  type DryRunFilters,
  type DryRunReport,
  type FinanceBackfillClassificationCode,
  type EligibilityClass,
} from "../lib/financeBackfillDryRun";

export const READ_ONLY_PRODUCTION_BANNER =
  "=== Finance PRODUCTION historical backfill DRY-RUN — READ-ONLY, ZERO-WRITE, DB-transaction-enforced. No batch, no writer, no source mutation. ===";

export const REQUIRED_AUTH_FLAG = "--i-authorize-production-read-only-dry-run";
const REQUIRED_CONFIRMATION_PHRASE = "PRODUCTION READ-ONLY DRY-RUN";

export const EXIT_OK = 0;
export const EXIT_VALIDATION_ERROR = 2;
export const EXIT_SAFETY_ERROR = 3;
export const EXIT_PLANNER_ERROR = 4;

// ── Argument parsing ─────────────────────────────────────────────────────────

const SINGLE_VALUE_FLAGS = new Set([
  "environment",
  "confirm",
  "expected-classifier-version",
  "expected-commit",
  "created-from",
  "created-to",
  "max-rows",
  "batch-size",
  "format",
]);
const MULTI_VALUE_FLAGS = new Set(["source-family", "source-status", "classification", "eligibility", "cursor"]);
const KNOWN_FLAGS = new Set([...SINGLE_VALUE_FLAGS, ...MULTI_VALUE_FLAGS]);

const WRITE_LIKE_FLAG_NAMES = new Set([
  "write", "write-mode", "execute", "apply", "mutate", "backfill-now",
  "approve", "commit", "force", "skip-confirmation", "auto", "unattended",
]);

export interface ParsedProductionDryRunCli {
  environment: string;
  confirmationPhrase: string;
  expectedClassifierVersion: string;
  expectedCommit: string;
  format: "human" | "json";
  filters: DryRunFilters;
}

function tokenize(argv: string[]): { flags: Map<string, string[]>; boolFlags: Set<string> } {
  const flags = new Map<string, string[]>();
  const boolFlags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--") continue;
    if (token === REQUIRED_AUTH_FLAG) {
      boolFlags.add(token);
      continue;
    }
    if (!token.startsWith("--")) throw new CliValidationError(`unexpected positional argument: "${token}"`);
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
        throw new CliValidationError(`write-like/unattended argument rejected: --${flag}`);
      }
      throw new CliValidationError(`unknown argument: --${flag}`);
    }
    const list = flags.get(flag) ?? [];
    list.push(value);
    flags.set(flag, list);
  }
  return { flags, boolFlags };
}

function single(flags: Map<string, string[]>, name: string, required: boolean): string | undefined {
  const values = flags.get(name);
  if (!values || values.length === 0) {
    if (required) throw new CliValidationError(`--${name} is required`);
    return undefined;
  }
  return values[values.length - 1];
}

function multiCsv(flags: Map<string, string[]>, name: string): string[] | undefined {
  const values = flags.get(name);
  if (!values || values.length === 0) return undefined;
  const flattened = values.flatMap((v) => v.split(",")).map((s) => s.trim()).filter((s) => s.length > 0);
  return flattened.length > 0 ? flattened : undefined;
}

export function parseProductionDryRunArgs(argv: string[]): ParsedProductionDryRunCli {
  const { flags, boolFlags } = tokenize(argv);

  if (!boolFlags.has(REQUIRED_AUTH_FLAG)) {
    throw new CliValidationError(
      `production read-only dry-run requires ${REQUIRED_AUTH_FLAG} — no other flag or environment variable enables it`,
    );
  }

  const environment = single(flags, "environment", true)!;
  if (environment.trim().toLowerCase() !== "production") {
    throw new CliValidationError('--environment must be exactly "production" for this command');
  }

  const confirmationPhrase = single(flags, "confirm", true)!;
  if (confirmationPhrase !== REQUIRED_CONFIRMATION_PHRASE) {
    throw new CliValidationError(`--confirm must be the exact phrase "${REQUIRED_CONFIRMATION_PHRASE}"`);
  }

  const expectedClassifierVersion = single(flags, "expected-classifier-version", true)!;
  const expectedCommit = single(flags, "expected-commit", true)!;

  const formatRaw = single(flags, "format", false) ?? "json";
  if (formatRaw !== "human" && formatRaw !== "json") {
    throw new CliValidationError(`unsupported --format: "${formatRaw}" (expected human|json)`);
  }

  const sourceFamilies = multiCsv(flags, "source-family");
  if (!sourceFamilies || sourceFamilies.length === 0) {
    throw new CliValidationError("--source-family is required and must be non-empty");
  }

  const maxRowsRaw = single(flags, "max-rows", true)!;
  const batchSizeRaw = single(flags, "batch-size", true)!;

  const filters: DryRunFilters = {
    sourceFamilies: sourceFamilies as DryRunFilters["sourceFamilies"],
    operationalStatuses: multiCsv(flags, "source-status"),
    createdAfter: single(flags, "created-from", false),
    createdBefore: single(flags, "created-to", false),
    maxRows: Number(maxRowsRaw),
    batchSize: Number(batchSizeRaw),
    classificationCodes: multiCsv(flags, "classification") as FinanceBackfillClassificationCode[] | undefined,
    eligibilityClasses: multiCsv(flags, "eligibility") as EligibilityClass[] | undefined,
  };

  try {
    validateDryRunFilters(filters);
  } catch (err) {
    throw new CliValidationError(err instanceof Error ? err.message : String(err));
  }
  if (filters.maxRows > MAX_ROWS_LIMIT) throw new CliValidationError(`--max-rows exceeds the maximum allowed value of ${MAX_ROWS_LIMIT}`);
  if (filters.batchSize > MAX_BATCH_SIZE) throw new CliValidationError(`--batch-size exceeds the maximum allowed value of ${MAX_BATCH_SIZE}`);

  return { environment, confirmationPhrase, expectedClassifierVersion, expectedCommit, format: formatRaw, filters };
}

// ── Positive production-context proof ───────────────────────────────────────

export const EXPECTED_RAILWAY_PROJECT_ID = "661e8a23-299b-406e-ab0e-58499de14601";

/** Railway's own internal Postgres hostname pattern for this project. */
const RAILWAY_MANAGED_DB_HOST_PATTERN = /\.railway\.internal$/i;

export function assertProductionContext(opts: {
  getEnv: (key: string) => string | undefined;
  expectedCommit: string;
  expectedClassifierVersion: string;
  actualClassifierVersion: string;
}): void {
  const railwayEnvironment = (opts.getEnv("RAILWAY_ENVIRONMENT_NAME") ?? opts.getEnv("RAILWAY_ENVIRONMENT"))?.toLowerCase();
  if (railwayEnvironment !== "production") {
    throw new CliSafetyError("refusing to run: Railway environment context is not positively confirmed as production");
  }

  const projectId = opts.getEnv("RAILWAY_PROJECT_ID");
  if (projectId !== EXPECTED_RAILWAY_PROJECT_ID) {
    throw new CliSafetyError("refusing to run: Railway project ID does not match the expected production project");
  }

  const serviceId = opts.getEnv("RAILWAY_SERVICE_ID");
  if (!serviceId || serviceId.trim().length === 0) {
    throw new CliSafetyError("refusing to run: Railway service context is not present");
  }

  const databaseUrl = opts.getEnv("DATABASE_URL");
  if (!databaseUrl) {
    throw new CliSafetyError("refusing to run: DATABASE_URL is not set");
  }
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new CliSafetyError("refusing to run: DATABASE_URL could not be safely parsed");
  }
  if (!RAILWAY_MANAGED_DB_HOST_PATTERN.test(url.hostname)) {
    throw new CliSafetyError("refusing to run: database target does not match the expected Railway-managed host pattern");
  }

  const deployedCommit = opts.getEnv("RAILWAY_GIT_COMMIT_SHA");
  if (!deployedCommit) {
    throw new CliSafetyError("refusing to run: deployed commit metadata is unavailable");
  }
  if (deployedCommit !== opts.expectedCommit) {
    throw new CliSafetyError("refusing to run: deployed commit does not match the expected commit");
  }

  if (opts.actualClassifierVersion !== opts.expectedClassifierVersion) {
    throw new CliSafetyError("refusing to run: classifier version mismatch");
  }
}

// ── Output ───────────────────────────────────────────────────────────────────

function formatSafeError(errorCode: string, err: unknown): string {
  const CONNECTION_STRING_PATTERN = /postgres(?:ql)?:\/\/[^\s"']+/gi;
  if (errorCode === "planner_error") {
    // Never forward a driver/query error's raw text — see the analogous
    // fix in financeBackfillDryRunCli.ts's Phase 2D-1D security review.
    return JSON.stringify({ errorCode, message: "the production dry-run query failed" });
  }
  const message = err instanceof Error ? err.message : String(err);
  return JSON.stringify({ errorCode, message: message.replace(CONNECTION_STRING_PATTERN, "[redacted-connection-string]") });
}

// ── Dependency contract ──────────────────────────────────────────────────────

export interface ProductionDryRunCliDeps {
  getEnv: (key: string) => string | undefined;
  /** Runs the planner inside a real Postgres read-only transaction. */
  runDryRun: (filters: DryRunFilters) => Promise<DryRunReport>;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  exit: (code: number) => void;
}

export async function runProductionDryRunCli(argv: string[], deps: ProductionDryRunCliDeps): Promise<void> {
  let parsed: ParsedProductionDryRunCli;
  try {
    parsed = parseProductionDryRunArgs(argv);
  } catch (err) {
    deps.stderr(formatSafeError("validation_error", err));
    deps.exit(EXIT_VALIDATION_ERROR);
    return;
  }

  try {
    assertProductionContext({
      getEnv: deps.getEnv,
      expectedCommit: parsed.expectedCommit,
      expectedClassifierVersion: parsed.expectedClassifierVersion,
      actualClassifierVersion: CLASSIFIER_VERSION,
    });
  } catch (err) {
    deps.stderr(formatSafeError("safety_error", err));
    deps.exit(EXIT_SAFETY_ERROR);
    return;
  }

  deps.stdout(READ_ONLY_PRODUCTION_BANNER);

  let report: DryRunReport;
  try {
    report = await deps.runDryRun(parsed.filters);
  } catch {
    deps.stderr(formatSafeError("planner_error", undefined));
    deps.exit(EXIT_PLANNER_ERROR);
    return;
  }

  deps.stdout(parsed.format === "json" ? JSON.stringify(report, null, 2) : formatHumanReport(report));
  deps.exit(EXIT_OK);
}

export { SOURCE_FAMILIES, CLASSIFIER_VERSION };
