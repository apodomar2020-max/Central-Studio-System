/**
 * PRODUCTION AUTHORIZATION MATRIX — News → Editorial migration, Phase B.
 *
 * What these tests protect is a single property: there is exactly one way
 * to run this migration against production, it is explicit at every step,
 * and every other way is refused. A guard that has never been tested
 * refusing is a guard nobody knows refuses.
 *
 * DISPOSABLE LOCAL POSTGRES ONLY. DATABASE_URL is deliberately expected to
 * be unset in normal use, so the disposable-localhost default below applies;
 * it is asserted localhost and disposable-looking before anything is
 * imported. The production-context tests use an INJECTED `getEnv` that
 * *describes* a Railway production environment while every real query still
 * goes to that disposable local database. Nothing here can reach production.
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";

const TEST_DATABASE_URL =
  process.env.NEWS_MIGRATION_TEST_DATABASE_URL ??
  `postgresql://${process.env.USER ?? "postgres"}@127.0.0.1:5432/central_studio_disposable_news_migration`;
{
  const url = new URL(TEST_DATABASE_URL);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error(`Refusing: DATABASE_URL host "${url.hostname}" is not localhost/127.0.0.1`);
  }
  if (!/disposable|local|test/i.test(url.pathname)) {
    throw new Error(`Refusing: database name "${url.pathname}" does not look disposable/local/test`);
  }
  if (/rlwy\.net|railway/i.test(TEST_DATABASE_URL)) {
    throw new Error("Refusing: DATABASE_URL looks like Railway");
  }
}
process.env.DATABASE_URL = TEST_DATABASE_URL;

const {
  EXPECTED_RAILWAY_PROJECT_ID,
  EXIT_BLOCKED,
  EXIT_OK,
  EXIT_SAFETY_ERROR,
  EXIT_UNKNOWN_ERROR,
  EXIT_VALIDATION_ERROR,
  PRODUCTION_EXECUTE_CONFIRMATION_PHRASE,
  PRODUCTION_ROLLBACK_CONFIRMATION_PHRASE,
  READ_ONLY_AUTH_FLAG,
  READ_ONLY_CONFIRMATION_PHRASE,
  WRITE_AUTH_FLAG,
  capabilityOfMode,
  parseProductionCliArgs,
  runNewsMigrationProductionCli,
} = await import("./newsMigrationProductionCli");

const { NEWS_MIGRATION_PLAN_SCHEMA_VERSION } = await import("../lib/newsMigrationPlanner");
const { runNewsMigrationCli } = await import("./newsMigrationCli");
const { EXIT_SAFETY_ERROR: LOCAL_EXIT_SAFETY_ERROR } = await import("./newsMigrationCli");

type ProductionCliDeps = import("./newsMigrationProductionCli").ProductionCliDeps;
type Capability = import("./newsMigrationProductionCli").Capability;
type NewsMigrationPlan = import("../lib/newsMigrationPlanner").NewsMigrationPlan;
type RollbackReport = import("../lib/newsMigrationRollback").RollbackReport;

// ─── Fixtures ────────────────────────────────────────────────────────────────

const DEPLOYED_COMMIT = "a".repeat(40);

const MANIFEST_JSON = JSON.stringify({
  manifestVersion: 1,
  sourceTable: "website_news_posts",
  targetChannel: "news",
  languageCode: "en",
  authors: [],
  topics: [],
});

/**
 * A manifest that is SHAPE-valid but leaves the Victoria Vance byline
 * undecided — the concrete unresolved-human-decision case Phase B is built
 * around. The blocker itself comes from the planner, which is why this
 * fixture is paired with a plan carrying that blocker below.
 */
const VICTORIA_VANCE_BLOCKED_PLAN = (): NewsMigrationPlan =>
  plan({
    entries: [
      {
        sourceId: 1,
        sourceSlug: "yagp-finals",
        title: "YAGP Finals",
        action: "blocked",
        blockers: [
          {
            code: "author_unresolved",
            message:
              'No manifest decision for the byline "Victoria Vance" / "Artistic Director".',
            remedy: "Add an author entry keyed by that exact (name, role) pair.",
          },
        ],
      },
    ],
    counts: { total: 1, create: 0, skip: 0, blocked: 1 },
  });

