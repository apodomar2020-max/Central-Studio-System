/**
 * News → Editorial migration — PRODUCTION AUTHORIZATION LAYER.
 * Final Editorial, Phase B.
 *
 * ─── WHY THIS FILE EXISTS ────────────────────────────────────────────────
 *
 * `newsMigrationCli.ts` reuses the finance backfill's `assertEnvironmentSafe`,
 * which refuses a production environment in ALL FIVE modes. That is correct
 * and stays exactly as it is — but as shipped it left the migration with no
 * designed way to ever run against production at all. The only way to run
 * the Phase B migration for real would then have been an ad-hoc, unreviewed
 * patch to a safety guard, written under time pressure on the day of the
 * cutover. A safety guard edited in a hurry is not a safety guard.
 *
 * So the authorized path is DESIGNED, REVIEWED AND TESTED AHEAD OF TIME,
 * here, in a file that is separate from the local CLI and never weakens it.
 *
 * ─── TWO CAPABILITY CLASSES, NOT ONE GATE ────────────────────────────────
 *
 *   READ-ONLY  (dry-run, verify, rollback-dry-run)
 *       Needs: positive Railway production proof + the read-only
 *       authorization flag + the read-only confirmation phrase. Runs inside
 *       the SAME `SET TRANSACTION READ ONLY` wrapper the local CLI already
 *       uses for these three modes, so a mutation is rejected by Postgres
 *       itself rather than by this code's good intentions.
 *
 *   WRITE      (execute, rollback)
 *       Needs everything above, with a DIFFERENT authorization flag, a
 *       DIFFERENT and stronger confirmation phrase, a second interactive
 *       typed confirmation that cannot come from argv, a fully-resolved
 *       manifest, and a plan with zero blockers. There is no default and no
 *       fallback into this class: an entrypoint declares which class it may
 *       serve, and a mode outside that class is refused before anything else
 *       happens.
 *
 * A single gate with a boolean would make "read-only production" and
 * "rewrite production content" one decision. They are not one decision, and
 * the authorization an owner grants for one must not be spendable on the
 * other — which is why the flags and the phrases are disjoint by
 * construction.
 *
 * ─── POSITIVE PROOF, NOT ABSENCE OF EVIDENCE ─────────────────────────────
 *
 * `assertEnvironmentSafe` protects by FAILING TO DETECT production. That is
 * the right shape for a tool that must never reach production. It is the
 * wrong shape for one that must reach production and nothing else: "I could
 * not prove this is production" would then be indistinguishable from "this
 * is a staging clone". `assertNewsProductionContext` therefore proves the
 * real context POSITIVELY — Railway environment name, the expected project
 * ID, a service context, a `.railway.internal` database host, and a deployed
 * commit that matches the one the operator declares — exactly as the Finance
 * production dry-run does. None of these can be produced from a laptop.
 *
 * ─── NOTHING HERE RE-IMPLEMENTS THE MIGRATION ────────────────────────────
 *
 * This file contains zero migration business logic. Planner, writer, verify,
 * rollback, mapping and manifest are reached only through the injected deps,
 * which the entrypoints wire to the SAME already-tested engine the local CLI
 * uses. In particular the production dry-run derives its counts from the real
 * planner against whatever rows the connected database actually holds — it
 * knows nothing of the repo's seed fixtures and contains no expected count.
 */
import { CliSafetyError, CliValidationError } from "./financeBackfillDryRunCli";
import {
  parseNewsMigrationManifest,
  ManifestError,
  type NewsMigrationManifest,
} from "../lib/newsMigrationManifest";
import {
  NEWS_MIGRATION_PLAN_SCHEMA_VERSION,
  planIsExecutable,
  type NewsMigrationPlan,
} from "../lib/newsMigrationPlanner";
import type { ExecuteResult } from "../lib/newsMigrationWriter";
import type { RollbackReport } from "../lib/newsMigrationRollback";
import type { VerifyReport } from "../lib/newsMigrationVerify";
import {
  MODES,
  WRITING_MODES,
  formatPlan,
  formatExecute,
  formatVerify,
  formatRollback,
  type Mode,
} from "./newsMigrationCli";

