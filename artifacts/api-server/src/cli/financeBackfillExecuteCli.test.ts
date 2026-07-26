/**
 * Finance Phase 2D-3 — execution CLI safety tests. Fully dependency-injected
 * — no real database, no production/remote access.
 */
import assert from "node:assert/strict";
import test from "node:test";

// financeBackfillExecuteCli.ts transitively imports @workspace/db (via
// financeBackfillDryRunCli.ts -> financeBackfillDryRun.ts), which
// constructs a pg Pool eagerly — DATABASE_URL must be set BEFORE that
// import chain runs. A static import would be hoisted above any top-level
// assignment, so this module tree is dynamically imported instead.
process.env.DATABASE_URL ??= "postgresql://localhost:5432/central_studio_disposable_x";

type ExecuteCliDeps = import("./financeBackfillExecuteCli").ExecuteCliDeps;

const cliModule = await import("./financeBackfillExecuteCli");
const {
  runExecuteCli,
  parseExecuteCliArgs,
  EXECUTION_DISABLED_BY_DEFAULT_FLAG,
  EXIT_OK,
  EXIT_VALIDATION_ERROR,
  EXIT_SAFETY_ERROR,
  EXIT_NOT_AUTHORIZED,
} = cliModule;
const { CliValidationError } = await import("./financeBackfillDryRunCli");

const CLEAN_COMMIT = "a".repeat(40);
const REAL_CLASSIFIER_VERSION = "2d1.0.0";
const FINGERPRINT = "fingerprint-abc";

function baseArgv(overrides: string[] = []): string[] {
  return [
    EXECUTION_DISABLED_BY_DEFAULT_FLAG,
    "--environment", "local",
    "--approved-batch-id", "11111111-1111-1111-1111-111111111111",
    "--expected-classifier-version", REAL_CLASSIFIER_VERSION,
    "--expected-code-commit", CLEAN_COMMIT,
    "--expected-evidence-fingerprint", FINGERPRINT,
    "--max-rows", "5",
    "--chunk-size", "5",
    "--confirm", "EXECUTE HISTORICAL BACKFILL",
    "--operator", "test-operator",
    ...overrides,
  ];
}

interface Harness {
  deps: ExecuteCliDeps;
  stdoutLines: string[];
  stderrLines: string[];
  exitCode: number | undefined;
  runChunkCallCount: number;
}

function makeHarness(opts: {
  overlapping?: boolean;
  dryRunExactCount?: number;
  approvedExpectedCount?: number | null;
  secondConfirmation?: boolean;
  gitDirty?: boolean | null;
  gitCommit?: string | null;
} = {}): Harness {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  let exitCode: number | undefined;
  let runChunkCallCount = 0;

  const deps: ExecuteCliDeps = {
    getEnv: (key) => (key === "DATABASE_URL" ? "postgresql://localhost:5432/central_studio_disposable_x" : undefined),
    getGitState: async () => ({
      commit: "gitCommit" in opts ? (opts.gitCommit as string | null) : CLEAN_COMMIT,
      dirty: opts.gitDirty ?? false,
    }),
    hasOverlappingActiveBatch: async () => opts.overlapping ?? false,
    runDryRunForBatch: async () =>
      ({
        aggregates: { automaticExactCount: opts.dryRunExactCount ?? 1 },
      }) as never,
    getApprovedExpectedEligibleCount: async () => (opts.approvedExpectedCount === undefined ? 1 : opts.approvedExpectedCount),
    requestSecondConfirmation: async () => opts.secondConfirmation ?? true,
    runChunk: async () => {
      runChunkCallCount += 1;
      return { attempted: 0, written: 0, alreadyCanonical: 0, notEligible: 0, duplicates: 0, stoppedEarly: null, outcomes: [] };
    },
    stdout: (l) => stdoutLines.push(l),
    stderr: (l) => stderrLines.push(l),
    exit: (c) => {
      exitCode = c;
    },
  };

  return {
    deps,
    stdoutLines,
    stderrLines,
    get exitCode() {
      return exitCode;
    },
    get runChunkCallCount() {
      return runChunkCallCount;
    },
  } as Harness;
}

// ── Disabled-by-default ──────────────────────────────────────────────────────

test("disabled by default: omitting the authorization flag is rejected before any other check", () => {
  const argv = baseArgv().filter((a) => a !== EXECUTION_DISABLED_BY_DEFAULT_FLAG);
  assert.throws(() => parseExecuteCliArgs(argv), (err: unknown) => {
    assert.ok(err instanceof CliValidationError);
    assert.match((err as Error).message, /execution is disabled by default/);
    return true;
  });
});

test("exit: running without the authorization flag exits EXIT_NOT_AUTHORIZED", async () => {
  const h = makeHarness();
  const argv = baseArgv().filter((a) => a !== EXECUTION_DISABLED_BY_DEFAULT_FLAG);
  await runExecuteCli(argv, h.deps);
  assert.equal(h.exitCode, EXIT_NOT_AUTHORIZED);
  assert.equal(h.runChunkCallCount, 0);
});

// ── Confirmation phrase ──────────────────────────────────────────────────────

test("an incorrect confirmation phrase is rejected", () => {
  assert.throws(() => parseExecuteCliArgs(baseArgv(["--confirm", "yes please"])), /exact phrase/);
});