function plan(overrides: Partial<NewsMigrationPlan> = {}): NewsMigrationPlan {
  return {
    planSchemaVersion: NEWS_MIGRATION_PLAN_SCHEMA_VERSION,
    sourceTable: "website_news_posts",
    targetChannel: "news",
    languageCode: "en",
    languageId: 1,
    manifestBlockers: [],
    entries: [],
    crossTypePreservation: [],
    unresolvedNewsRecommendations: [],
    counts: { total: 0, create: 0, skip: 0, blocked: 0 },
    ...overrides,
  } as NewsMigrationPlan;
}

function rollbackReport(deletable: number[]): RollbackReport {
  return {
    includeEdited: false,
    counts: { total: deletable.length, edited: 0, deletable: deletable.length },
    candidates: [],
    deletablePostIds: deletable,
    incomingRelationsLost: 0,
  } as unknown as RollbackReport;
}

/** A complete, positively-provable Railway production environment. */
function productionEnv(overrides: Record<string, string | undefined> = {}) {
  const env: Record<string, string | undefined> = {
    RAILWAY_ENVIRONMENT_NAME: "production",
    RAILWAY_PROJECT_ID: EXPECTED_RAILWAY_PROJECT_ID,
    RAILWAY_SERVICE_ID: "svc-news-api",
    // Describes the shape the guard demands. No query in this file ever
    // uses it — the real connection is the disposable localhost one above.
    DATABASE_URL: "postgresql://u:p@postgres.railway.internal:5432/railway",
    RAILWAY_GIT_COMMIT_SHA: DEPLOYED_COMMIT,
    ...overrides,
  };
  return (key: string) => env[key];
}

interface Harness {
  deps: ProductionCliDeps;
  out: string[];
  err: string[];
  codes: number[];
  calls: string[];
}

function harness(overrides: Partial<ProductionCliDeps> = {}, confirm = true): Harness {
  const out: string[] = [];
  const err: string[] = [];
  const codes: number[] = [];
  const calls: string[] = [];
  const deps: ProductionCliDeps = {
    readManifestFile: async () => {
      calls.push("readManifestFile");
      return MANIFEST_JSON;
    },
    getEnv: productionEnv(),
    runDryRun: async () => {
      calls.push("runDryRun");
      return plan();
    },
    runVerify: async () => {
      calls.push("runVerify");
      return { ok: true, checked: { sourceRows: 0, migratedPosts: 0, relations: 0 }, findings: [], crossTypePreservation: [] } as never;
    },
    runRollbackDryRun: async () => {
      calls.push("runRollbackDryRun");
      return rollbackReport([]);
    },
    runExecute: async () => {
      calls.push("runExecute");
      return {
        plan: plan(),
        result: {
          created: [],
          skipped: [],
          recommendationsWritten: [],
          placement: null,
          crossTypePreserved: [],
        } as never,
      };
    },
    runRollback: async () => {
      calls.push("runRollback");
      return { report: rollbackReport([1]), deleted: 1 };
    },
    requestConfirmation: async () => {
      calls.push("requestConfirmation");
      return confirm;
    },
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
    exit: (code) => codes.push(code),
    ...overrides,
  };
  return { deps, out, err, codes, calls };
}

function args(
  mode: string,
  extra: string[] = [],
  opts: { auth?: string | null; confirm?: string } = {},
): string[] {
  const auth =
    opts.auth === null
      ? []
      : [opts.auth ?? (capabilityOfMode(mode as never) === "write" ? WRITE_AUTH_FLAG : READ_ONLY_AUTH_FLAG)];
  const phrase =
    opts.confirm ??
    (mode === "execute"
      ? PRODUCTION_EXECUTE_CONFIRMATION_PHRASE
      : mode === "rollback"
        ? PRODUCTION_ROLLBACK_CONFIRMATION_PHRASE
        : READ_ONLY_CONFIRMATION_PHRASE);
  return [
    ...auth,
    "--mode",
    mode,
    "--environment",
    "production",
    "--manifest",
    "/tmp/news-manifest.json",
    "--confirm",
    phrase,
    "--expected-commit",
    DEPLOYED_COMMIT,
    "--expected-plan-schema-version",
    String(NEWS_MIGRATION_PLAN_SCHEMA_VERSION),
    ...extra,
  ];
}

