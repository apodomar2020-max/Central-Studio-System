import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
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
  throw new Error("G2A_DISPOSABLE_POSTGRES_START_TIMEOUT");
}

async function main(): Promise<void> {
  const root = resolve(import.meta.dirname, "../../..");
  const tempRoot = mkdtempSync(join(tmpdir(), "central-g2a-"));
  const dataDir = join(tempRoot, "postgres");
  const port = randomInt(5901, 6100);
  const database = `central_g2a_disposable_${process.pid}`;
  let processHandle: ChildProcess | undefined;
  try {
    execFileSync(initdb, ["-D", dataDir, "-U", "postgres", "-A", "trust", "--no-locale", "--encoding=UTF8"], { stdio: "ignore" });
    processHandle = spawn(postgres, ["-D", dataDir, "-p", String(port), "-k", tempRoot, "-c", "listen_addresses=127.0.0.1"], { stdio: "ignore" });
    await waitForDatabase(port);
    execFileSync(createdb, ["-h", "127.0.0.1", "-p", String(port), "-U", "postgres", database]);
    const migrations = readdirSync(join(root, "lib/db/migrations")).filter((file) => file.endsWith(".sql")).sort();
    if (migrations.length !== 91) throw new Error(`MIGRATION_COUNT_MISMATCH:${migrations.length}`);
    for (const migration of migrations) {
      execFileSync(psql, [
        "-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "-d", database,
        "-v", "ON_ERROR_STOP=1", "-f", join(root, "lib/db/migrations", migration),
      ], { stdio: "ignore" });
    }
    const tsx = resolve(root, "scripts/node_modules/.bin/tsx");
    const env = {
      ...process.env,
      G2A_DISPOSABLE_DATABASE_URL: `postgresql://postgres@127.0.0.1:${port}/${database}`,
    };
    execFileSync(tsx, ["--test",
      resolve(import.meta.dirname, "productionApprovalBundle.test.ts"),
      resolve(import.meta.dirname, "productionInspection.integration.test.ts"),
    ], { cwd: root, env, stdio: "inherit" });
    process.stdout.write("[fresh-launch-g2a] approval and read-only inspection tests passed; migrations=91; disposable_databases=1\n");
  } finally {
    if (processHandle) {
      try { execFileSync(pgCtl, ["stop", "-D", dataDir, "-m", "immediate"], { stdio: "ignore" }); } catch {}
    }
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "G2A test runner failed"}\n`);
  process.exitCode = 1;
});