export const EXIT_OK = 0;
export const EXIT_UNKNOWN_ERROR = 1;
export const EXIT_VALIDATION_ERROR = 2;
export const EXIT_SAFETY_ERROR = 3;
export const EXIT_BLOCKED = 4;
export const EXIT_VERIFY_FAILED = 5;

/** The two capability classes. An entrypoint serves exactly one. */
export type Capability = "read-only" | "write";

export const READ_ONLY_MODES: ReadonlySet<Mode> = new Set<Mode>([
  "dry-run",
  "verify",
  "rollback-dry-run",
]);

export function capabilityOfMode(mode: Mode): Capability {
  return WRITING_MODES.has(mode) ? "write" : "read-only";
}

/**
 * Authorization flags. Disjoint on purpose: an operator who has been given
 * the read-only flag cannot reach a write mode by changing `--mode`, because
 * the write class demands a flag they were not given.
 */
export const READ_ONLY_AUTH_FLAG = "--i-authorize-production-read-only-news-migration";
export const WRITE_AUTH_FLAG = "--i-authorize-production-news-migration-write";

/**
 * Confirmation phrases. Non-secret, human-typed values — deliberately NOT
 * secret material, exactly as the Finance production dry-run treats its own
 * phrase. Their job is to make an operator state out loud what they are about
 * to do, not to be unguessable.
 */
export const READ_ONLY_CONFIRMATION_PHRASE = "PRODUCTION READ-ONLY NEWS MIGRATION";
export const PRODUCTION_EXECUTE_CONFIRMATION_PHRASE =
  "PRODUCTION MIGRATE NEWS TO EDITORIAL";
export const PRODUCTION_ROLLBACK_CONFIRMATION_PHRASE =
  "PRODUCTION ROLL BACK NEWS MIGRATION";

export function confirmationPhraseForMode(mode: Mode): string {
  if (mode === "execute") return PRODUCTION_EXECUTE_CONFIRMATION_PHRASE;
  if (mode === "rollback") return PRODUCTION_ROLLBACK_CONFIRMATION_PHRASE;
  return READ_ONLY_CONFIRMATION_PHRASE;
}

export const READ_ONLY_PRODUCTION_BANNER =
  "=== News → Editorial migration — PRODUCTION READ-ONLY. Zero-write, enforced by the database transaction itself. website_news_posts is never modified in any mode. ===";
export const WRITE_PRODUCTION_BANNER =
  "=== News → Editorial migration — PRODUCTION WRITE. Authorized, manifest-complete, zero-blocker. website_news_posts is never modified in any mode. ===";

// ── Argument parsing ─────────────────────────────────────────────────────────

const SINGLE_VALUE_FLAGS = new Set([
  "mode",
  "manifest",
  "environment",
  "format",
  "confirm",
  "expected-commit",
  "expected-plan-schema-version",
]);
const BOOLEAN_FLAGS = new Set(["include-edited"]);
const KNOWN_FLAGS = new Set([...SINGLE_VALUE_FLAGS, ...BOOLEAN_FLAGS]);

/**
 * Flag NAMES that mean "do it anyway". Rejected by name before any other
 * parsing, so a scripted attempt to weaken a guard fails at the argument
 * contract rather than quietly somewhere deeper. Superset of the local CLI's
 * list plus the Finance write-like list — the two tools must not disagree
 * about which words are forbidden.
 */
const FORBIDDEN_FLAG_NAMES = new Set([
  "force",
  "force-production",
  "allow-production",
  "skip-safety",
  "skip-guards",
  "no-guards",
  "ignore-blockers",
  "ignore-manifest",
  "skip-blockers",
  "skip-confirmation",
  "yes",
  "auto",
  "auto-approve",
  "unattended",
  "apply",
  "mutate",
  "write",
  "write-mode",
]);