const run = (argv: string[], capability: Capability, h: Harness) =>
  runNewsMigrationProductionCli(argv, capability, h.deps);

// ─── 1. The local CLI is unchanged and still refuses production ─────────────

test("local CLI: --environment production is still refused, in every mode", async () => {
  for (const mode of ["dry-run", "execute", "verify", "rollback-dry-run", "rollback"]) {
    const codes: number[] = [];
    const err: string[] = [];
    await runNewsMigrationCli(
      ["--mode", mode, "--environment", "production", "--manifest", "/tmp/m.json"],
      {
        readManifestFile: async () => MANIFEST_JSON,
        getEnv: (key) => (key === "DATABASE_URL" ? TEST_DATABASE_URL : undefined),
        getGitState: async () => ({ commit: DEPLOYED_COMMIT, dirty: false }),
        runDryRun: async () => {
          throw new Error(`the local CLI reached the engine in production mode "${mode}"`);
        },
        runExecute: async () => {
          throw new Error("unreachable");
        },
        runVerify: async () => {
          throw new Error("unreachable");
        },
        runRollbackDryRun: async () => {
          throw new Error("unreachable");
        },
        runRollback: async () => {
          throw new Error("unreachable");
        },
        requestConfirmation: async () => true,
        stdout: () => {},
        stderr: (line) => err.push(line),
        exit: (code) => codes.push(code),
      },
    );
    assert.deepEqual(codes, [LOCAL_EXIT_SAFETY_ERROR], `mode ${mode}`);
    assert.match(err.join("\n"), /declared environment is production/);
  }
});

test("local CLI: a non-production local run still works exactly as before", async () => {
  const codes: number[] = [];
  let planned = false;
  await runNewsMigrationCli(
    ["--mode", "dry-run", "--environment", "local", "--manifest", "/tmp/m.json"],
    {
      readManifestFile: async () => MANIFEST_JSON,
      getEnv: (key) => (key === "DATABASE_URL" ? TEST_DATABASE_URL : undefined),
      getGitState: async () => ({ commit: DEPLOYED_COMMIT, dirty: false }),
      runDryRun: async () => {
        planned = true;
        return plan();
      },
      runExecute: async () => {
        throw new Error("unreachable");
      },
      runVerify: async () => {
        throw new Error("unreachable");
      },
      runRollbackDryRun: async () => {
        throw new Error("unreachable");
      },
      runRollback: async () => {
        throw new Error("unreachable");
      },
      requestConfirmation: async () => true,
      stdout: () => {},
      stderr: () => {},
      exit: (code) => codes.push(code),
    },
  );
  assert.equal(planned, true);
  assert.deepEqual(codes, [EXIT_OK]);
});

// ─── 2. Capability separation ───────────────────────────────────────────────

test("a write mode cannot be reached through the read-only entrypoint", async () => {
  for (const mode of ["execute", "rollback"]) {
    const h = harness();
    // Even armed with the WRITE authorization flag and the WRITE phrase.
    await run(args(mode, [], { auth: WRITE_AUTH_FLAG }), "read-only", h);
    assert.deepEqual(h.codes, [EXIT_VALIDATION_ERROR], mode);
    assert.equal(h.calls.includes("runExecute"), false);
    assert.equal(h.calls.includes("runRollback"), false);
    // Refused before the manifest is even read.
    assert.equal(h.calls.includes("readManifestFile"), false);
  }
});

test("a read-only mode cannot be run by the write entrypoint", async () => {
  for (const mode of ["dry-run", "verify", "rollback-dry-run"]) {
    const h = harness();
    await run(args(mode, [], { auth: READ_ONLY_AUTH_FLAG }), "write", h);
    assert.deepEqual(h.codes, [EXIT_VALIDATION_ERROR], mode);
  }
});

test("the read-only authorization flag is not accepted by the write command", async () => {
  const h = harness();
  await run(args("execute", [], { auth: READ_ONLY_AUTH_FLAG }), "write", h);
  assert.deepEqual(h.codes, [EXIT_VALIDATION_ERROR]);
  assert.match(h.err.join("\n"), /authorizes the other capability class/);
});

