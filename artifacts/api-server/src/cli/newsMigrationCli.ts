/**
 * News → Editorial migration CLI — Final Editorial, Phase B.
 *
 * The fully dependency-injected, testable core: argument parsing, safety
 * guards, mode dispatch and output formatting. It performs NO real I/O —
 * the `db` / `pool` / `git` / `process` / filesystem wiring lives in
 * `newsMigrationCli.entry.ts`, which is what the package.json scripts run.
 *
 * ─── FIVE MODES, ONE TOOL ────────────────────────────────────────────────
 *
 *   dry-run           READ-ONLY. Plans the whole migration and prints every
 *                     blocker, every note and the cross-type preservation
 *                     manifest. Writes nothing, ever.
 *   execute           The only writing forward mode. Re-plans first and
 *                     REFUSES if the plan has a single blocker.
 *   verify            READ-ONLY. Checks the live database against the same
 *                     plan, plus the invariants only this migration could
 *                     break.
 *   rollback-dry-run  READ-ONLY. Lists exactly what a rollback would
 *                     delete, and which posts it would refuse to delete
 *                     because an editor has changed them.
 *   rollback          Deletes posts carrying this tool's provenance, and
 *                     nothing else.
 *
 * One tool rather than five, because all five must share one plan, one
 * mapping and one manifest. Five separately-evolving commands would drift
 * apart, and a dry-run that does not compute exactly what execute writes
 * is worse than no dry-run at all.
 *
 * ─── WHY BOTH WRITING MODES SHIP LOCAL-ONLY ──────────────────────────────
 *
 * `assertEnvironmentSafe` is REUSED from the finance backfill CLI, not
 * reimplemented: it refuses a declared production environment, a detected
 * Railway context, and any DATABASE_URL that is not a local/disposable
 * host. As released, `execute` and `rollback` therefore cannot reach
 * production at all. That is deliberate and matches this phase's locked
 * policy — a production run is a separately-authorized follow-up change,
 * never something this file does on its own.
 *
 * ─── CONFIRMATION IS NOT A FLAG ──────────────────────────────────────────
 *
 * Both writing modes require a typed confirmation phrase supplied through
 * an injected prompt, not through argv. A flag can be pasted into a script
 * once and then re-run forever by something that has forgotten what it
 * does; a prompt cannot.
 */
import {
  assertEnvironmentSafe,
  CliSafetyError,
  CliValidationError,
  type GitState,
} from "./financeBackfillDryRunCli";
import {
  parseNewsMigrationManifest,
  ManifestError,
  type NewsMigrationManifest,
} from "../lib/newsMigrationManifest";
import type { NewsMigrationPlan } from "../lib/newsMigrationPlanner";
import { planIsExecutable } from "../lib/newsMigrationPlanner";
import type { ExecuteResult } from "../lib/newsMigrationWriter";
import type { RollbackReport } from "../lib/newsMigrationRollback";
import type { VerifyReport } from "../lib/newsMigrationVerify";

export const EXIT_OK = 0;
export const EXIT_UNKNOWN_ERROR = 1;
export const EXIT_VALIDATION_ERROR = 2;
export const EXIT_SAFETY_ERROR = 3;
export const EXIT_BLOCKED = 4;
export const EXIT_VERIFY_FAILED = 5;

export const EXECUTE_CONFIRMATION_PHRASE = "MIGRATE NEWS TO EDITORIAL";
export const ROLLBACK_CONFIRMATION_PHRASE = "ROLL BACK NEWS MIGRATION";

export const MODES = [
  "dry-run",
  "execute",
  "verify",
  "rollback-dry-run",
  "rollback",
] as const;
export type Mode = (typeof MODES)[number];

/** Modes that may write. Everything else runs in a READ ONLY transaction. */
export const WRITING_MODES: ReadonlySet<Mode> = new Set<Mode>(["execute", "rollback"]);

const SINGLE_VALUE_FLAGS = new Set(["mode", "manifest", "environment", "format", "expected-code-commit"]);
const BOOLEAN_FLAGS = new Set(["include-edited"]);
const KNOWN_FLAGS = new Set([...SINGLE_VALUE_FLAGS, ...BOOLEAN_FLAGS]);

/**
 * Flag NAMES that imply "write anyway". Rejected by name before anything
 * else is parsed, so a scripted attempt to weaken a guard fails loudly at
 * the argument contract instead of quietly somewhere deeper.
 */
const FORBIDDEN_FLAG_NAMES = new Set([
  "force",
  "force-production",
  "allow-production",
  "skip-guards",
  "no-guards",
  "ignore-blockers",
  "skip-blockers",
  "yes",
  "confirm",
  "confirmation",
  "auto-approve",
]);

