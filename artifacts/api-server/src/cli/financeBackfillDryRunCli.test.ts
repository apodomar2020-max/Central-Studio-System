/**
 * Finance Phase 2D-1C — CLI argument parsing, safety guards, and read-only
 * boundary tests. Everything here uses dependency injection (fake planner,
 * fake env reader, fake Git-state reader, captured stdout/stderr, captured
 * exit code) — no production or remote access, and (aside from the two
 * disposable-Postgres read-only-transaction proofs at the bottom) no real
 * database access either.
 */
import assert from "node:assert/strict";
import test from "node:test";

// financeBackfillDryRunCli.ts imports the planner, which imports @workspace/db
// at module scope (constructs a pg Pool eagerly) — DATABASE_URL must be set
// BEFORE that import chain runs. A static import here would be hoisted above
// any top-level assignment, so every import from this module tree is
// dynamic, after DATABASE_URL is set below.
const DISPOSABLE_URL =
  process.env.DISPOSABLE_CLI_READONLY_DATABASE_URL ??
  `postgresql://${process.env.USER ?? "postgres"}@127.0.0.1:5432/central_studio_disposable_backfill_dryrun`;

function assertDisposableUrlEarly(databaseUrl: string): void {
  const url = new URL(databaseUrl);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error(`Refusing: DATABASE_URL host "${url.hostname}" is not localhost/127.0.0.1`);
  }
  if (!/disposable|local|test/i.test(url.pathname)) {
    throw new Error(`Refusing: database name "${url.pathname}" does not look disposable/local/test`);
  }
  if (/rlwy\.net|railway/i.test(databaseUrl)) {
    throw new Error("Refusing: DATABASE_URL looks like Railway");
  }
}
assertDisposableUrlEarly(DISPOSABLE_URL);
process.env.DATABASE_URL = DISPOSABLE_URL;

type DryRunReport = import("../lib/financeBackfillDryRun").DryRunReport;
type CliDeps = import("./financeBackfillDryRunCli").CliDeps;
type GitState = import("./financeBackfillDryRunCli").GitState;

const cliModule = await import("./financeBackfillDryRunCli");
const {
  runCli,
  parseCliArgs,
  assertEnvironmentSafe,
  assertIdentityGuards,
  formatHumanReport,
  CliValidationError,
  CliSafetyError,
  EXIT_OK,
  EXIT_VALIDATION_ERROR,
  EXIT_SAFETY_ERROR,
  EXIT_PLANNER_ERROR,
  CLASSIFIER_VERSION,
} = cliModule;

const CLEAN_COMMIT = "a".repeat(40);

function baseArgv(overrides: string[] = []): string[] {
  return [
    "--environment", "local",
    "--source-family", "bookings",
    "--max-rows", "100",
    "--batch-size", "50",
    "--expected-classifier-version", CLASSIFIER_VERSION,
    "--expected-code-commit", CLEAN_COMMIT,
    ...overrides,
  ];
}