export interface ParsedProductionCli {
  mode: Mode;
  capability: Capability;
  manifestPath: string;
  environment: string;
  format: "human" | "json";
  expectedCommit: string;
  expectedPlanSchemaVersion: number;
  includeEdited: boolean;
}

/**
 * @param capability the class this ENTRYPOINT is allowed to serve. Passed in
 * by the entrypoint, never derived from argv — that is what makes it
 * structurally impossible to reach a write mode through the read-only
 * command.
 */
export function parseProductionCliArgs(argv: string[], capability: Capability): ParsedProductionCli {
  const flags = new Map<string, string[]>();
  const boolFlags = new Set<string>();

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--") continue;
    if (token === READ_ONLY_AUTH_FLAG || token === WRITE_AUTH_FLAG) {
      boolFlags.add(token);
      continue;
    }
    if (!token.startsWith("--")) {
      throw new CliValidationError(`unexpected positional argument: "${token}"`);
    }
    const eq = token.indexOf("=");
    let flag: string;
    let value: string;
    if (eq !== -1) {
      flag = token.slice(2, eq);
      value = token.slice(eq + 1);
    } else {
      flag = token.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--") && !BOOLEAN_FLAGS.has(flag)) {
        value = next;
        i += 1;
      } else {
        value = "";
      }
    }
    if (!KNOWN_FLAGS.has(flag)) {
      if (FORBIDDEN_FLAG_NAMES.has(flag)) {
        throw new CliValidationError(
          `guard-weakening argument rejected: --${flag}. A production run is authorized by a named authorization flag and a typed phrase, never by a flag that skips a check.`,
        );
      }
      throw new CliValidationError(`unknown argument: --${flag}`);
    }
    const list = flags.get(flag) ?? [];
    list.push(value);
    flags.set(flag, list);
  }

  const last = (name: string): string | undefined => {
    const values = flags.get(name);
    return values && values.length > 0 ? values[values.length - 1] : undefined;
  };

  // ── The authorization flag for THIS class, and only this class ──────────
  const requiredAuthFlag = capability === "write" ? WRITE_AUTH_FLAG : READ_ONLY_AUTH_FLAG;
  const otherAuthFlag = capability === "write" ? READ_ONLY_AUTH_FLAG : WRITE_AUTH_FLAG;
  if (boolFlags.has(otherAuthFlag)) {
    throw new CliValidationError(
      `${otherAuthFlag} authorizes the other capability class and is not accepted by this command`,
    );
  }
  if (!boolFlags.has(requiredAuthFlag)) {
    throw new CliValidationError(
      `a production ${capability} operation requires ${requiredAuthFlag} — no other flag, no environment variable and no configuration file enables it`,
    );
  }

  const modeRaw = last("mode");
  if (!modeRaw) throw new CliValidationError("--mode is required");
  if (!(MODES as readonly string[]).includes(modeRaw)) {
    throw new CliValidationError(`unsupported --mode: "${modeRaw}" (expected ${MODES.join("|")})`);
  }
  const mode = modeRaw as Mode;

  // The load-bearing check: a write mode can never be reached through the
  // read-only entrypoint, and vice versa.
  if (capabilityOfMode(mode) !== capability) {
    throw new CliValidationError(
      `--mode ${mode} is a ${capabilityOfMode(mode)} operation and cannot be run by the production ${capability} command`,
    );
  }

  const environment = last("environment");
  if (!environment) throw new CliValidationError("--environment is required");
  if (environment.trim().toLowerCase() !== "production") {
    throw new CliValidationError('--environment must be exactly "production" for this command');
  }

  const confirm = last("confirm");
  const expectedPhrase = confirmationPhraseForMode(mode);
  if (!confirm) throw new CliValidationError("--confirm is required");
  if (confirm !== expectedPhrase) {
    throw new CliValidationError(`--confirm must be the exact phrase "${expectedPhrase}"`);
  }

  const manifestPath = last("manifest");
  if (!manifestPath) {
    throw new CliValidationError(
      "--manifest is required in every mode. Even a read-only mode needs it: the manifest defines the scope, the language and the decisions the plan is computed from.",
    );
  }

  const expectedCommit = last("expected-commit");
  if (!expectedCommit) {
    throw new CliValidationError(
      "--expected-commit is required, so the deployed code this runs against can be proved to be the reviewed code",
    );
  }

  const schemaRaw = last("expected-plan-schema-version");
  if (!schemaRaw) throw new CliValidationError("--expected-plan-schema-version is required");
  const expectedPlanSchemaVersion = Number(schemaRaw);
  if (!Number.isInteger(expectedPlanSchemaVersion)) {
    throw new CliValidationError("--expected-plan-schema-version must be an integer");
  }

  const formatRaw = last("format") ?? "human";
  if (formatRaw !== "human" && formatRaw !== "json") {
    throw new CliValidationError(`unsupported --format: "${formatRaw}" (expected human|json)`);
  }

  const includeEdited = flags.has("include-edited");
  if (includeEdited && mode !== "rollback" && mode !== "rollback-dry-run") {
    throw new CliValidationError("--include-edited only applies to the rollback modes");
  }

  return {
    mode,
    capability,
    manifestPath,
    environment,
    format: formatRaw,
    expectedCommit,
    expectedPlanSchemaVersion,
    includeEdited,
  };
}