// ─── 3. Production READ-ONLY denial matrix ──────────────────────────────────

test("read-only: fully authorized and provable → reaches the engine", async () => {
  const h = harness();
  await run(args("dry-run"), "read-only", h);
  assert.deepEqual(h.codes, [EXIT_OK]);
  assert.equal(h.calls.includes("runDryRun"), true);
  assert.match(h.out.join("\n"), /PRODUCTION READ-ONLY/);
});

test("read-only: missing authorization flag → denied", async () => {
  const h = harness();
  await run(args("dry-run", [], { auth: null }), "read-only", h);
  assert.deepEqual(h.codes, [EXIT_VALIDATION_ERROR]);
  assert.match(h.err.join("\n"), /requires --i-authorize-production-read-only-news-migration/);
  assert.equal(h.calls.length, 0);
});

test("read-only: wrong confirmation phrase → denied", async () => {
  for (const phrase of ["", "production read-only news migration", PRODUCTION_EXECUTE_CONFIRMATION_PHRASE]) {
    const h = harness();
    await run(args("dry-run", [], { confirm: phrase }), "read-only", h);
    assert.deepEqual(h.codes, [EXIT_VALIDATION_ERROR], JSON.stringify(phrase));
    assert.equal(h.calls.length, 0);
  }
});

test("read-only: --environment must be exactly production", async () => {
  for (const env of ["staging", "local", "prod", "development"]) {
    const h = harness();
    const argv = args("dry-run").map((a) => (a === "production" ? env : a));
    await run(argv, "read-only", h);
    assert.deepEqual(h.codes, [EXIT_VALIDATION_ERROR], env);
  }
});

test("read-only: an unprovable production context → denied", async () => {
  const cases: Array<[string, Record<string, string | undefined>]> = [
    ["no Railway environment at all", { RAILWAY_ENVIRONMENT_NAME: undefined }],
    ["a Railway staging environment", { RAILWAY_ENVIRONMENT_NAME: "staging" }],
    ["a different Railway project", { RAILWAY_PROJECT_ID: "00000000-0000-0000-0000-000000000000" }],
    ["no Railway service context", { RAILWAY_SERVICE_ID: undefined }],
    ["no DATABASE_URL", { DATABASE_URL: undefined }],
    ["an unparseable DATABASE_URL", { DATABASE_URL: "not a url" }],
    [
      "a generic remote Postgres merely calling itself production",
      { DATABASE_URL: "postgresql://u:p@db.example.com:5432/production" },
    ],
    ["no deployed commit metadata", { RAILWAY_GIT_COMMIT_SHA: undefined }],
    ["a deployed commit other than the reviewed one", { RAILWAY_GIT_COMMIT_SHA: "b".repeat(40) }],
  ];
  for (const [label, overrides] of cases) {
    const h = harness({ getEnv: productionEnv(overrides) });
    await run(args("dry-run"), "read-only", h);
    assert.deepEqual(h.codes, [EXIT_SAFETY_ERROR], label);
    assert.equal(h.calls.length, 0, label);
    assert.match(h.err.join("\n"), /refusing to run/, label);
  }
});

test("read-only: a plan-schema-version mismatch → denied", async () => {
  const h = harness();
  const argv = args("dry-run").map((a) =>
    a === String(NEWS_MIGRATION_PLAN_SCHEMA_VERSION) ? "999" : a,
  );
  await run(argv, "read-only", h);
  assert.deepEqual(h.codes, [EXIT_SAFETY_ERROR]);
  assert.match(h.err.join("\n"), /plan schema version mismatch/);
});

test("read-only: unknown mode → denied", async () => {
  const h = harness();
  await run(args("execute-now"), "read-only", h);
  assert.deepEqual(h.codes, [EXIT_VALIDATION_ERROR]);
});

test("read-only: a malformed manifest → denied, and the engine is never reached", async () => {
  const h = harness({ readManifestFile: async () => '{"manifestVersion": 1, "oops": true}' });
  await run(args("dry-run"), "read-only", h);
  assert.deepEqual(h.codes, [EXIT_VALIDATION_ERROR]);
  assert.equal(h.calls.includes("runDryRun"), false);
});