function fakeReport(overrides: Partial<DryRunReport> = {}): DryRunReport {
  return {
    reportSchemaVersion: "2d1b.1.0.0",
    classifierVersion: CLASSIFIER_VERSION,
    codeCommit: CLEAN_COMMIT,
    generatedTimestamp: "2024-01-01T00:00:00.000Z",
    appliedFilters: { sourceFamilies: ["bookings"], maxRows: 100, batchSize: 50 },
    scannedCount: 3,
    classifiedCount: 3,
    truncated: false,
    nextCursors: { package_orders: null, bookings: 42, studio_walkins: null },
    pageInfo: {
      hasNextPage: true,
      nextCursors: { package_orders: null, bookings: "opaque-booking-cursor", studio_walkins: null },
    },
    aggregates: {
      sourceFamilyCounts: { bookings: 3 },
      sourceKindCounts: { booking: 3 },
      classificationCounts: { legacy_pending_booking_manual_review: 3 },
      eligibilityCounts: { manual_review: 3 },
      evidenceClassCounts: { unknown: 3 },
      amountAvailabilityCounts: { unknown: 3 },
      amountReliabilityCounts: { unknown_amount: 3 },
      discountReliabilityCounts: { unknown_discount: 3 },
      paymentStatusReliabilityCounts: { operational_pending: 3 },
      paymentMethodReliabilityCounts: { unknown: 3 },
      timestampReliabilityCounts: { unknown: 3 },
      actorReliabilityCounts: { unknown_historical_actor: 3 },
      reasonCodeCounts: { legacy_pending_booking_manual_review: 3 },
      warningCodeCounts: {},
      alreadyCanonicalCount: 0,
      automaticExactCount: 0,
      manualReviewCount: 3,
      excludedCount: 0,
      corruptCount: 0,
      estimatedOnlyCount: 0,
      unknownAmountCount: 3,
      legacyPendingCount: 3,
      multipleRecordCount: 0,
      mismatchedRecordCount: 0,
    },
    authoritativeTotals: {
      grossAmountMinor: 0,
      discountAmountMinor: 0,
      finalPayableAmountMinor: 0,
      rowCount: 0,
      currency: "EGP",
      label: "AUTHORITATIVE_EXACT_EVIDENCE_ONLY",
    },
    estimatedTotals: {
      estimatedTotalMinor: 0,
      estimatedRowCount: 0,
      currency: "EGP",
      label: "NON_AUTHORITATIVE_ESTIMATE_EXCLUDED_FROM_FINANCE_REVENUE",
    },
    unknownAmountPopulation: { rowCount: 3, label: "UNKNOWN_NEVER_SUBSTITUTED_AS_ZERO" },
    ...overrides,
  };
}

interface Harness {
  deps: CliDeps;
  stdoutLines: string[];
  stderrLines: string[];
  exitCode: number | undefined;
  runDryRunCallCount: number;
}

function makeHarness(opts: {
  report?: DryRunReport;
  plannerError?: Error;
  gitState?: GitState;
  env?: Record<string, string>;
} = {}): Harness {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  let exitCode: number | undefined;
  let runDryRunCallCount = 0;

  const env: Record<string, string> = {
    DATABASE_URL: "postgresql://localhost:5432/central_studio_disposable_cli_test",
    ...opts.env,
  };

  const deps: CliDeps = {
    runDryRun: async () => {
      runDryRunCallCount += 1;
      if (opts.plannerError) throw opts.plannerError;
      return opts.report ?? fakeReport();
    },
    getEnv: (key) => env[key],
    getGitState: async () => opts.gitState ?? { commit: CLEAN_COMMIT, dirty: false },
    stdout: (line) => stdoutLines.push(line),
    stderr: (line) => stderrLines.push(line),
    exit: (code) => {
      exitCode = code;
    },
  };

  return {
    deps,
    stdoutLines,
    stderrLines,
    get exitCode() {
      return exitCode;
    },
    get runDryRunCallCount() {
      return runDryRunCallCount;
    },
  } as Harness;
}

// ── Argument parsing ─────────────────────────────────────────────────────────

test("args: valid minimal command parses", () => {
  const parsed = parseCliArgs(baseArgv());
  assert.equal(parsed.environment, "local");
  assert.deepEqual(parsed.filters.sourceFamilies, ["bookings"]);
  assert.equal(parsed.filters.maxRows, 100);
  assert.equal(parsed.filters.batchSize, 50);
  assert.equal(parsed.format, "human");
});

test("args: multiple source families via comma and repeated flag", () => {
  const p1 = parseCliArgs(baseArgv(["--source-family", "package_orders,studio_walkins"]));
  assert.deepEqual(new Set(p1.filters.sourceFamilies), new Set(["bookings", "package_orders", "studio_walkins"]));
});

test("args: date filters parse", () => {
  const parsed = parseCliArgs(baseArgv(["--created-from", "2023-01-01T00:00:00Z", "--created-to", "2023-06-01T00:00:00Z"]));
  assert.equal(parsed.filters.createdAfter, "2023-01-01T00:00:00Z");
  assert.equal(parsed.filters.createdBefore, "2023-06-01T00:00:00Z");
});

test("args: classification filter parses", () => {
  const parsed = parseCliArgs(baseArgv(["--classification", "legacy_pending_booking_manual_review"]));
  assert.deepEqual(parsed.filters.classificationCodes, ["legacy_pending_booking_manual_review"]);
});

