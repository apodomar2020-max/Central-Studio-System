/**
 * Finance Phase 2D-3 — internal execution CLI for the exact-evidence-only
 * historical backfill writer. Separate from, and far more heavily guarded
 * than, the Phase 2D-1C read-only dry-run CLI.
 *
 * DISABLED BY DEFAULT: this command refuses to run at all unless
 * `--i-have-reviewed-the-dry-run-and-authorize-execution` is passed
 * verbatim — no other flag or environment variable enables it. There is no
 * Worker schedule, no Admin button, and nothing in this repository invokes
 * this CLI automatically on deploy or on any other trigger.
 *
 * Every safety property of the dry-run CLI (production/Railway/remote-DB
 * rejection reasoning, Git/classifier identity guards) is reused, not
 * reimplemented — see the imports below. This module adds the additional
 * guards a MUTATING command requires on top of those.
 */
import {
  assertEnvironmentSafe,
  assertIdentityGuards,
  CliSafetyError,
  CliValidationError,
  type GitState,
} from "./financeBackfillDryRunCli";
export type { GitState };
import { CLASSIFIER_VERSION, validateDryRunFilters, type DryRunFilters, type DryRunReport } from "../lib/financeBackfillDryRun";
import type { RunChunkReport } from "../lib/financeBackfillExecutionService";

export const EXECUTION_DISABLED_BY_DEFAULT_FLAG = "--i-have-reviewed-the-dry-run-and-authorize-execution";
const REQUIRED_CONFIRMATION_PHRASE = "EXECUTE HISTORICAL BACKFILL";

export const EXIT_OK = 0;
export const EXIT_VALIDATION_ERROR = 2;
export const EXIT_SAFETY_ERROR = 3;
export const EXIT_EXECUTION_ERROR = 4;
export const EXIT_NOT_AUTHORIZED = 5;

export interface ExecuteCliArgs {
  environment: string;
  approvedBatchId: string;
  expectedClassifierVersion: string;
  expectedCodeCommit: string;
  expectedEvidenceFingerprint: string;
  maxRows: number;
  chunkSize: number;
  confirmationPhrase: string;
  executionAuthorized: boolean;
  operator: string;
}

const SINGLE_VALUE_FLAGS = new Set([
  "environment",
  "approved-batch-id",
  "expected-classifier-version",
  "expected-code-commit",
  "expected-evidence-fingerprint",
  "max-rows",
  "chunk-size",
  "confirm",
  "operator",
]);

const WRITE_LIKE_UNKNOWN_FLAG_NAMES = new Set(["force", "skip-confirmation", "auto", "unattended"]);

