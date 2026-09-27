/**
 * CLI contract and safety-guard tests — Final Editorial, Phase B.
 *
 * Every dependency is injected, so these run with no database, no network,
 * no filesystem and no git. What they protect is the boundary an operator
 * actually touches: which arguments are accepted, which are refused by
 * name, when a writing mode refuses to start, and — most importantly —
 * that `execute` cannot be talked into writing past a blocker.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * Every dependency below is injected and nothing here opens a connection —
 * but the CLI's module graph reaches @workspace/db, which refuses to load
 * without a DATABASE_URL. The same disposable-localhost default the rest
 * of this repo's backend tests use is applied, and asserted local, so the
 * suite can never point at anything real even by accident.
 */
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
  EXECUTE_CONFIRMATION_PHRASE,
  EXIT_BLOCKED,
  EXIT_OK,
  EXIT_SAFETY_ERROR,
  EXIT_VALIDATION_ERROR,
  EXIT_VERIFY_FAILED,
  ROLLBACK_CONFIRMATION_PHRASE,
  assertWriteIdentityGuards,
  parseNewsMigrationCliArgs,
  runNewsMigrationCli,
} = await import("./newsMigrationCli");

type CliDeps = import("./newsMigrationCli").CliDeps;
type NewsMigrationPlan = import("../lib/newsMigrationPlanner").NewsMigrationPlan;

const MANIFEST_JSON = JSON.stringify({
  manifestVersion: 1,
  sourceTable: "website_news_posts",
  targetChannel: "news",
  languageCode: "en",
  authors: [],
  topics: [],
});

function plan(overrides: Partial<NewsMigrationPlan> = {}): NewsMigrationPlan {
  return {
    planSchemaVersion: 1,
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
  };
}

interface Harness {
  deps: CliDeps;
  out: string[];
  err: string[];
  codes: number[];
  calls: string[];
}

function harness(overrides: Partial<CliDeps> = {}, confirm = true): Harness {
  const out: string[] = [];
  const err: string[] = [];
  const codes: number[] = [];
  const calls: string[] = [];
  const deps: CliDeps = {
    readManifestFile: async () => MANIFEST_JSON,
    runDryRun: async () => {
      calls.push("dry-run");
      return plan();
    },
    runExecute: async () => {
      calls.push("execute");
      return {
        plan: plan(),
        result: {
          created: [],
          skipped: [],
          recommendationsWritten: [],
          placement: null,
          crossTypePreserved: [],
          unresolvedNewsRecommendations: [],
        },
      };
    },
    runVerify: async () => {
      calls.push("verify");
      return {
        ok: true,
        checked: { sourceRows: 0, migratedPosts: 0, relations: 0 },
        findings: [],
        crossTypePreservation: [],
      };
    },
    runRollbackDryRun: async () => {
      calls.push("rollback-dry-run");
      return {
        candidates: [],
        counts: { total: 0, edited: 0, deletable: 0 },
        incomingRelationsLost: 0,
        deletablePostIds: [],
        includeEdited: false,
      };
    },
    runRollback: async () => {
      calls.push("rollback");
      return {
        report: {
          candidates: [],
          counts: { total: 0, edited: 0, deletable: 0 },
          incomingRelationsLost: 0,
          deletablePostIds: [],
          includeEdited: false,
        },
        deleted: 0,
      };
    },
    // A local, disposable database and a non-production environment: the
    // default posture for every test here.
    getEnv: (key) => (key === "DATABASE_URL" ? "postgresql://u@127.0.0.1:5432/disposable" : undefined),
    getGitState: async () => ({ commit: "abc123", dirty: false }),
    requestConfirmation: async () => confirm,
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
    exit: (code) => codes.push(code),
    ...overrides,
  };
  return { deps, out, err, codes, calls };
}

const args = (...extra: string[]) => [
  "--mode",
  "dry-run",
  "--manifest",
  "/tmp/manifest.json",
  "--environment",
  "local",
  ...extra,
];

// ─── Argument contract ───────────────────────────────────────────────────────