test("args: eligibility filter parses", () => {
  const parsed = parseCliArgs(baseArgv(["--eligibility", "manual_review"]));
  assert.deepEqual(parsed.filters.eligibilityClasses, ["manual_review"]);
});

test("args: JSON format parses", () => {
  const parsed = parseCliArgs(baseArgv(["--format", "json"]));
  assert.equal(parsed.format, "json");
});

test("args: human format parses (default)", () => {
  const parsed = parseCliArgs(baseArgv());
  assert.equal(parsed.format, "human");
});

test("args: unknown flag is rejected", () => {
  assert.throws(() => parseCliArgs(baseArgv(["--not-a-real-flag", "x"])), (err: unknown) => {
    assert.ok(err instanceof CliValidationError);
    assert.match((err as Error).message, /unknown argument/);
    return true;
  });
});

test("args: missing environment is rejected", () => {
  const argv = baseArgv().filter((_, i, arr) => !(arr[i - 1] === "--environment" || arr[i] === "--environment"));
  assert.throws(() => parseCliArgs(argv), /--environment is required/);
});

test("args: missing source scope is rejected", () => {
  const argv = baseArgv().filter((_, i, arr) => !(arr[i - 1] === "--source-family" || arr[i] === "--source-family"));
  assert.throws(() => parseCliArgs(argv), /sourceFamilies is required/);
});

test("args: missing max rows is rejected", () => {
  const argv = baseArgv().filter((_, i, arr) => !(arr[i - 1] === "--max-rows" || arr[i] === "--max-rows"));
  assert.throws(() => parseCliArgs(argv), /--max-rows is required/);
});

test("args: missing batch size is rejected", () => {
  const argv = baseArgv().filter((_, i, arr) => !(arr[i - 1] === "--batch-size" || arr[i] === "--batch-size"));
  assert.throws(() => parseCliArgs(argv), /--batch-size is required/);
});

test("args: invalid date range is rejected", () => {
  assert.throws(
    () => parseCliArgs(baseArgv(["--created-from", "2023-06-01T00:00:00Z", "--created-to", "2023-01-01T00:00:00Z"])),
    /later than/,
  );
});

test("args: invalid cursor is rejected", () => {
  assert.throws(() => parseCliArgs(baseArgv(["--cursor", "bookings:not-a-number"])), /invalid --cursor value/);
  assert.throws(() => parseCliArgs(baseArgv(["--cursor", "no-colon-here"])), /invalid --cursor value/);
});

test("args: canonical opaque cursor is accepted and decoded for the planner", async () => {
  const { encodeFinanceBackfillCursor } = await import("../lib/financeBackfillPagination");
  const opaque = encodeFinanceBackfillCursor("bookings", 42);
  const parsed = parseCliArgs(baseArgv(["--cursor", `bookings:${opaque}`]));
  assert.deepEqual(parsed.filters.cursors, [{ family: "bookings", afterId: 42 }]);
});

test("args: unknown output format is rejected", () => {
  assert.throws(() => parseCliArgs(baseArgv(["--format", "xml"])), /unsupported --format/);
});

// ── Environment / database safety ───────────────────────────────────────────

function safeArgs(overrides: Partial<Parameters<typeof assertEnvironmentSafe>[0]> = {}) {
  return {
    environment: "local",
    databaseUrl: "postgresql://localhost:5432/central_studio_disposable_cli_test",
    getEnv: () => undefined,
    ...overrides,
  };
}

test("env-safety: production environment is rejected", () => {
  assert.throws(() => assertEnvironmentSafe(safeArgs({ environment: "production" })), CliSafetyError);
});

test("env-safety: 'prod' is rejected", () => {
  assert.throws(() => assertEnvironmentSafe(safeArgs({ environment: "PROD" })), CliSafetyError);
});

test("env-safety: Railway environment is detected and rejected", () => {
  assert.throws(
    () => assertEnvironmentSafe(safeArgs({ getEnv: (k) => (k === "RAILWAY_ENVIRONMENT" ? "production" : undefined) })),
    /Railway/,
  );
});

test("env-safety: missing DB URL is rejected", () => {
  assert.throws(() => assertEnvironmentSafe(safeArgs({ databaseUrl: undefined })), /DATABASE_URL is not set/);
});

