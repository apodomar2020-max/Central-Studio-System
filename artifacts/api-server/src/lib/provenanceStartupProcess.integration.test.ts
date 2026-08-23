/**
 * B3B0-1A Verification Closure — Section C/D: real process-boundary proof
 * that T0 activation succeeds/fails at genuine OS-process granularity, via
 * node:child_process.spawn running provenanceBootstrapProcessScript.ts
 * (which calls the actual, unmodified production `ensureProvenanceActivated`).
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATABASE_URL = process.env.DISPOSABLE_EMAIL_PROVENANCE_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_email_provenance";

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
assertDisposableUrl(DATABASE_URL);

const TSX_BIN = path.resolve(__dirname, "../../../../lib/db/node_modules/.bin/tsx");
const SCRIPT = path.resolve(__dirname, "./provenanceBootstrapProcessScript.ts");

function runChild(env: Record<string, string | undefined>): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(TSX_BIN, [SCRIPT], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

process.env.DATABASE_URL = DATABASE_URL;

let pool: typeof import("@workspace/db").pool;

before(async () => {
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;
  await pool.query("TRUNCATE TABLE provenance_activation");
});

after(async () => {
  await pool.end();
});

test("C: process-level startup SUCCESS — real spawned child reaches READY_TO_LISTEN and creates exactly one provenance_activation row", async () => {
  const { count: before1 } = (await pool.query("SELECT count(*)::int AS count FROM provenance_activation")).rows[0];
  assert.equal(before1, 0, "precondition: table truncated");

  const result = await runChild({
    DATABASE_URL,
    // Deliberately UNSET to also empirically prove K: startup succeeds
    // without the pepper (T0 activation doesn't need it).
    IDENTITY_PROVENANCE_PEPPER: undefined,
  });

  assert.equal(result.code, 0, `expected exit 0, got ${result.code}, stderr=${result.stderr}`);
  assert.match(result.stdout, /READY_TO_LISTEN t0=/, "expected ready marker on stdout");

  const { rows } = await pool.query("SELECT count(*)::int AS count FROM provenance_activation");
  assert.equal(rows[0].count, 1, "exactly one provenance_activation row must exist after success");
});

test("D: process-level startup FAILURE — real spawned child with unreachable DB exits non-zero, never prints READY_TO_LISTEN, creates no row", async () => {
  const badUrl = "postgresql://baduser@127.0.0.1:59999/nonexistent_db_for_fail_closed_test";
  const result = await runChild({
    DATABASE_URL: badUrl,
    IDENTITY_PROVENANCE_PEPPER: "test-identity-provenance-pepper".padEnd(64, "0"),
  });

  assert.notEqual(result.code, 0, `expected non-zero exit, got ${result.code}`);
  assert.doesNotMatch(result.stdout, /READY_TO_LISTEN/, "must never reach ready-to-listen marker on DB failure");
  assert.match(result.stderr, /STARTUP_FATAL/, "must print fatal marker to stderr");

  // Confirm no row was fabricated in the REAL disposable DB alongside
  // (connection to badUrl genuinely failed, so nothing could have been
  // written there; this reconfirms the good DB was untouched by this run).
  const { rows } = await pool.query("SELECT count(*)::int AS count FROM provenance_activation");
  assert.equal(rows[0].count, 1, "the earlier success test's single row must be the only row — failure run wrote nothing");
});