export interface ParsedCli {
  mode: Mode;
  manifestPath: string;
  environment: string;
  format: "human" | "json";
  expectedCodeCommit: string | null;
  includeEdited: boolean;
}

export function parseNewsMigrationCliArgs(argv: string[]): ParsedCli {
  const raw = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--") continue;
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
          `guard-weakening argument rejected: --${flag}. Blockers are decisions a person has to make in the manifest; there is no flag that skips one.`,
        );
      }
      throw new CliValidationError(`unknown argument: --${flag}`);
    }
    const list = raw.get(flag) ?? [];
    list.push(value);
    raw.set(flag, list);
  }

  const last = (name: string): string | undefined => {
    const values = raw.get(name);
    return values && values.length > 0 ? values[values.length - 1] : undefined;
  };

  const modeRaw = last("mode");
  if (!modeRaw) throw new CliValidationError("--mode is required");
  if (!(MODES as readonly string[]).includes(modeRaw)) {
    throw new CliValidationError(`unsupported --mode: "${modeRaw}" (expected ${MODES.join("|")})`);
  }
  const mode = modeRaw as Mode;

  const manifestPath = last("manifest");
  if (!manifestPath) {
    throw new CliValidationError(
      "--manifest is required in every mode. Even a read-only mode needs it: the manifest defines the scope, the language and the decisions the plan is computed from.",
    );
  }

  const environment = last("environment");
  if (!environment) throw new CliValidationError("--environment is required");

  const formatRaw = last("format") ?? "human";
  if (formatRaw !== "human" && formatRaw !== "json") {
    throw new CliValidationError(`unsupported --format: "${formatRaw}" (expected human|json)`);
  }

  const includeEdited = raw.has("include-edited");
  if (includeEdited && mode !== "rollback" && mode !== "rollback-dry-run") {
    throw new CliValidationError("--include-edited only applies to the rollback modes");
  }

  return {
    mode,
    manifestPath,
    environment,
    format: formatRaw,
    expectedCodeCommit: last("expected-code-commit") ?? null,
    includeEdited,
  };
}

/**
 * Identity guard for the WRITING modes.
 *
 * A write against a dirty or unknown worktree cannot be reproduced or
 * reviewed afterwards — "which version of the mapping produced this data?"
 * would have no answer. Read-only modes are exempt: they change nothing,
 * so there is nothing to reproduce.
 */
export function assertWriteIdentityGuards(opts: {
  expectedCodeCommit: string | null;
  gitState: GitState;
}): void {
  if (!opts.expectedCodeCommit) {
    throw new CliSafetyError(
      "refusing to run: --expected-code-commit is required for a writing mode, so the data this run produces can be traced to the exact mapping that produced it",
    );
  }
  if (opts.gitState.commit == null) {
    throw new CliSafetyError("refusing to run: Git metadata unavailable");
  }
  if (opts.gitState.dirty !== false) {
    throw new CliSafetyError(
      "refusing to run: worktree is not confirmed clean — a content migration cannot claim reproducibility against a dirty worktree",
    );
  }
  if (opts.gitState.commit !== opts.expectedCodeCommit) {
    throw new CliSafetyError("refusing to run: code commit mismatch");
  }
}

export interface CliDeps {
  readManifestFile: (path: string) => Promise<string>;
  runDryRun: (manifest: NewsMigrationManifest) => Promise<NewsMigrationPlan>;
  runExecute: (manifest: NewsMigrationManifest) => Promise<{ plan: NewsMigrationPlan; result: ExecuteResult }>;
  runVerify: (manifest: NewsMigrationManifest) => Promise<VerifyReport>;
  runRollbackDryRun: (
    manifest: NewsMigrationManifest,
    includeEdited: boolean,
  ) => Promise<RollbackReport>;
  runRollback: (
    manifest: NewsMigrationManifest,
    includeEdited: boolean,
  ) => Promise<{ report: RollbackReport; deleted: number }>;
  getEnv: (key: string) => string | undefined;
  getGitState: () => Promise<GitState>;
  /** Reads the confirmation phrase from a real prompt, never from argv. */
  requestConfirmation: (phrase: string) => Promise<boolean>;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  exit: (code: number) => void;
}