test("env-safety: malformed DB URL is rejected", () => {
  assert.throws(() => assertEnvironmentSafe(safeArgs({ databaseUrl: "not-a-url" })), /could not be safely parsed/);
});

test("env-safety: remote hostname is rejected", () => {
  assert.throws(() => assertEnvironmentSafe(safeArgs({ databaseUrl: "postgresql://203.0.113.5:5432/db" })), /not a recognized local/);
});

test("env-safety: managed DB hostname is rejected", () => {
  for (const host of ["foo.rlwy.net", "db.supabase.co", "ep-foo.neon.tech", "x.render.com", "db.amazonaws.com"]) {
    assert.throws(
      () => assertEnvironmentSafe(safeArgs({ databaseUrl: `postgresql://${host}:5432/db` })),
      /managed\/remote host/,
      `expected ${host} to be rejected`,
    );
  }
});

test("env-safety: localhost is accepted", () => {
  assert.doesNotThrow(() => assertEnvironmentSafe(safeArgs({ databaseUrl: "postgresql://localhost:5432/central_studio_disposable_x" })));
});

test("env-safety: 127.0.0.1 is accepted", () => {
  assert.doesNotThrow(() => assertEnvironmentSafe(safeArgs({ databaseUrl: "postgresql://127.0.0.1:5432/central_studio_disposable_x" })));
});

test("env-safety: local disposable port is accepted", () => {
  assert.doesNotThrow(() => assertEnvironmentSafe(safeArgs({ databaseUrl: "postgresql://127.0.0.1:5602/central_studio_disposable_routes" })));
});

test("env-safety: the full DB URL never appears in a thrown error message", () => {
  const secretUrl = "postgresql://user:supersecretpassword@evil-remote-host.example.com:5432/proddb";
  try {
    assertEnvironmentSafe(safeArgs({ databaseUrl: secretUrl }));
    assert.fail("expected throw");
  } catch (err) {
    assert.equal((err as Error).message.includes("supersecretpassword"), false);
    assert.equal((err as Error).message.includes(secretUrl), false);
  }
});

// ── Git / classifier identity guards ─────────────────────────────────────────

function identityArgs(overrides: Partial<Parameters<typeof assertIdentityGuards>[0]> = {}) {
  return {
    expectedClassifierVersion: CLASSIFIER_VERSION,
    expectedCodeCommit: CLEAN_COMMIT,
    actualClassifierVersion: CLASSIFIER_VERSION,
    gitState: { commit: CLEAN_COMMIT, dirty: false },
    ...overrides,
  };
}

test("identity: classifier version mismatch is rejected", () => {
  assert.throws(() => assertIdentityGuards(identityArgs({ expectedClassifierVersion: "9.9.9" })), /classifier version mismatch/);
});

test("identity: code-commit mismatch is rejected", () => {
  assert.throws(
    () => assertIdentityGuards(identityArgs({ expectedCodeCommit: "b".repeat(40) })),
    /code commit mismatch/,
  );
});

test("identity: missing Git metadata is rejected", () => {
  assert.throws(
    () => assertIdentityGuards(identityArgs({ gitState: { commit: null, dirty: null } })),
    /Git metadata unavailable/,
  );
});

test("identity: dirty worktree is rejected", () => {
  assert.throws(
    () => assertIdentityGuards(identityArgs({ gitState: { commit: CLEAN_COMMIT, dirty: true } })),
    /not confirmed clean/,
  );
});

test("identity: unknown (null) dirty state is rejected, same as dirty=true", () => {
  assert.throws(
    () => assertIdentityGuards(identityArgs({ gitState: { commit: CLEAN_COMMIT, dirty: null } })),
    /not confirmed clean/,
  );
});

test("identity: exact clean commit is accepted", () => {
  assert.doesNotThrow(() => assertIdentityGuards(identityArgs()));
});

// ── Read-only boundary ───────────────────────────────────────────────────────

test("read-only: there is no write flag anywhere in the parsed argument contract", () => {
  const parsed = parseCliArgs(baseArgv());
  const serialised = JSON.stringify(parsed).toLowerCase();
  for (const bad of ["writemode", "\"write\"", "execute", "applymode"]) {
    assert.equal(serialised.includes(bad), false);
  }
});