test("read-only: a blocked plan exits BLOCKED and writes nothing", async () => {
  const h = harness({ runDryRun: async () => VICTORIA_VANCE_BLOCKED_PLAN() });
  await run(args("dry-run"), "read-only", h);
  assert.deepEqual(h.codes, [EXIT_BLOCKED]);
  assert.match(h.out.join("\n"), /Victoria Vance/);
});

test("read-only: verify and rollback-dry-run are authorized the same way", async () => {
  for (const mode of ["verify", "rollback-dry-run"]) {
    const ok = harness();
    await run(args(mode), "read-only", ok);
    assert.deepEqual(ok.codes, [EXIT_OK], mode);

    const denied = harness();
    await run(args(mode, [], { auth: null }), "read-only", denied);
    assert.deepEqual(denied.codes, [EXIT_VALIDATION_ERROR], mode);
  }
});

// ─── 4. Production WRITE denial matrix ──────────────────────────────────────

test("execute: missing authorization flag → denied", async () => {
  const h = harness();
  await run(args("execute", [], { auth: null }), "write", h);
  assert.deepEqual(h.codes, [EXIT_VALIDATION_ERROR]);
  assert.equal(h.calls.length, 0);
});

test("execute: wrong confirmation phrase → denied", async () => {
  for (const phrase of [READ_ONLY_CONFIRMATION_PHRASE, PRODUCTION_ROLLBACK_CONFIRMATION_PHRASE, "MIGRATE NEWS TO EDITORIAL"]) {
    const h = harness();
    await run(args("execute", [], { confirm: phrase }), "write", h);
    assert.deepEqual(h.codes, [EXIT_VALIDATION_ERROR], phrase);
    assert.equal(h.calls.includes("runExecute"), false);
  }
});

test("execute: wrong environment → denied", async () => {
  const h = harness({ getEnv: productionEnv({ RAILWAY_ENVIRONMENT_NAME: "staging" }) });
  await run(args("execute"), "write", h);
  assert.deepEqual(h.codes, [EXIT_SAFETY_ERROR]);
  assert.equal(h.calls.length, 0);
});

test("execute: an incomplete manifest → denied before any planning", async () => {
  const h = harness({
    readManifestFile: async () =>
      JSON.stringify({ manifestVersion: 1, sourceTable: "website_news_posts" }),
  });
  await run(args("execute"), "write", h);
  assert.deepEqual(h.codes, [EXIT_VALIDATION_ERROR]);
  assert.equal(h.calls.includes("runDryRun"), false);
  assert.equal(h.calls.includes("runExecute"), false);
});

test("execute: an unresolved human decision (Victoria Vance) → BLOCKED, never written", async () => {
  const h = harness({ runDryRun: async () => VICTORIA_VANCE_BLOCKED_PLAN() });
  await run(args("execute"), "write", h);
  assert.deepEqual(h.codes, [EXIT_BLOCKED]);
  assert.equal(h.calls.includes("runExecute"), false);
  assert.equal(h.calls.includes("requestConfirmation"), false);
  assert.match(h.err.join("\n"), /Victoria Vance/);
});

test("execute: the interactive confirmation is mandatory even with --confirm correct", async () => {
  const h = harness({}, false);
  await run(args("execute"), "write", h);
  assert.deepEqual(h.codes, [EXIT_SAFETY_ERROR]);
  assert.equal(h.calls.includes("requestConfirmation"), true);
  assert.equal(h.calls.includes("runExecute"), false);
});

test("execute: fully authorized → plans first, prompts, then reaches the shared engine", async () => {
  const h = harness();
  await run(args("execute"), "write", h);
  assert.deepEqual(h.codes, [EXIT_OK]);
  assert.deepEqual(h.calls, [
    "readManifestFile",
    "runDryRun",
    "requestConfirmation",
    "runExecute",
  ]);
  assert.match(h.out.join("\n"), /PRODUCTION WRITE/);
});