// ── Positive production-context proof ───────────────────────────────────────

/**
 * Re-exported from the Finance production dry-run rather than re-declared:
 * two constants for one project ID would eventually disagree, and the one
 * that disagreed would be the one guarding a write.
 */
export { EXPECTED_RAILWAY_PROJECT_ID } from "./financeBackfillProductionDryRunCli";
import { EXPECTED_RAILWAY_PROJECT_ID as EXPECTED_PROJECT_ID } from "./financeBackfillProductionDryRunCli";

/** Railway's own internal Postgres hostname pattern for this project. */
const RAILWAY_MANAGED_DB_HOST_PATTERN = /\.railway\.internal$/i;

export function assertNewsProductionContext(opts: {
  getEnv: (key: string) => string | undefined;
  expectedCommit: string;
  expectedPlanSchemaVersion: number;
  actualPlanSchemaVersion: number;
}): void {
  const railwayEnvironment = (
    opts.getEnv("RAILWAY_ENVIRONMENT_NAME") ?? opts.getEnv("RAILWAY_ENVIRONMENT")
  )?.toLowerCase();
  if (railwayEnvironment !== "production") {
    throw new CliSafetyError(
      "refusing to run: Railway environment context is not positively confirmed as production",
    );
  }

  if (opts.getEnv("RAILWAY_PROJECT_ID") !== EXPECTED_PROJECT_ID) {
    throw new CliSafetyError(
      "refusing to run: Railway project ID does not match the expected production project",
    );
  }

  const serviceId = opts.getEnv("RAILWAY_SERVICE_ID");
  if (!serviceId || serviceId.trim().length === 0) {
    throw new CliSafetyError("refusing to run: Railway service context is not present");
  }

  const databaseUrl = opts.getEnv("DATABASE_URL");
  if (!databaseUrl) throw new CliSafetyError("refusing to run: DATABASE_URL is not set");
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new CliSafetyError("refusing to run: DATABASE_URL could not be safely parsed");
  }
  if (!RAILWAY_MANAGED_DB_HOST_PATTERN.test(url.hostname)) {
    throw new CliSafetyError(
      "refusing to run: database target does not match the expected Railway-managed host pattern",
    );
  }

  const deployedCommit = opts.getEnv("RAILWAY_GIT_COMMIT_SHA");
  if (!deployedCommit) {
    throw new CliSafetyError("refusing to run: deployed commit metadata is unavailable");
  }
  if (deployedCommit !== opts.expectedCommit) {
    throw new CliSafetyError("refusing to run: deployed commit does not match the expected commit");
  }

  if (opts.actualPlanSchemaVersion !== opts.expectedPlanSchemaVersion) {
    throw new CliSafetyError("refusing to run: migration plan schema version mismatch");
  }
}