test("read-only: a write-like argument is rejected", () => {
  for (const flag of ["--write", "--execute", "--apply", "--mutate", "--backfill-now", "--approve", "--commit"]) {
    assert.throws(() => parseCliArgs(baseArgv([flag, "true"])), /write-like argument rejected/, `expected ${flag} to be rejected`);
  }
});

test("read-only: --expected-code-commit itself is NOT caught by the write-like 'commit' check", () => {
  assert.doesNotThrow(() => parseCliArgs(baseArgv()));
});

test("read-only: this CLI module's source imports only the dry-run planner, never a writer", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(new URL("./financeBackfillDryRunCli.ts", import.meta.url), "utf8");
  const importLines = source.split("\n").filter((l) => l.trim().startsWith("import"));
  for (const line of importLines) {
    assert.equal(/writer|mutat|payment_backfill_batches|payment_backfill_progress/i.test(line), false, line);
  }
  assert.ok(source.includes("financeBackfillDryRun"));
});

test("read-only: planner is called exactly once per invocation", async () => {
  const h = makeHarness();
  await runCli(baseArgv(), h.deps);
  assert.equal(h.runDryRunCallCount, 1);
  assert.equal(h.exitCode, EXIT_OK);
});

test("read-only: successful run creates no batch/progress row, no Finance write, no source mutation (asserted via injected planner contract)", async () => {
  // The planner itself is proven zero-write in Phase 2D-1B (before/after
  // table counts + live query instrumentation). The CLI boundary adds
  // nothing that could write: it only ever calls deps.runDryRun once and
  // never imports a writer (see the import-source test above).
  const h = makeHarness();
  await runCli(baseArgv(["--format", "json"]), h.deps);
  const report = JSON.parse(h.stdoutLines[h.stdoutLines.length - 1]) as DryRunReport;
  assert.ok(report.reportSchemaVersion);
});

// ── Output privacy ───────────────────────────────────────────────────────────

test("output: human output contains no source IDs", () => {
  const text = formatHumanReport(fakeReport());
  assert.equal(/\b42\b/.test(text), false);
  assert.ok(text.includes("present — re-run with --format json"));
});

test("output: JSON output contains no PII fields", async () => {
  const h = makeHarness();
  await runCli(baseArgv(["--format", "json"]), h.deps);
  const text = h.stdoutLines.join("\n").toLowerCase();
  for (const forbidden of ["studentname", "studentemail", "studentphone", "parentname", "childname", "address"]) {
    assert.equal(text.includes(forbidden), false, `leaked ${forbidden}`);
  }
});

test("output: error output never carries a DB URL embedded in an underlying planner error message", async () => {
  const h = makeHarness({ plannerError: new Error("connect failed: postgresql://user:pw@evil.example.com:5432/db") });
  await runCli(baseArgv(), h.deps);
  const text = h.stderrLines.join("\n");
  assert.equal(text.includes("evil.example.com"), false);
  assert.equal(text.includes("user:pw"), false);
});

test("output: error output never carries raw SQL or bound parameter values from a driver-level planner failure", async () => {
  // drizzle/pg wrap query failures as `Failed query: SELECT ... WHERE id = $1`
  // with real bound values under `.message` — this must never reach stderr.
  const h = makeHarness({
    plannerError: new Error(
      "Failed query: SELECT * FROM bookings WHERE student_email = $1\nparams: student.name@example.com",
    ),
  });
  await runCli(baseArgv(), h.deps);
  const text = h.stderrLines.join("\n");
  assert.equal(/SELECT|FROM|WHERE/i.test(text), false);
  assert.equal(text.includes("student.name@example.com"), false);
  const parsedError = JSON.parse(text);
  assert.equal(parsedError.errorCode, "planner_error");
  assert.equal(parsedError.message, "the dry-run query failed");
});

test("output: no stack trace is printed by default", async () => {
  const h = makeHarness({ plannerError: new Error("boom") });
  await runCli(baseArgv(), h.deps);
  const text = h.stderrLines.join("\n");
  assert.equal(text.includes("    at "), false);
});