test("rollback: the same denial matrix applies", async () => {
  const withCandidates = () => ({ runRollbackDryRun: async () => rollbackReport([7]) });

  const noAuth = harness(withCandidates());
  await run(args("rollback", [], { auth: null }), "write", noAuth);
  assert.deepEqual(noAuth.codes, [EXIT_VALIDATION_ERROR]);

  const wrongPhrase = harness(withCandidates());
  await run(args("rollback", [], { confirm: PRODUCTION_EXECUTE_CONFIRMATION_PHRASE }), "write", wrongPhrase);
  assert.deepEqual(wrongPhrase.codes, [EXIT_VALIDATION_ERROR]);

  const wrongEnv = harness({
    ...withCandidates(),
    getEnv: productionEnv({ RAILWAY_PROJECT_ID: "nope" }),
  });
  await run(args("rollback"), "write", wrongEnv);
  assert.deepEqual(wrongEnv.codes, [EXIT_SAFETY_ERROR]);

  const badManifest = harness({ ...withCandidates(), readManifestFile: async () => "{" });
  await run(args("rollback"), "write", badManifest);
  assert.deepEqual(badManifest.codes, [EXIT_VALIDATION_ERROR]);

  const declined = harness(withCandidates(), false);
  await run(args("rollback"), "write", declined);
  assert.deepEqual(declined.codes, [EXIT_SAFETY_ERROR]);
  assert.equal(declined.calls.includes("runRollback"), false);

  const authorized = harness(withCandidates());
  await run(args("rollback"), "write", authorized);
  assert.deepEqual(authorized.codes, [EXIT_OK]);
  assert.equal(authorized.calls.includes("runRollback"), true);
});

// ─── 5. No bypass flag exists, under any name ───────────────────────────────

test("every guard-weakening flag name is rejected by name, in both classes", async () => {
  const forbidden = [
    "--force",
    "--allow-production",
    "--skip-safety",
    "--skip-guards",
    "--ignore-blockers",
    "--ignore-manifest",
    "--yes",
    "--auto-approve",
    "--unattended",
    "--skip-confirmation",
    "--apply",
    "--write",
  ];
  for (const flag of forbidden) {
    const ro = harness();
    await run([...args("dry-run"), flag], "read-only", ro);
    assert.deepEqual(ro.codes, [EXIT_VALIDATION_ERROR], flag);
    assert.match(ro.err.join("\n"), /guard-weakening argument rejected/, flag);

    const wr = harness();
    await run([...args("execute"), flag], "write", wr);
    assert.deepEqual(wr.codes, [EXIT_VALIDATION_ERROR], flag);
  }
});

test("an unknown flag is rejected rather than ignored", async () => {
  const h = harness();
  await run([...args("dry-run"), "--whatever", "1"], "read-only", h);
  assert.deepEqual(h.codes, [EXIT_VALIDATION_ERROR]);
});

// ─── 6. No secret material leaks into output ────────────────────────────────

test("a connection string in an engine error is redacted, never printed", async () => {
  const h = harness({
    runDryRun: async () => {
      throw new Error(
        'connection to "postgresql://user:hunter2@postgres.railway.internal:5432/railway" failed',
      );
    },
  });
  await run(args("dry-run"), "read-only", h);
  assert.deepEqual(h.codes, [EXIT_UNKNOWN_ERROR]);
  const printed = [...h.out, ...h.err].join("\n");
  assert.equal(printed.includes("hunter2"), false);
  assert.equal(printed.includes("postgresql://"), false);
});

test("no confirmation phrase is secret material — they are fixed, published constants", () => {
  // Asserted as a contract, not as a strength claim: the phrases exist to
  // make an operator say what they are doing, and are safe in a shell
  // history and in a review document.
  for (const phrase of [
    READ_ONLY_CONFIRMATION_PHRASE,
    PRODUCTION_EXECUTE_CONFIRMATION_PHRASE,
    PRODUCTION_ROLLBACK_CONFIRMATION_PHRASE,
  ]) {
    assert.match(phrase, /^[A-Z -]+$/);
  }
  assert.notEqual(READ_ONLY_CONFIRMATION_PHRASE, PRODUCTION_EXECUTE_CONFIRMATION_PHRASE);
  assert.notEqual(PRODUCTION_EXECUTE_CONFIRMATION_PHRASE, PRODUCTION_ROLLBACK_CONFIRMATION_PHRASE);
});