// ── Output safety ────────────────────────────────────────────────────────────

const CONNECTION_STRING_PATTERN = /postgres(?:ql)?:\/\/[^\s"']+/gi;

/**
 * Errors crossing this boundary are redacted rather than forwarded. A driver
 * error's raw text can carry a connection string, and an operator running
 * this will be pasting its output into a review document.
 */
export function formatSafeError(errorCode: string, err: unknown): string {
  if (errorCode === "engine_error") {
    return JSON.stringify({ errorCode, message: "the production migration operation failed" });
  }
  const message = err instanceof Error ? err.message : String(err);
  return JSON.stringify({
    errorCode,
    message: message.replace(CONNECTION_STRING_PATTERN, "[redacted-connection-string]"),
  });
}

// ── Dependency contract ──────────────────────────────────────────────────────

/**
 * Deliberately the same engine-facing shape the local CLI uses. The
 * entrypoints wire these to the SAME planner / writer / verify / rollback
 * functions — there is no second implementation of anything.
 */
export interface ProductionCliDeps {
  readManifestFile: (path: string) => Promise<string>;
  getEnv: (key: string) => string | undefined;
  runDryRun: (manifest: NewsMigrationManifest) => Promise<NewsMigrationPlan>;
  runVerify: (manifest: NewsMigrationManifest) => Promise<VerifyReport>;
  runRollbackDryRun: (
    manifest: NewsMigrationManifest,
    includeEdited: boolean,
  ) => Promise<RollbackReport>;
  runExecute: (
    manifest: NewsMigrationManifest,
  ) => Promise<{ plan: NewsMigrationPlan; result: ExecuteResult }>;
  runRollback: (
    manifest: NewsMigrationManifest,
    includeEdited: boolean,
  ) => Promise<{ report: RollbackReport; deleted: number }>;
  /**
   * Second, INTERACTIVE confirmation for the write class only. Read from a
   * real prompt, never from argv: the `--confirm` flag proves the operator
   * wrote the command deliberately, this proves a person is present when it
   * runs. A pasted script has the first and cannot have the second.
   */
  requestConfirmation: (phrase: string) => Promise<boolean>;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  exit: (code: number) => void;
}

export async function runNewsMigrationProductionCli(
  argv: string[],
  capability: Capability,
  deps: ProductionCliDeps,
): Promise<void> {
  let parsed: ParsedProductionCli;
  try {
    parsed = parseProductionCliArgs(argv, capability);
  } catch (err) {
    deps.stderr(formatSafeError("validation_error", err));
    deps.exit(EXIT_VALIDATION_ERROR);
    return;
  }

  // Context proof BEFORE the manifest is read. A command that cannot prove
  // it is in production should not touch the operator's filesystem either.
  try {
    assertNewsProductionContext({
      getEnv: deps.getEnv,
      expectedCommit: parsed.expectedCommit,
      expectedPlanSchemaVersion: parsed.expectedPlanSchemaVersion,
      actualPlanSchemaVersion: NEWS_MIGRATION_PLAN_SCHEMA_VERSION,
    });
  } catch (err) {
    deps.stderr(formatSafeError("safety_error", err));
    deps.exit(EXIT_SAFETY_ERROR);
    return;
  }

  let manifest: NewsMigrationManifest;
  try {
    const text = await deps.readManifestFile(parsed.manifestPath);
    manifest = parseNewsMigrationManifest(JSON.parse(text));
  } catch (err) {
    deps.stderr(
      formatSafeError(
        "validation_error",
        err instanceof ManifestError || err instanceof SyntaxError
          ? new Error(`manifest rejected: ${err.message}`)
          : new Error("manifest could not be read"),
      ),
    );
    deps.exit(EXIT_VALIDATION_ERROR);
    return;
  }

  deps.stdout(capability === "write" ? WRITE_PRODUCTION_BANNER : READ_ONLY_PRODUCTION_BANNER);

  try {
    switch (parsed.mode) {
      case "dry-run": {
        // Counts come from the REAL planner against whatever rows the
        // connected database holds. There is no expected total anywhere in
        // this path, and no reference to any seed fixture.
        const plan = await deps.runDryRun(manifest);
        emit(deps, parsed.format, plan, () => formatPlan(plan));
        deps.exit(planIsExecutable(plan) ? EXIT_OK : EXIT_BLOCKED);
        return;
      }
      case "verify": {
        const report = await deps.runVerify(manifest);
        emit(deps, parsed.format, report, () => formatVerify(report));
        deps.exit(report.ok ? EXIT_OK : EXIT_VERIFY_FAILED);
        return;
      }
      case "rollback-dry-run": {
        const report = await deps.runRollbackDryRun(manifest, parsed.includeEdited);
        emit(deps, parsed.format, report, () => formatRollback(report, false));
        deps.exit(EXIT_OK);
        return;
      }
      case "execute": {
        // Re-planned first, in its own read-only transaction, so the
        // operator confirms against a printed plan computed from production
        // itself — never against the plan they saw on staging yesterday.
        const preview = await deps.runDryRun(manifest);
        deps.stderr(formatPlan(preview));
        if (!planIsExecutable(preview)) {
          deps.stderr(
            "refusing to execute: the plan has blockers. Every blocker — including an undecided (name, role) byline such as the Victoria Vance case — is a decision only a person can record in the manifest. There is no flag that skips one, in production least of all.",
          );
          deps.exit(EXIT_BLOCKED);
          return;
        }
        if (!(await deps.requestConfirmation(PRODUCTION_EXECUTE_CONFIRMATION_PHRASE))) {
          deps.stderr("aborted: interactive confirmation phrase not given");
          deps.exit(EXIT_SAFETY_ERROR);
          return;
        }
        const { plan, result } = await deps.runExecute(manifest);
        emit(deps, parsed.format, { plan: plan.counts, result }, () => formatExecute(result));
        deps.exit(EXIT_OK);
        return;
      }
      case "rollback": {
        const preview = await deps.runRollbackDryRun(manifest, parsed.includeEdited);
        deps.stderr(formatRollback(preview, true));
        if (preview.deletablePostIds.length === 0) {
          deps.stderr("nothing to roll back.");
          deps.exit(EXIT_OK);
          return;
        }
        if (!(await deps.requestConfirmation(PRODUCTION_ROLLBACK_CONFIRMATION_PHRASE))) {
          deps.stderr("aborted: interactive confirmation phrase not given");
          deps.exit(EXIT_SAFETY_ERROR);
          return;
        }
        const { report, deleted } = await deps.runRollback(manifest, parsed.includeEdited);
        emit(
          deps,
          parsed.format,
          { deleted, counts: report.counts },
          () =>
            `Rolled back ${deleted} migrated Editorial post(s). website_news_posts was not touched.`,
        );
        deps.exit(EXIT_OK);
        return;
      }
    }
  } catch (err) {
    void err;
    deps.stderr(formatSafeError("engine_error", err));
    deps.exit(EXIT_UNKNOWN_ERROR);
  }
}

function emit(
  deps: ProductionCliDeps,
  format: "human" | "json",
  json: unknown,
  human: () => string,
): void {
  deps.stdout(format === "json" ? JSON.stringify(json, null, 2) : human());
}
