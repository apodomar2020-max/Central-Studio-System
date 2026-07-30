import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomInt } from "node:crypto";

function binary(name: string, candidates: string[]): string {
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  return execFileSync("which", [name], { encoding: "utf8" }).trim();
}
const initdb = binary("initdb", ["/opt/homebrew/bin/initdb", "/opt/homebrew/opt/libpq/bin/initdb"]);
const postgres = binary("postgres", ["/opt/homebrew/bin/postgres", "/opt/homebrew/opt/libpq/bin/postgres"]);
const pgCtl = binary("pg_ctl", ["/opt/homebrew/bin/pg_ctl", "/opt/homebrew/opt/libpq/bin/pg_ctl"]);
const createdb = binary("createdb", ["/opt/homebrew/bin/createdb", "/opt/homebrew/opt/libpq/bin/createdb"]);
const psql = binary("psql", ["/opt/homebrew/bin/psql", "/opt/homebrew/opt/libpq/bin/psql"]);

async function waitForDatabase(port: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      execFileSync(psql, ["-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "-d", "postgres", "-c", "SELECT 1"], { stdio: "ignore" });
      return;
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
  }
  throw new Error("DISPOSABLE_POSTGRES_START_TIMEOUT");
}

async function main(): Promise<void> {
  const root = resolve(import.meta.dirname, "../../..");
  const tempRoot = mkdtempSync(join(tmpdir(), "central-cutover-g1r-"));
  const dataDir = join(tempRoot, "postgres");
  const port = randomInt(5700, 5900);
  const source = `central_cutover_source_disposable_${process.pid}`;
  const target = `central_cutover_target_disposable_${process.pid}`;
  let processHandle: ChildProcess | undefined;
  try {
    execFileSync(initdb, ["-D", dataDir, "-U", "postgres", "-A", "trust", "--no-locale", "--encoding=UTF8"], { stdio: "ignore" });
    processHandle = spawn(postgres, ["-D", dataDir, "-p", String(port), "-k", tempRoot, "-c", "listen_addresses=127.0.0.1"], { stdio: "ignore" });
    await waitForDatabase(port);
    for (const database of [source, target]) {
      execFileSync(createdb, ["-h", "127.0.0.1", "-p", String(port), "-U", "postgres", database]);
      const migrations = readdirSync(join(root, "lib/db/migrations")).filter((file) => file.endsWith(".sql")).sort();
      if (migrations.length !== 91) throw new Error(`MIGRATION_COUNT_MISMATCH:${migrations.length}`);
      for (const migration of migrations) {
        execFileSync(psql, [
          "-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "-d", database,
          "-v", "ON_ERROR_STOP=1", "-f", join(root, "lib/db/migrations", migration),
        ], { stdio: "ignore" });
      }
    }
    const env = {
      ...process.env,
      FRESH_LAUNCH_REHEARSAL: "I_UNDERSTAND_THIS_IS_LOCAL_AND_DISPOSABLE",
      FRESH_LAUNCH_SOURCE_DATABASE_URL: `postgresql://postgres@127.0.0.1:${port}/${source}`,
      FRESH_LAUNCH_TARGET_DATABASE_URL: `postgresql://postgres@127.0.0.1:${port}/${target}`,
      DATABASE_URL: `postgresql://postgres@127.0.0.1:${port}/${target}`,
      DISPOSABLE_ROUTES_DATABASE_URL: `postgresql://postgres@127.0.0.1:${port}/${target}`,
      DISPOSABLE_OWNERSHIP_DATABASE_URL: `postgresql://postgres@127.0.0.1:${port}/${target}`,
      DISPOSABLE_ACTIVATION_INDEX_DATABASE_URL: `postgresql://postgres@127.0.0.1:${port}/${target}`,
      DISPOSABLE_HOTFIX_DATABASE_URL: `postgresql://postgres@127.0.0.1:${port}/${target}`,
      DISPOSABLE_SINGLE_CLASS_BOOKING_DATABASE_URL: `postgresql://postgres@127.0.0.1:${port}/${target}`,
      DISPOSABLE_PACKAGE_CAPTURE_DATABASE_URL: `postgresql://postgres@127.0.0.1:${port}/${target}`,
      DISPOSABLE_ATTENDANCE_DATABASE_URL: `postgresql://postgres@127.0.0.1:${port}/${target}`,
      DISPOSABLE_STUDIO_WALKIN_DATABASE_URL: `postgresql://postgres@127.0.0.1:${port}/${target}`,
      DISPOSABLE_BALLET_CLASS_DATABASE_URL: `postgresql://postgres@127.0.0.1:${port}/${target}?sslmode=disable`,
    };
    const tsx = resolve(root, "scripts/node_modules/.bin/tsx");
    execFileSync(tsx, ["--test", resolve(import.meta.dirname, "freshLaunchCutover.integration.test.ts")], { cwd: root, env, stdio: "inherit" });
    const smokeSuites = [
      "artifacts/api-server/src/lib/participantLifecycleReadiness.integration.test.ts",
      "artifacts/api-server/src/routes/packageOrders.creationCapture.integration.test.ts",
      "artifacts/api-server/src/routes/packageOrders.activation.integration.test.ts",
      "artifacts/api-server/src/routes/bookings.creationCapture.integration.test.ts",
      "artifacts/api-server/src/routes/checkIn.participant.integration.test.ts",
      "artifacts/api-server/src/routes/attendance.studioWalkInCapture.integration.test.ts",
      "artifacts/api-server/src/lib/financeReadModel.test.ts",
      "artifacts/api-server/src/lib/balletClassCanonicalDatabase.test.ts",
    ];
    for (const suite of smokeSuites) {
      const fullPath = resolve(root, suite);
      const usesModuleMocks = readFileSync(fullPath, "utf8").includes("mock.module(");
      if (usesModuleMocks) {
        const loader = resolve(root, "node_modules/.pnpm/node_modules/tsx/dist/loader.mjs");
        execFileSync(process.execPath, ["--experimental-test-module-mocks", "--import", loader, "--test", fullPath], { cwd: root, env, stdio: "inherit" });
      } else {
        execFileSync(tsx, ["--test", fullPath], { cwd: root, env, stdio: "inherit" });
      }
    }
    process.stdout.write(`[fresh-launch-cutover] local rehearsal passed; migrations=91; source=${source}; target=${target}\n`);
  } finally {
    if (processHandle) {
      try { execFileSync(pgCtl, ["stop", "-D", dataDir, "-m", "immediate"], { stdio: "ignore" }); } catch {}
      processHandle.kill("SIGKILL");
    }
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "rehearsal failed"}\n`);
  process.exitCode = 1;
});