test("parses a complete argument set", () => {
  const parsed = parseNewsMigrationCliArgs(args());
  assert.equal(parsed.mode, "dry-run");
  assert.equal(parsed.manifestPath, "/tmp/manifest.json");
  assert.equal(parsed.environment, "local");
  assert.equal(parsed.format, "human");
});

test("rejects guard-weakening flag NAMES before anything else is parsed", () => {
  // A scripted attempt to skip a blocker must fail loudly at the argument
  // contract rather than quietly somewhere deeper.
  for (const flag of ["--force", "--ignore-blockers", "--allow-production", "--yes"]) {
    assert.throws(
      () => parseNewsMigrationCliArgs([...args(), flag]),
      /guard-weakening argument rejected/,
      `expected ${flag} to be rejected`,
    );
  }
});

test("rejects an unknown flag and a positional argument", () => {
  assert.throws(() => parseNewsMigrationCliArgs([...args(), "--nope", "x"]), /unknown argument/);
  assert.throws(() => parseNewsMigrationCliArgs([...args(), "stray"]), /unexpected positional/);
});

test("requires a manifest in EVERY mode, including the read-only ones", () => {
  // A read-only mode needs it too: the manifest defines the scope, the
  // language and the decisions the plan is computed from.
  assert.throws(
    () => parseNewsMigrationCliArgs(["--mode", "verify", "--environment", "local"]),
    /--manifest is required in every mode/,
  );
});

test("rejects an unsupported mode", () => {
  assert.throws(
    () => parseNewsMigrationCliArgs(["--mode", "destroy", "--manifest", "m", "--environment", "local"]),
    /unsupported --mode/,
  );
});

test("--include-edited is refused outside the rollback modes", () => {
  assert.throws(
    () => parseNewsMigrationCliArgs([...args(), "--include-edited"]),
    /only applies to the rollback modes/,
  );
  assert.equal(
    parseNewsMigrationCliArgs([
      "--mode", "rollback-dry-run", "--manifest", "m", "--environment", "local", "--include-edited",
    ]).includeEdited,
    true,
  );
});

// ─── Write identity guards ───────────────────────────────────────────────────

test("a writing mode refuses without an expected code commit", () => {
  assert.throws(
    () => assertWriteIdentityGuards({ expectedCodeCommit: null, gitState: { commit: "a", dirty: false } }),
    /--expected-code-commit is required/,
  );
});

test("a writing mode refuses against a dirty or unknown worktree", () => {
  assert.throws(
    () => assertWriteIdentityGuards({ expectedCodeCommit: "a", gitState: { commit: "a", dirty: true } }),
    /not confirmed clean/,
  );
  assert.throws(
    () => assertWriteIdentityGuards({ expectedCodeCommit: "a", gitState: { commit: "a", dirty: null } }),
    /not confirmed clean/,
  );
  assert.throws(
    () => assertWriteIdentityGuards({ expectedCodeCommit: "a", gitState: { commit: null, dirty: false } }),
    /Git metadata unavailable/,
  );
});

test("a writing mode refuses on a code commit mismatch", () => {
  assert.throws(
    () => assertWriteIdentityGuards({ expectedCodeCommit: "a", gitState: { commit: "b", dirty: false } }),
    /code commit mismatch/,
  );
});

// ─── Environment guard, applied to EVERY mode ────────────────────────────────

test("every mode refuses a declared production environment", async () => {
  for (const mode of ["dry-run", "verify", "execute", "rollback-dry-run", "rollback"]) {
    const h = harness();
    await runNewsMigrationCli(
      ["--mode", mode, "--manifest", "m", "--environment", "production", "--expected-code-commit", "abc123"],
      h.deps,
    );
    assert.deepEqual(h.codes, [EXIT_SAFETY_ERROR], `${mode} must refuse production`);
    assert.deepEqual(h.calls, [], `${mode} must not reach the database`);
  }
});

test("every mode refuses a managed/remote database host", async () => {
  const h = harness({
    getEnv: (key) => (key === "DATABASE_URL" ? "postgresql://u:p@abc.rlwy.net:5432/railway" : undefined),
  });
  await runNewsMigrationCli(args(), h.deps);
  assert.deepEqual(h.codes, [EXIT_SAFETY_ERROR]);
  assert.deepEqual(h.calls, []);
});