function tokenize(argv: string[]): { flags: Map<string, string[]>; boolFlags: Set<string> } {
  const flags = new Map<string, string[]>();
  const boolFlags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--") continue;
    if (token === EXECUTION_DISABLED_BY_DEFAULT_FLAG) {
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
    if (!SINGLE_VALUE_FLAGS.has(flag)) {
      if (WRITE_LIKE_UNKNOWN_FLAG_NAMES.has(flag)) {
        throw new CliValidationError(`unsafe unattended-execution flag rejected: --${flag}`);
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

export function parseExecuteCliArgs(argv: string[]): ExecuteCliArgs {
  const { flags, boolFlags } = tokenize(argv);

  const executionAuthorized = boolFlags.has(EXECUTION_DISABLED_BY_DEFAULT_FLAG);
  if (!executionAuthorized) {
    throw new CliValidationError(
      `execution is disabled by default — pass ${EXECUTION_DISABLED_BY_DEFAULT_FLAG} only after reviewing a production dry-run report`,
    );
  }

  const environment = single(flags, "environment", true)!;
  const approvedBatchId = single(flags, "approved-batch-id", true)!;
  const expectedClassifierVersion = single(flags, "expected-classifier-version", true)!;
  const expectedCodeCommit = single(flags, "expected-code-commit", true)!;
  const expectedEvidenceFingerprint = single(flags, "expected-evidence-fingerprint", true)!;
  const maxRowsRaw = single(flags, "max-rows", true)!;
  const chunkSizeRaw = single(flags, "chunk-size", true)!;
  const confirmationPhrase = single(flags, "confirm", true)!;
  const operator = single(flags, "operator", true)!;

  const maxRows = Number(maxRowsRaw);
  const chunkSize = Number(chunkSizeRaw);
  if (!Number.isInteger(maxRows) || maxRows <= 0) throw new CliValidationError("--max-rows must be a positive integer");
  if (maxRows > 500) throw new CliValidationError("--max-rows exceeds the maximum allowed value of 500 for a single execution");
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) throw new CliValidationError("--chunk-size must be a positive integer");
  if (chunkSize > 50) throw new CliValidationError("--chunk-size exceeds the maximum allowed value of 50");
  if (confirmationPhrase !== REQUIRED_CONFIRMATION_PHRASE) {
    throw new CliValidationError(`--confirm must be the exact phrase "${REQUIRED_CONFIRMATION_PHRASE}"`);
  }
  if (!approvedBatchId || approvedBatchId.trim().length === 0) throw new CliValidationError("--approved-batch-id is required");
  if (!operator || operator.trim().length === 0) throw new CliValidationError("--operator is required");

  return {
    environment,
    approvedBatchId,
    expectedClassifierVersion,
    expectedCodeCommit,
    expectedEvidenceFingerprint,
    maxRows,
    chunkSize,
    confirmationPhrase,
    executionAuthorized,
    operator,
  };
}

// ── Dependency contract (fully injectable) ──────────────────────────────────

export interface ExecuteCliDeps {
  getEnv: (key: string) => string | undefined;
  getGitState: () => Promise<GitState>;
  /** Returns the current active-batch-scope check: true if any OTHER active batch overlaps this one's scope. */
  hasOverlappingActiveBatch: (batchId: string) => Promise<boolean>;
  /** Re-runs the read-only dry-run planner against the batch's pinned scope, for the count-equality check. */
  runDryRunForBatch: (batchId: string) => Promise<DryRunReport>;
  /** The batch's originally-approved expected eligible count. */
  getApprovedExpectedEligibleCount: (batchId: string) => Promise<number | null>;
  /** Second, separate confirmation prompt — must return true for execution to proceed. */
  requestSecondConfirmation: () => Promise<boolean>;
  runChunk: (batchId: string, maxRows: number, chunkSize: number) => Promise<RunChunkReport>;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  exit: (code: number) => void;
}

const CONNECTION_STRING_PATTERN = /postgres(?:ql)?:\/\/[^\s"']+/gi;
function redact(message: string): string {
  return message.replace(CONNECTION_STRING_PATTERN, "[redacted-connection-string]");
}
function formatSafeError(errorCode: string, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return JSON.stringify({ errorCode, message: redact(message) });
}

export async function runExecuteCli(argv: string[], deps: ExecuteCliDeps): Promise<void> {
  let args: ExecuteCliArgs;
  try {
    args = parseExecuteCliArgs(argv);
  } catch (err) {
    deps.stderr(formatSafeError("validation_error", err));
    deps.exit(err instanceof CliValidationError && argv.every((a) => a !== EXECUTION_DISABLED_BY_DEFAULT_FLAG) ? EXIT_NOT_AUTHORIZED : EXIT_VALIDATION_ERROR);
    return;
  }

  try {
    assertEnvironmentSafe({ environment: args.environment, databaseUrl: deps.getEnv("DATABASE_URL"), getEnv: deps.getEnv });
    const gitState = await deps.getGitState();
    assertIdentityGuards({
      expectedClassifierVersion: args.expectedClassifierVersion,
      expectedCodeCommit: args.expectedCodeCommit,
      actualClassifierVersion: CLASSIFIER_VERSION,
      gitState,
    });

    if (await deps.hasOverlappingActiveBatch(args.approvedBatchId)) {
      throw new CliSafetyError("refusing to run: another active batch overlaps this batch's scope");
    }

    const dryRunReport = await deps.runDryRunForBatch(args.approvedBatchId);
    const expectedEligibleCount = await deps.getApprovedExpectedEligibleCount(args.approvedBatchId);
    if (expectedEligibleCount == null) {
      throw new CliSafetyError("refusing to run: batch has no approved expected eligible count on record");
    }
    const currentExactEligible = dryRunReport.aggregates.automaticExactCount;
    if (currentExactEligible !== expectedEligibleCount) {
      throw new CliSafetyError(
        `refusing to run: dry-run count mismatch — approved expected ${expectedEligibleCount}, current dry-run shows ${currentExactEligible}. Re-approve before executing.`,
      );
    }

    const confirmed = await deps.requestSecondConfirmation();
    if (!confirmed) {
      throw new CliSafetyError("refusing to run: second confirmation was not granted");
    }
  } catch (err) {
    deps.stderr(formatSafeError("safety_error", err));
    deps.exit(EXIT_SAFETY_ERROR);
    return;
  }

  deps.stdout(
    JSON.stringify({
      banner: "=== EXECUTING BOUNDED HISTORICAL BACKFILL CHUNK — EXACT EVIDENCE ONLY ===",
      batchId: args.approvedBatchId,
      operator: args.operator,
      maxRows: args.maxRows,
      chunkSize: args.chunkSize,
    }),
  );

  try {
    const report = await deps.runChunk(args.approvedBatchId, args.maxRows, args.chunkSize);
    deps.stdout(
      JSON.stringify({
        attempted: report.attempted,
        written: report.written,
        alreadyCanonical: report.alreadyCanonical,
        notEligible: report.notEligible,
        duplicates: report.duplicates,
        stoppedEarly: report.stoppedEarly,
      }),
    );
    deps.exit(EXIT_OK);
  } catch {
    deps.stderr(formatSafeError("execution_error", new Error("the bounded execution chunk failed")));
    deps.exit(EXIT_EXECUTION_ERROR);
  }
}