export async function runNewsMigrationCli(argv: string[], deps: CliDeps): Promise<void> {
  let parsed: ParsedCli;
  try {
    parsed = parseNewsMigrationCliArgs(argv);
  } catch (err) {
    deps.stderr(String(err instanceof Error ? err.message : err));
    deps.exit(EXIT_VALIDATION_ERROR);
    return;
  }

  let manifest: NewsMigrationManifest;
  try {
    const text = await deps.readManifestFile(parsed.manifestPath);
    manifest = parseNewsMigrationManifest(JSON.parse(text));
  } catch (err) {
    deps.stderr(
      err instanceof ManifestError || err instanceof SyntaxError
        ? `manifest rejected: ${err.message}`
        : `manifest could not be read: ${err instanceof Error ? err.message : String(err)}`,
    );
    deps.exit(EXIT_VALIDATION_ERROR);
    return;
  }

  const writing = WRITING_MODES.has(parsed.mode);
  try {
    // The environment guard runs for EVERY mode, not only the writing
    // ones. A read-only mode against production would still open a
    // connection to it, and this tool has no business doing that as
    // shipped.
    assertEnvironmentSafe({
      environment: parsed.environment,
      databaseUrl: deps.getEnv("DATABASE_URL"),
      getEnv: deps.getEnv,
    });
    if (writing) {
      assertWriteIdentityGuards({
        expectedCodeCommit: parsed.expectedCodeCommit,
        gitState: await deps.getGitState(),
      });
    }
  } catch (err) {
    deps.stderr(String(err instanceof Error ? err.message : err));
    deps.exit(EXIT_SAFETY_ERROR);
    return;
  }

  try {
    switch (parsed.mode) {
      case "dry-run": {
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
        // Planned BEFORE the prompt, so the operator confirms against a
        // printed plan rather than against a command they typed.
        const preview = await deps.runDryRun(manifest);
        deps.stderr(formatPlan(preview));
        if (!planIsExecutable(preview)) {
          deps.stderr("refusing to execute: the plan has blockers. Every blocker is a decision only a person can make; there is no flag that skips one.");
          deps.exit(EXIT_BLOCKED);
          return;
        }
        if (!(await deps.requestConfirmation(EXECUTE_CONFIRMATION_PHRASE))) {
          deps.stderr("aborted: confirmation phrase not given");
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
        if (!(await deps.requestConfirmation(ROLLBACK_CONFIRMATION_PHRASE))) {
          deps.stderr("aborted: confirmation phrase not given");
          deps.exit(EXIT_SAFETY_ERROR);
          return;
        }
        const { report, deleted } = await deps.runRollback(manifest, parsed.includeEdited);
        emit(deps, parsed.format, { deleted, counts: report.counts }, () =>
          `Rolled back ${deleted} migrated Editorial post(s). website_news_posts was not touched.`,
        );
        deps.exit(EXIT_OK);
        return;
      }
    }
  } catch (err) {
    deps.stderr(err instanceof Error ? err.message : String(err));
    deps.exit(EXIT_UNKNOWN_ERROR);
  }
}

function emit(deps: CliDeps, format: "human" | "json", json: unknown, human: () => string): void {
  deps.stdout(format === "json" ? JSON.stringify(json, null, 2) : human());
}

// ── Formatting ───────────────────────────────────────────────────────────────

export function formatPlan(plan: NewsMigrationPlan): string {
  const lines: string[] = [];
  lines.push("=== News → Editorial migration PLAN ===");
  lines.push(`source table:   ${plan.sourceTable} (READ ONLY — never modified, in any mode)`);
  lines.push(`target channel: ${plan.targetChannel}`);
  lines.push(`language:       ${plan.languageCode}`);
  lines.push(
    `counts:         ${plan.counts.total} row(s) — ${plan.counts.create} to create, ${plan.counts.skip} already migrated, ${plan.counts.blocked} blocked`,
  );

  if (plan.manifestBlockers.length > 0) {
    lines.push("");
    lines.push("MANIFEST BLOCKERS (these stop the whole run):");
    for (const blocker of plan.manifestBlockers) {
      lines.push(`  [${blocker.code}] ${blocker.message}`);
      lines.push(`      → ${blocker.remedy}`);
    }
  }

  const blocked = plan.entries.filter((entry) => entry.action === "blocked");
  if (blocked.length > 0) {
    lines.push("");
    lines.push("BLOCKED ROWS:");
    for (const entry of blocked) {
      lines.push(`  "${entry.sourceSlug}" (#${entry.sourceId}) — ${entry.title}`);
      for (const blocker of entry.action === "blocked" ? entry.blockers : []) {
        lines.push(`      [${blocker.code}] ${blocker.message}`);
        lines.push(`      → ${blocker.remedy}`);
      }
    }
  }

  const notes = plan.entries.flatMap((entry) => (entry.action === "create" ? entry.notes : []));
  if (notes.length > 0) {
    lines.push("");
    lines.push("CONTENT REVIEW — legacy values with no Editorial home, recorded rather than dropped:");
    for (const note of notes) lines.push(`  [${note.code}] ${note.message}`);
  }

  lines.push("");
  lines.push("CROSS-TYPE PRESERVATION MANIFEST — News → Performance references.");
  lines.push("  These are NEVER written into Editorial recommendations: Performance has no");
  lines.push("  Editorial representation, is untouched by Phase B, and a relation into it");
  lines.push("  would put a cross-channel edge into a table whose contract is that it has none.");
  if (plan.crossTypePreservation.length === 0) {
    lines.push("  (none)");
  } else {
    for (const ref of plan.crossTypePreservation) {
      lines.push(`  ${ref.sourceSlug} → performance:${ref.targetSlug} (position ${ref.position})`);
    }
  }

  if (plan.unresolvedNewsRecommendations.length > 0) {
    lines.push("");
    lines.push("DROPPED RECOMMENDATIONS — news→news references whose target is not in scope:");
    for (const ref of plan.unresolvedNewsRecommendations) {
      lines.push(`  ${ref.sourceSlug} → news:${ref.targetSlug} (no such legacy row; dropped, never redirected)`);
    }
  }

  return lines.join("\n");
}

export function formatExecute(result: ExecuteResult): string {
  const lines: string[] = [];
  lines.push("=== News → Editorial migration EXECUTED ===");
  lines.push(`created:  ${result.created.length} post(s)`);
  for (const outcome of result.created) {
    lines.push(`  "${outcome.sourceSlug}" → editorial post #${outcome.editorialPostId} (${outcome.status})`);
  }
  lines.push(`skipped:  ${result.skipped.length} already-migrated post(s)`);
  lines.push(`relations: ${result.recommendationsWritten.length} post(s) given recommendations`);
  lines.push(
    result.placement
      ? `placement: "${result.placement.key}" now holds ${result.placement.postIds.length} post(s)`
      : "placement: none declared",
  );
  lines.push(
    `cross-type refs preserved (NOT written as recommendations): ${result.crossTypePreserved.length}`,
  );
  lines.push("website_news_posts was not read for writes and not modified.");
  return lines.join("\n");
}

export function formatVerify(report: VerifyReport): string {
  const lines: string[] = [];
  lines.push(`=== News → Editorial migration VERIFY — ${report.ok ? "PASS" : "FAIL"} ===`);
  lines.push(
    `checked: ${report.checked.sourceRows} source row(s), ${report.checked.migratedPosts} migrated post(s), ${report.checked.relations} relation(s)`,
  );
  if (report.findings.length === 0) {
    lines.push("no findings.");
  } else {
    lines.push("FINDINGS:");
    for (const finding of report.findings) lines.push(`  [${finding.code}] ${finding.message}`);
  }
  lines.push("");
  lines.push(`cross-type references preserved outside Editorial: ${report.crossTypePreservation.length}`);
  for (const ref of report.crossTypePreservation) {
    lines.push(`  ${ref.sourceSlug} → performance:${ref.targetSlug} (position ${ref.position})`);
  }
  return lines.join("\n");
}

export function formatRollback(report: RollbackReport, imminent: boolean): string {
  const lines: string[] = [];
  lines.push(`=== News → Editorial migration ROLLBACK ${imminent ? "— ABOUT TO RUN" : "DRY-RUN"} ===`);
  lines.push(
    `${report.counts.total} migrated post(s); ${report.counts.edited} edited since migration; ${report.counts.deletable} would be deleted.`,
  );
  lines.push(
    report.includeEdited
      ? "--include-edited is SET: posts edited since migration WILL be deleted, destroying that editing work."
      : "posts edited since migration are PROTECTED and will not be deleted.",
  );
  lines.push(`recommendations from surviving posts that would vanish with the cascade: ${report.incomingRelationsLost}`);
  for (const candidate of report.candidates) {
    const mark = report.deletablePostIds.includes(candidate.editorialPostId) ? "DELETE" : "KEEP  ";
    lines.push(`  ${mark} post #${candidate.editorialPostId} "${candidate.slug ?? "(no slug)"}" (${candidate.status ?? "?"})`);
    for (const reason of candidate.editedReasons) lines.push(`         edited: ${reason}`);
  }
  lines.push("");
  lines.push("NOT undone by a rollback: admin_activity_logs entries, editorial authors and");
  lines.push("topics (the migration never created any), and website_news_posts (never touched).");
  return lines.join("\n");
}