test("a writing mode refuses when a Railway context is detected", async () => {
  const h = harness({
    getEnv: (key) =>
      key === "DATABASE_URL"
        ? "postgresql://u@127.0.0.1:5432/disposable"
        : key === "RAILWAY_ENVIRONMENT"
          ? "production"
          : undefined,
  });
  await runNewsMigrationCli(
    ["--mode", "execute", "--manifest", "m", "--environment", "local", "--expected-code-commit", "abc123"],
    h.deps,
  );
  assert.deepEqual(h.codes, [EXIT_SAFETY_ERROR]);
  assert.deepEqual(h.calls, []);
});

// ─── Manifest handling ───────────────────────────────────────────────────────

test("an invalid manifest is refused before any database work", async () => {
  const h = harness({ readManifestFile: async () => JSON.stringify({ manifestVersion: 99 }) });
  await runNewsMigrationCli(args(), h.deps);
  assert.deepEqual(h.codes, [EXIT_VALIDATION_ERROR]);
  assert.deepEqual(h.calls, []);
  assert.ok(h.err.some((line) => /manifest rejected/.test(line)));
});

test("unreadable manifest JSON is refused, not treated as empty", async () => {
  const h = harness({ readManifestFile: async () => "{ not json" });
  await runNewsMigrationCli(args(), h.deps);
  assert.deepEqual(h.codes, [EXIT_VALIDATION_ERROR]);
});

// ─── Mode behaviour ──────────────────────────────────────────────────────────

test("dry-run succeeds on a clean plan and never calls a writing path", async () => {
  const h = harness();
  await runNewsMigrationCli(args(), h.deps);
  assert.deepEqual(h.codes, [EXIT_OK]);
  assert.deepEqual(h.calls, ["dry-run"]);
});

test("dry-run exits BLOCKED when the plan has blockers, but still prints the plan", async () => {
  const blocked = plan({
    entries: [
      {
        action: "blocked",
        sourceId: 1,
        sourceSlug: "news-1",
        title: "T",
        blockers: [{ code: "author_unresolved", message: "no byline decision", remedy: "add an authors entry" }],
      },
    ],
    counts: { total: 1, create: 0, skip: 0, blocked: 1 },
  });
  const h = harness({ runDryRun: async () => blocked });
  await runNewsMigrationCli(args(), h.deps);
  assert.deepEqual(h.codes, [EXIT_BLOCKED]);
  assert.ok(h.out.join("\n").includes("no byline decision"));
  assert.ok(h.out.join("\n").includes("add an authors entry"));
});

test("the plan always prints the cross-type preservation manifest, even when empty", async () => {
  const h = harness();
  await runNewsMigrationCli(args(), h.deps);
  const printed = h.out.join("\n");
  assert.match(printed, /CROSS-TYPE PRESERVATION MANIFEST/);
  assert.match(printed, /NEVER written into Editorial recommendations/);
});

test("EXECUTE REFUSES TO WRITE when the plan has a single blocker", async () => {
  // The central safety property of the whole tool: there is no flag, no
  // confirmation and no combination of arguments that writes past a
  // blocker, because every blocker is a decision only a person can make.
  const blocked = plan({
    entries: [
      {
        action: "blocked",
        sourceId: 1,
        sourceSlug: "news-1",
        title: "T",
        blockers: [{ code: "gallery_alt_missing", message: "image 1 has no alt", remedy: "add galleryAlt" }],
      },
    ],
    counts: { total: 1, create: 0, skip: 0, blocked: 1 },
  });
  const h = harness({ runDryRun: async () => blocked });
  await runNewsMigrationCli(
    ["--mode", "execute", "--manifest", "m", "--environment", "local", "--expected-code-commit", "abc123"],
    h.deps,
  );
  assert.deepEqual(h.codes, [EXIT_BLOCKED]);
  assert.equal(h.calls.includes("execute"), false, "the writer must never be reached");
});