test("second confirmation must also be granted separately", async () => {
  const h = makeHarness({ secondConfirmation: false });
  await runExecuteCli(baseArgv(), h.deps);
  assert.equal(h.exitCode, EXIT_SAFETY_ERROR);
  assert.equal(h.runChunkCallCount, 0);
});

// ── Bounded execution ─────────────────────────────────────────────────────────

test("max-rows is bounded (500)", () => {
  assert.doesNotThrow(() => parseExecuteCliArgs(baseArgv(["--max-rows", "500"])));
  assert.throws(() => parseExecuteCliArgs(baseArgv(["--max-rows", "501"])), /exceeds the maximum/);
});

test("chunk-size is bounded (50)", () => {
  assert.doesNotThrow(() => parseExecuteCliArgs(baseArgv(["--chunk-size", "50"])));
  assert.throws(() => parseExecuteCliArgs(baseArgv(["--chunk-size", "51"])), /exceeds the maximum/);
});

// ── Identity/approval guards ─────────────────────────────────────────────────

test("no overlapping active batch: an overlapping batch blocks execution", async () => {
  const h = makeHarness({ overlapping: true });
  await runExecuteCli(baseArgv(), h.deps);
  assert.equal(h.exitCode, EXIT_SAFETY_ERROR);
  assert.equal(h.runChunkCallCount, 0);
});

test("dry-run count equality: mismatch between approved and current dry-run count blocks execution", async () => {
  const h = makeHarness({ approvedExpectedCount: 3, dryRunExactCount: 1 });
  await runExecuteCli(baseArgv(), h.deps);
  assert.equal(h.exitCode, EXIT_SAFETY_ERROR);
  const parsed = JSON.parse(h.stderrLines[0]);
  assert.match(parsed.message, /dry-run count mismatch/);
});

test("dry-run count equality: matching counts pass this guard", async () => {
  const h = makeHarness({ approvedExpectedCount: 2, dryRunExactCount: 2 });
  await runExecuteCli(baseArgv(), h.deps);
  assert.equal(h.exitCode, EXIT_OK);
});

test("a batch with no recorded approved expected count is blocked", async () => {
  const h = makeHarness({ approvedExpectedCount: null });
  await runExecuteCli(baseArgv(), h.deps);
  assert.equal(h.exitCode, EXIT_SAFETY_ERROR);
});

test("dirty git worktree blocks execution", async () => {
  const h = makeHarness({ gitDirty: true });
  await runExecuteCli(baseArgv(), h.deps);
  assert.equal(h.exitCode, EXIT_SAFETY_ERROR);
});

test("missing git metadata blocks execution", async () => {
  const h = makeHarness({ gitCommit: null });
  await runExecuteCli(baseArgv(), h.deps);
  assert.equal(h.exitCode, EXIT_SAFETY_ERROR);
});

test("stale expected code commit is rejected", async () => {
  const h = makeHarness();
  const res = await runExecuteCli(baseArgv(["--expected-code-commit", "b".repeat(40)]), h.deps);
  assert.equal(h.exitCode, EXIT_SAFETY_ERROR);
});

// ── Production/remote-DB guards (reused from the dry-run CLI, unweakened) ───

test("production environment is rejected (same guard as the dry-run CLI, unweakened)", async () => {
  const h = makeHarness();
  await runExecuteCli(baseArgv(["--environment", "production"]), h.deps);
  assert.equal(h.exitCode, EXIT_SAFETY_ERROR);
  assert.equal(h.runChunkCallCount, 0);
});

test("remote/managed DB is rejected via the reused environment guard", async () => {
  const h = makeHarness();
  h.deps.getEnv = (key) => (key === "DATABASE_URL" ? "postgresql://db.example-managed.rlwy.net:5432/x" : undefined);
  await runExecuteCli(baseArgv(), h.deps);
  assert.equal(h.exitCode, EXIT_SAFETY_ERROR);
});

// ── Unknown / unsafe flags ────────────────────────────────────────────────────

test("unknown flags are rejected", () => {
  assert.throws(() => parseExecuteCliArgs(baseArgv(["--not-a-real-flag", "x"])), /unknown argument/);
});

test("unattended/skip-confirmation style flags are explicitly rejected", () => {
  for (const flag of ["--force", "--skip-confirmation", "--auto", "--unattended"]) {
    assert.throws(() => parseExecuteCliArgs(baseArgv([flag])), /unsafe unattended-execution flag rejected/);
  }
});

// ── Success path + output redaction ──────────────────────────────────────────

test("success path calls runChunk exactly once and exits 0", async () => {
  const h = makeHarness();
  await runExecuteCli(baseArgv(), h.deps);
  assert.equal(h.exitCode, EXIT_OK);
  assert.equal(h.runChunkCallCount, 1);
});

test("output never contains a raw DB URL", async () => {
  const h = makeHarness();
  h.deps.runChunk = async () => {
    throw new Error("connect failed: postgresql://user:pw@internal-host:5432/proddb");
  };
  await runExecuteCli(baseArgv(), h.deps);
  const text = h.stderrLines.join("\n");
  assert.equal(text.includes("internal-host"), false);
  assert.equal(text.includes("user:pw"), false);
});

test("output never contains a stack trace by default", async () => {
  const h = makeHarness();
  h.deps.runChunk = async () => {
    throw new Error("boom");
  };
  await runExecuteCli(baseArgv(), h.deps);
  const text = h.stderrLines.join("\n");
  assert.equal(text.includes("    at "), false);
});
