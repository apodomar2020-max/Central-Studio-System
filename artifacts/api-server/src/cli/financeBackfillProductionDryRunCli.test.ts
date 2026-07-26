/**
 * Finance Phase 2D-4 — production read-only dry-run CLI tests.
 *
 * Split into two groups, matching the convention established for the other
 * Finance backfill CLIs:
 *  - Pure/dependency-injected tests (argument parsing, positive production-
 *    context proof, exit codes, output privacy): no real database.
 *  - Disposable-Postgres integration tests (read-only-transaction proof,
 *    zero-write proof, planner-called-once): a local disposable database
 *    standing in for "production" purely as a Postgres instance to prove
 *    DB-level READ ONLY enforcement against — never a real remote/production
 *    target. No production or remote access occurs anywhere in this file.
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";

const DISPOSABLE_URL =
  process.env.DISPOSABLE_PRODUCTION_DRYRUN_DATABASE_URL ??
  `postgresql://${process.env.USER ?? "postgres"}@127.0.0.1:5432/central_studio_disposable_backfill_dryrun`;

function assertDisposableUrl(databaseUrl: string): void {
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
assertDisposableUrl(DISPOSABLE_URL);
process.env.DATABASE_URL = DISPOSABLE_URL;

type DryRunReport = import("../lib/financeBackfillDryRun").DryRunReport;
type DryRunFilters = import("../lib/financeBackfillDryRun").DryRunFilters;

const cliModule = await import("./financeBackfillProductionDryRunCli");
const {
  runProductionDryRunCli,
  parseProductionDryRunArgs,
  assertProductionContext,
  REQUIRED_AUTH_FLAG,
  EXPECTED_RAILWAY_PROJECT_ID,
  EXIT_OK,
  EXIT_VALIDATION_ERROR,
  EXIT_SAFETY_ERROR,
  EXIT_PLANNER_ERROR,
  CLASSIFIER_VERSION,
} = cliModule;
const { CliValidationError, CliSafetyError } = await import("./financeBackfillDryRunCli");

const CLEAN_COMMIT = "a".repeat(40);

function baseArgv(overrides: string[] = []): string[] {
  return [
    REQUIRED_AUTH_FLAG,
    "--environment", "production",
    "--confirm", "PRODUCTION READ-ONLY DRY-RUN",
    "--expected-classifier-version", CLASSIFIER_VERSION,
    "--expected-commit", CLEAN_COMMIT,
    "--source-family", "bookings",
    "--max-rows", "100",
    "--batch-size", "50",
    "--format", "json",
    ...overrides,
  ];
}

function realRailwayEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    RAILWAY_ENVIRONMENT_NAME: "production",
    RAILWAY_PROJECT_ID: EXPECTED_RAILWAY_PROJECT_ID,
    RAILWAY_SERVICE_ID: "979b146f-b2db-4d9e-bcb9-00cbc47a23a3",
    DATABASE_URL: "postgresql://postgres.railway.internal:5432/railway",
    RAILWAY_GIT_COMMIT_SHA: CLEAN_COMMIT,
    ...overrides,
  };
}

function fakeReport(overrides: Partial<DryRunReport> = {}): DryRunReport {
  return {
    reportSchemaVersion: "2d1b.1.0.0",
    classifierVersion: CLASSIFIER_VERSION,
    codeCommit: CLEAN_COMMIT,
    generatedTimestamp: new Date(0).toISOString(),
    appliedFilters: { sourceFamilies: ["bookings"], maxRows: 100, batchSize: 50 },
    scannedCount: 11,
    classifiedCount: 11,
    truncated: false,
    nextCursors: { bookings: 42 },
    aggregates: {
      sourceFamilyCounts: { bookings: 11 },
      sourceKindCounts: { booking: 11 },
      classificationCounts: { legacy_pending_booking_manual_review: 11 },
      eligibilityCounts: { manual_review: 11 },
      evidenceClassCounts: {},
      amountAvailabilityCounts: {},
      amountReliabilityCounts: {},
      discountReliabilityCounts: {},
      paymentStatusReliabilityCounts: {},
      paymentMethodReliabilityCounts: {},
      timestampReliabilityCounts: {},
      actorReliabilityCounts: {},
      reasonCodeCounts: { legacy_pending_booking_manual_review: 11 },
      warningCodeCounts: {},
      alreadyCanonicalCount: 0,
      automaticExactCount: 0,
      manualReviewCount: 11,
      excludedCount: 0,
      corruptCount: 0,
      estimatedOnlyCount: 0,
      unknownAmountCount: 0,
      legacyPendingCount: 11,
      multipleRecordCount: 0,
      mismatchedRecordCount: 0,
    },
    authoritativeTotals: { grossAmountMinor: 0, discountAmountMinor: 0, finalPayableAmountMinor: 0, rowCount: 0, currency: "EGP", label: "AUTHORITATIVE_EXACT_EVIDENCE_ONLY" },
    estimatedTotals: { estimatedTotalMinor: 0, estimatedRowCount: 0, currency: "EGP", label: "NON_AUTHORITATIVE_ESTIMATE_EXCLUDED_FROM_FINANCE_REVENUE" },
    unknownAmountPopulation: { rowCount: 0, label: "UNKNOWN_NEVER_SUBSTITUTED_AS_ZERO" },
    ...overrides,
  };
}

interface Harness {
  deps: import("./financeBackfillProductionDryRunCli").ProductionDryRunCliDeps;
  stdoutLines: string[];
  stderrLines: string[];
  exitCode: number | undefined;
  runDryRunCallCount: number;
}

function makeHarness(opts: { env?: Record<string, string | undefined>; report?: DryRunReport; plannerError?: Error } = {}): Harness {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  let exitCode: number | undefined;
  let runDryRunCallCount = 0;
  const env = opts.env ?? realRailwayEnv();

  const deps = {
    getEnv: (key: string) => env[key],
    runDryRun: async (_filters: DryRunFilters) => {
      runDryRunCallCount += 1;
      if (opts.plannerError) throw opts.plannerError;
      return opts.report ?? fakeReport();
    },
    stdout: (l: string) => stdoutLines.push(l),
    stderr: (l: string) => stderrLines.push(l),
    exit: (c: number) => {
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
    get runDryRunCallCount() {
      return runDryRunCallCount;
    },
  } as Harness;
}

// ── Production guards (1-14) ─────────────────────────────────────────────────

test("1. missing explicit authorization is rejected", () => {
  const argv = baseArgv().filter((a) => a !== REQUIRED_AUTH_FLAG);
  assert.throws(() => parseProductionDryRunArgs(argv), (err: unknown) => {
    assert.ok(err instanceof CliValidationError);
    assert.match((err as Error).message, /requires/);
    return true;
  });
});

test("2. wrong confirmation phrase is rejected", () => {
  assert.throws(() => parseProductionDryRunArgs(baseArgv(["--confirm", "yes"])), /exact phrase/);
});

test("3. non-production environment is rejected", () => {
  assert.throws(() => parseProductionDryRunArgs(baseArgv(["--environment", "local"])), /must be exactly "production"/);
});

test("4. missing Railway context is rejected", async () => {
  const h = makeHarness({ env: {} });
  await runProductionDryRunCli(baseArgv(), h.deps);
  assert.equal(h.exitCode, EXIT_SAFETY_ERROR);
  assert.equal(h.runDryRunCallCount, 0);
});

test("5. wrong Railway environment is rejected", async () => {
  const h = makeHarness({ env: realRailwayEnv({ RAILWAY_ENVIRONMENT_NAME: "staging" }) });
  await runProductionDryRunCli(baseArgv(), h.deps);
  assert.equal(h.exitCode, EXIT_SAFETY_ERROR);
});

test("6. an ambiguous remote DB (declares production but wrong host) is rejected", async () => {
  const h = makeHarness({ env: realRailwayEnv({ DATABASE_URL: "postgresql://some-other-host.example.com:5432/db" }) });
  await runProductionDryRunCli(baseArgv(), h.deps);
  assert.equal(h.exitCode, EXIT_SAFETY_ERROR);
});

test("7. an unsupported managed DB host (e.g. a different provider) is rejected", async () => {
  for (const host of ["db.supabase.co", "ep-foo.neon.tech", "x.render.com", "db.amazonaws.com"]) {
    const h = makeHarness({ env: realRailwayEnv({ DATABASE_URL: `postgresql://${host}:5432/db` }) });
    await runProductionDryRunCli(baseArgv(), h.deps);
    assert.equal(h.exitCode, EXIT_SAFETY_ERROR, `expected ${host} to be rejected`);
  }
});

test("8. the expected Railway production target (real project ID + internal host + matching commit) is accepted", () => {
  assert.doesNotThrow(() =>
    assertProductionContext({
      getEnv: (key) => realRailwayEnv()[key],
      expectedCommit: CLEAN_COMMIT,
      expectedClassifierVersion: CLASSIFIER_VERSION,
      actualClassifierVersion: CLASSIFIER_VERSION,
    }),
  );
});

test("9. missing expected commit (deployed commit env var absent) is rejected", async () => {
  const h = makeHarness({ env: realRailwayEnv({ RAILWAY_GIT_COMMIT_SHA: undefined }) });
  await runProductionDryRunCli(baseArgv(), h.deps);
  assert.equal(h.exitCode, EXIT_SAFETY_ERROR);
});

test("10. deployed commit mismatch is rejected", async () => {
  const h = makeHarness({ env: realRailwayEnv({ RAILWAY_GIT_COMMIT_SHA: "b".repeat(40) }) });
  await runProductionDryRunCli(baseArgv(), h.deps);
  assert.equal(h.exitCode, EXIT_SAFETY_ERROR);
});

test("11. classifier version mismatch is rejected", async () => {
  const h = makeHarness();
  await runProductionDryRunCli(baseArgv(["--expected-classifier-version", "9.9.9"]), h.deps);
  assert.equal(h.exitCode, EXIT_SAFETY_ERROR);
});

test("12. missing bounded scope (--source-family) is rejected", () => {
  const argv = baseArgv().filter((_, i, arr) => !(arr[i - 1] === "--source-family" || arr[i] === "--source-family"));
  assert.throws(() => parseProductionDryRunArgs(argv), /--source-family is required/);
});

test("13. unbounded max rows is rejected", () => {
  assert.throws(() => parseProductionDryRunArgs(baseArgv(["--max-rows", "1000000"])), /exceeds the maximum/);
});

test("14. unbounded batch size is rejected", () => {
  assert.throws(() => parseProductionDryRunArgs(baseArgv(["--batch-size", "1000000"])), /exceeds the maximum/);
});

// ── Read-only / no-writer enforcement (15-17) ────────────────────────────────

test("15. planner is called exactly once per invocation", async () => {
  const h = makeHarness();
  await runProductionDryRunCli(baseArgv(), h.deps);
  assert.equal(h.runDryRunCallCount, 1);
  assert.equal(h.exitCode, EXIT_OK);
});

test("16. this CLI's source imports only the dry-run planner, never a writer", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(new URL("./financeBackfillProductionDryRunCli.ts", import.meta.url), "utf8");
  const importLines = source.split("\n").filter((l) => l.trim().startsWith("import"));
  for (const line of importLines) {
    assert.equal(/financeBackfillWriter|financeBackfillExecutionService|financeBackfillBatchService|financeBackfillProgressService/i.test(line), false, line);
  }
});

test("17. there is no write flag anywhere in the parsed argument contract", () => {
  const parsed = parseProductionDryRunArgs(baseArgv());
  const serialised = JSON.stringify(parsed).toLowerCase();
  for (const bad of ["writemode", "\"write\"", "execute", "applymode"]) {
    assert.equal(serialised.includes(bad), false);
  }
});

// ── Output privacy (25-31) ────────────────────────────────────────────────────

test("25. human output contains no source IDs", async () => {
  const h = makeHarness();
  await runProductionDryRunCli(baseArgv(["--format", "human"]), h.deps);
  const text = h.stdoutLines.join("\n");
  assert.equal(/\b42\b/.test(text), false);
});

test("26. output contains no PII fields", async () => {
  const h = makeHarness();
  await runProductionDryRunCli(baseArgv(), h.deps);
  const text = h.stdoutLines.join("\n").toLowerCase();
  for (const forbidden of ["studentname", "studentemail", "studentphone", "childname"]) {
    assert.equal(text.includes(forbidden), false);
  }
});

test("27. JSON output is aggregate-only (the exact planner report, no extra fields)", async () => {
  const report = fakeReport();
  const h = makeHarness({ report });
  await runProductionDryRunCli(baseArgv(["--format", "json"]), h.deps);
  const parsed = JSON.parse(h.stdoutLines[h.stdoutLines.length - 1]);
  assert.deepEqual(parsed, report);
});

test("28. human output is aggregate-only", async () => {
  const h = makeHarness();
  await runProductionDryRunCli(baseArgv(["--format", "human"]), h.deps);
  const text = h.stdoutLines.join("\n");
  assert.ok(text.includes("classifier version"));
  assert.ok(text.includes("eligibility counts"));
});

test("29. the known legacy pending-payment bookings remain classified manual_review in the report", async () => {
  const h = makeHarness();
  await runProductionDryRunCli(baseArgv(), h.deps);
  const parsed = JSON.parse(h.stdoutLines[h.stdoutLines.length - 1]) as DryRunReport;
  assert.equal(parsed.aggregates.classificationCounts["legacy_pending_booking_manual_review"], 11);
  assert.equal(parsed.aggregates.eligibilityCounts["manual_review"], 11);
});

test("30. a zero-exact-eligible result is represented correctly, not omitted or defaulted to a fabricated non-zero value", async () => {
  const h = makeHarness({ report: fakeReport() }); // automaticExactCount: 0 in fakeReport
  await runProductionDryRunCli(baseArgv(), h.deps);
  const parsed = JSON.parse(h.stdoutLines[h.stdoutLines.length - 1]) as DryRunReport;
  assert.equal(parsed.aggregates.automaticExactCount, 0);
  assert.ok("automaticExactCount" in parsed.aggregates);
});

test("31. expected writable count is not fabricated — it is exactly the planner's own automaticExactCount, unmodified", async () => {
  const report = fakeReport({ aggregates: { ...fakeReport().aggregates, automaticExactCount: 3 } });
  const h = makeHarness({ report });
  await runProductionDryRunCli(baseArgv(), h.deps);
  const parsed = JSON.parse(h.stdoutLines[h.stdoutLines.length - 1]) as DryRunReport;
  assert.equal(parsed.aggregates.automaticExactCount, 3);
});

// ── Error output safety ──────────────────────────────────────────────────────

test("planner error never leaks raw SQL or driver text", async () => {
  const h = makeHarness({ plannerError: new Error("Failed query: SELECT * FROM bookings WHERE student_email = $1\nparams: someone@example.com") });
  await runProductionDryRunCli(baseArgv(), h.deps);
  const text = h.stderrLines.join("\n");
  assert.equal(/SELECT|FROM|WHERE/i.test(text), false);
  assert.equal(text.includes("someone@example.com"), false);
  assert.equal(h.exitCode, EXIT_PLANNER_ERROR);
});

test("DB URL and secrets are redacted from any error output", async () => {
  const h = makeHarness({ env: realRailwayEnv({ DATABASE_URL: "postgresql://user:supersecret@wrong-host.example.com:5432/db" }) });
  await runProductionDryRunCli(baseArgv(), h.deps);
  const text = h.stderrLines.join("\n");
  assert.equal(text.includes("supersecret"), false);
  assert.equal(text.includes("wrong-host.example.com"), false);
});

test("unknown flags are rejected", () => {
  assert.throws(() => parseProductionDryRunArgs(baseArgv(["--not-a-flag", "x"])), /unknown argument/);
});

test("write-like/unattended flags are explicitly rejected", () => {
  for (const flag of ["--force", "--auto", "--execute", "--apply"]) {
    assert.throws(() => parseProductionDryRunArgs(baseArgv([flag])), /write-like\/unattended argument rejected/);
  }
});

// ── Read-only-transaction + zero-write proof (disposable Postgres) ──────────

let pool: typeof import("@workspace/db").pool;

after(async () => {
  if (pool) await pool.end();
});

const TRACKED_TABLES = [
  "payment_records", "payment_events", "payment_refunds",
  "payment_backfill_batches", "payment_backfill_progress", "payment_backfill_progress_items",
  "package_orders", "bookings", "attendance", "credit_transactions", "notifications",
] as const;

async function tableCounts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of TRACKED_TABLES) {
    const res = await pool.query(`SELECT count(*)::int AS n FROM ${t}`);
    out[t] = res.rows[0].n as number;
  }
  return out;
}

test("18/19. PostgreSQL itself rejects INSERT and UPDATE inside the read-only execution transaction", async () => {
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;
  const { db } = dbModule;
  const { sql } = await import("drizzle-orm");

  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.execute(sql`SET TRANSACTION READ ONLY`);
      await tx.execute(sql`INSERT INTO bookings (student_name, student_email) VALUES ('should never persist', 'x@example.test')`);
    }),
    (err: unknown) => {
      const cause = err instanceof Error && "cause" in err ? (err as { cause?: unknown }).cause : undefined;
      const msg = cause instanceof Error ? cause.message : String(cause ?? "");
      assert.match(msg, /read-only transaction/);
      return true;
    },
  );

  const [row] = await db.select().from((await import("@workspace/db")).paymentBackfillBatchesTable).limit(1);
  void row; // table must exist and be reachable (schema sanity), no assertion on content needed here
  const target = await pool.query(`SELECT count(*)::int AS n FROM payment_backfill_batches`);
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.execute(sql`SET TRANSACTION READ ONLY`);
      await tx.execute(sql`UPDATE payment_backfill_batches SET notes = 'tampered' WHERE 1=0`);
      void target;
    }),
    (err: unknown) => {
      const cause = err instanceof Error && "cause" in err ? (err as { cause?: unknown }).cause : undefined;
      const msg = cause instanceof Error ? cause.message : String(cause ?? "");
      assert.match(msg, /read-only transaction/);
      return true;
    },
  );
});

test("20/21/22. before/after Finance, batch/progress, and source table counts are unchanged across a real read-only-transaction dry-run", async () => {
  const { db } = await import("@workspace/db");
  const { sql } = await import("drizzle-orm");
  const { runFinanceBackfillDryRun } = await import("../lib/financeBackfillDryRun");

  const before_ = await tableCounts();
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`);
    return runFinanceBackfillDryRun(
      { sourceFamilies: ["bookings"], maxRows: 100, batchSize: 50 },
      tx as unknown as Parameters<typeof runFinanceBackfillDryRun>[1],
    );
  });
  const after_ = await tableCounts();
  assert.deepEqual(after_, before_);
});