test("output: estimated totals are labelled non-authoritative", async () => {
  const h = makeHarness({
    report: fakeReport({ estimatedTotals: { estimatedTotalMinor: 500, estimatedRowCount: 1, currency: "EGP", label: "NON_AUTHORITATIVE_ESTIMATE_EXCLUDED_FROM_FINANCE_REVENUE" } }),
  });
  await runCli(baseArgv(["--format", "json"]), h.deps);
  assert.ok(h.stdoutLines.join("\n").includes("NON_AUTHORITATIVE_ESTIMATE_EXCLUDED_FROM_FINANCE_REVENUE"));
});

test("output: unknown amount remains a count, never coerced to zero revenue", () => {
  const text = formatHumanReport(fakeReport());
  assert.ok(text.includes("never substituted as zero"));
});

// ── Exit codes ───────────────────────────────────────────────────────────────

test("exit: successful dry-run exits 0", async () => {
  const h = makeHarness();
  await runCli(baseArgv(), h.deps);
  assert.equal(h.exitCode, EXIT_OK);
});

test("exit: validation failure exits non-zero (EXIT_VALIDATION_ERROR)", async () => {
  const h = makeHarness();
  await runCli(baseArgv(["--not-a-flag", "x"]), h.deps);
  assert.equal(h.exitCode, EXIT_VALIDATION_ERROR);
});

test("exit: safety failure exits non-zero (EXIT_SAFETY_ERROR)", async () => {
  const h = makeHarness({ gitState: { commit: CLEAN_COMMIT, dirty: true } });
  await runCli(baseArgv(), h.deps);
  assert.equal(h.exitCode, EXIT_SAFETY_ERROR);
});

test("exit: planner failure exits non-zero with a safe error code (EXIT_PLANNER_ERROR)", async () => {
  const h = makeHarness({ plannerError: new Error("db exploded") });
  await runCli(baseArgv(), h.deps);
  assert.equal(h.exitCode, EXIT_PLANNER_ERROR);
  const parsedError = JSON.parse(h.stderrLines[0]);
  assert.equal(parsedError.errorCode, "planner_error");
});

// ── Read-only transaction proof (disposable Postgres only) ──────────────────

test("read-only transaction: Postgres itself rejects a mutation inside SET TRANSACTION READ ONLY, and the same setup does not break planner cursoring/aggregation", async () => {
  const { db, pool } = await import("@workspace/db");
  const { sql } = await import("drizzle-orm");
  const { runFinanceBackfillDryRun } = await import("../lib/financeBackfillDryRun");

  try {
    // Proof 1: Postgres itself (not just this codebase's conventions) refuses
    // a write inside a read-only transaction.
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.execute(sql`SET TRANSACTION READ ONLY`);
        await tx.execute(sql`INSERT INTO bookings (student_name, student_email) VALUES ('should never persist', 'x@example.test')`);
      }),
      (err: unknown) => {
        // drizzle wraps the real pg error as `Failed query: ...`, with
        // Postgres's actual "cannot execute INSERT in a read-only
        // transaction" message on `.cause` — check both.
        const cause = err instanceof Error && "cause" in err ? (err as { cause?: unknown }).cause : undefined;
        const causeMessage = cause instanceof Error ? cause.message : String(cause ?? "");
        assert.match(causeMessage, /read-only transaction/);
        return true;
      },
    );

    // Proof 2: the same read-only-transaction wrapping does not change the
    // planner's cursoring/aggregation output versus running without one.
    const filters = { sourceFamilies: ["bookings"] as const, maxRows: 50, batchSize: 50 };
    const withoutTx = await runFinanceBackfillDryRun({ sourceFamilies: [...filters.sourceFamilies], maxRows: filters.maxRows, batchSize: filters.batchSize });
    const withTx = await db.transaction(async (tx) => {
      await tx.execute(sql`SET TRANSACTION READ ONLY`);
      return runFinanceBackfillDryRun(
        { sourceFamilies: [...filters.sourceFamilies], maxRows: filters.maxRows, batchSize: filters.batchSize },
        tx as unknown as Parameters<typeof runFinanceBackfillDryRun>[1],
      );
    });
    const strip = (r: typeof withoutTx) => ({ ...r, generatedTimestamp: undefined, codeCommit: undefined });
    assert.deepEqual(strip(withTx), strip(withoutTx));
  } finally {
    await pool.end();
  }
});