test("parseProductionCliArgs is pure and reports capability honestly", () => {
  const parsed = parseProductionCliArgs(args("dry-run"), "read-only");
  assert.equal(parsed.mode, "dry-run");
  assert.equal(parsed.capability, "read-only");
  assert.equal(parsed.expectedCommit, DEPLOYED_COMMIT);
  assert.throws(() => parseProductionCliArgs(args("execute"), "read-only"));
});

// ─── 7. Read-only is enforced by POSTGRES, not by this code ─────────────────

const { db, pool } = await import("@workspace/db");
const { sql } = await import("drizzle-orm");

/**
 * The same wrapper shape newsMigrationProductionReadOnly.entry.ts uses.
 *
 * The session-level `default_transaction_read_only` is reset in a `finally`
 * here and ONLY here: the real entrypoint's process exits when the command
 * ends, so it never needs to undo it, but this test file keeps using the
 * same pool afterwards.
 */
async function readOnly<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
  await pool.query("SET SESSION default_transaction_read_only = on");
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SET TRANSACTION READ ONLY`);
      return fn(tx);
    });
  } finally {
    await pool.query("SET SESSION default_transaction_read_only = off");
  }
}

/** Postgres errors arrive wrapped by drizzle; the truth is on `cause`. */
function mentionsReadOnlyRefusal(err: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if (/read-only transaction/i.test(current.message)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

test("a mutation attempted inside the read-only wrapper is rejected by the database itself", async () => {
  await assert.rejects(
    () =>
      readOnly(async (tx) =>
        (tx as { execute: (q: unknown) => Promise<unknown> }).execute(
          sql`CREATE TABLE news_migration_readonly_probe (id int)`,
        ),
      ),
    (err: unknown) => mentionsReadOnlyRefusal(err),
    "a write inside the read-only wrapper must fail at the database",
  );
});

test("the production read-only CLI surfaces a DB-refused mutation as an engine error, not a success", async () => {
  const h = harness({
    // A hostile/bugged planner that tries to write. The CLI has no way to
    // let this succeed: Postgres refuses it.
    runDryRun: () =>
      readOnly(async (tx) =>
        (tx as { execute: (q: unknown) => Promise<unknown> }).execute(
          sql`CREATE TABLE news_migration_readonly_probe2 (id int)`,
        ),
      ) as never,
  });
  await run(args("dry-run"), "read-only", h);
  assert.deepEqual(h.codes, [EXIT_UNKNOWN_ERROR]);
});

// ─── 8. Production dry-run counts come from the real planner ────────────────

test("the production dry-run derives counts from the real planner, not from any fixture", async () => {
  const { planNewsMigration } = await import("../lib/newsMigrationPlanner");
  const { parseNewsMigrationManifest } = await import("../lib/newsMigrationManifest");
  const {
    editorialLanguagesTable,
    websiteNewsPostsTable,
  } = await import("@workspace/db");

  await db.execute(sql`TRUNCATE TABLE website_news_posts RESTART IDENTITY CASCADE`);
  const existing = await db.select().from(editorialLanguagesTable);
  if (!existing.some((row) => row.code === "en")) {
    await db.insert(editorialLanguagesTable).values({
      code: "en",
      name: "English",
      nativeName: "English",
      direction: "ltr",
      isDefault: true,
      isActive: true,
    });
  }

  const manifest = parseNewsMigrationManifest(JSON.parse(MANIFEST_JSON));
  const h = harness({
    runDryRun: () => readOnly((tx) => planNewsMigration(tx as never, manifest)),
  });
  await run([...args("dry-run"), "--format", "json"], "read-only", h);

  const emitted = JSON.parse(h.out[h.out.length - 1]) as NewsMigrationPlan;
  const rows = await db.select().from(websiteNewsPostsTable);
  // The real count of whatever is actually there — zero here, and never the
  // repo's seed count of 6.
  assert.equal(emitted.counts.total, rows.length);
  assert.equal(emitted.counts.total, 0);
  assert.equal(emitted.sourceTable, "website_news_posts");
  assert.equal(emitted.targetChannel, "news");
});

after(async () => {
  await pool.end();
});