test("execute refuses when the confirmation phrase is not given", async () => {
  const h = harness({}, false);
  await runNewsMigrationCli(
    ["--mode", "execute", "--manifest", "m", "--environment", "local", "--expected-code-commit", "abc123"],
    h.deps,
  );
  assert.deepEqual(h.codes, [EXIT_SAFETY_ERROR]);
  assert.equal(h.calls.includes("execute"), false);
});

test("execute prints the plan BEFORE prompting, so the operator confirms against it", async () => {
  const order: string[] = [];
  const h = harness({
    requestConfirmation: async () => {
      order.push("prompt");
      return true;
    },
    runDryRun: async () => {
      order.push("plan");
      return plan();
    },
  });
  await runNewsMigrationCli(
    ["--mode", "execute", "--manifest", "m", "--environment", "local", "--expected-code-commit", "abc123"],
    h.deps,
  );
  assert.deepEqual(order, ["plan", "prompt"]);
  assert.deepEqual(h.codes, [EXIT_OK]);
});

test("the confirmation phrases are distinct, so one cannot be reused for the other", () => {
  assert.notEqual(EXECUTE_CONFIRMATION_PHRASE, ROLLBACK_CONFIRMATION_PHRASE);
});

test("verify fails loudly when it has findings", async () => {
  const h = harness({
    runVerify: async () => ({
      ok: false,
      checked: { sourceRows: 6, migratedPosts: 5, relations: 3 },
      findings: [{ code: "cross_channel_relation", message: "a relation crosses channels" }],
      crossTypePreservation: [],
    }),
  });
  await runNewsMigrationCli(
    ["--mode", "verify", "--manifest", "m", "--environment", "local"],
    h.deps,
  );
  assert.deepEqual(h.codes, [EXIT_VERIFY_FAILED]);
  assert.ok(h.out.join("\n").includes("a relation crosses channels"));
});

test("rollback with nothing to delete never prompts and never deletes", async () => {
  const h = harness();
  await runNewsMigrationCli(
    ["--mode", "rollback", "--manifest", "m", "--environment", "local", "--expected-code-commit", "abc123"],
    h.deps,
  );
  assert.deepEqual(h.codes, [EXIT_OK]);
  assert.equal(h.calls.includes("rollback"), false);
});

test("rollback refuses without the confirmation phrase", async () => {
  const h = harness(
    {
      runRollbackDryRun: async () => ({
        candidates: [
          { editorialPostId: 7, sourceId: 1, slug: "news-1", title: "T", status: "published", edited: false, editedReasons: [] },
        ],
        counts: { total: 1, edited: 0, deletable: 1 },
        incomingRelationsLost: 0,
        deletablePostIds: [7],
        includeEdited: false,
      }),
    },
    false,
  );
  await runNewsMigrationCli(
    ["--mode", "rollback", "--manifest", "m", "--environment", "local", "--expected-code-commit", "abc123"],
    h.deps,
  );
  assert.deepEqual(h.codes, [EXIT_SAFETY_ERROR]);
  assert.equal(h.calls.includes("rollback"), false);
});

test("the rollback preview marks edited posts KEEP and says what a rollback does not undo", async () => {
  const h = harness({
    runRollbackDryRun: async () => ({
      candidates: [
        { editorialPostId: 7, sourceId: 1, slug: "news-1", title: "T", status: "published", edited: true, editedReasons: ["deck differs"] },
        { editorialPostId: 8, sourceId: 2, slug: "news-2", title: "U", status: "published", edited: false, editedReasons: [] },
      ],
      counts: { total: 2, edited: 1, deletable: 1 },
      incomingRelationsLost: 2,
      deletablePostIds: [8],
      includeEdited: false,
    }),
  });
  await runNewsMigrationCli(
    ["--mode", "rollback-dry-run", "--manifest", "m", "--environment", "local"],
    h.deps,
  );
  const printed = h.out.join("\n");
  assert.match(printed, /KEEP {3}post #7/);
  assert.match(printed, /DELETE post #8/);
  assert.match(printed, /edited: deck differs/);
  assert.match(printed, /admin_activity_logs entries/);
  assert.match(printed, /website_news_posts \(never touched\)/);
});
