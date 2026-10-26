/** Provision a brand-new local cluster from current schema, never historical
 * migrations. No ambient DATABASE_URL or shared database is used. */
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function binary(name) {
  const preferred = `/opt/homebrew/opt/postgresql@18/bin/${name}`;
  return existsSync(preferred) ? preferred : execFileSync("which", [name], { encoding: "utf8" }).trim();
}
const port = await new Promise((resolvePort, reject) => {
  const socket = createServer(); socket.on("error", reject);
  socket.listen(0, "127.0.0.1", () => { const value = socket.address().port; socket.close(() => resolvePort(value)); });
});
const directory = mkdtempSync(join(tmpdir(), "central-limits-disposable-"));
const data = join(directory, "data");
const database = "central_limits_disposable";
const url = `postgresql://postgres@127.0.0.1:${port}/${database}`;
const env = { ...process.env, DATABASE_URL: url, LIMITS_DISPOSABLE_DATABASE_URL: url, DISPOSABLE_ROUTES_DATABASE_URL: url, NODE_ENV: "test" };
delete env.REDIS_URL; delete env.PUSH_NOTIFICATIONS_ENABLED;
let started = false;
try {
  execFileSync(binary("initdb"), ["-D", data, "-U", "postgres", "-A", "trust", "--no-locale", "--encoding=UTF8"], { stdio: "pipe" });
  execFileSync(binary("pg_ctl"), ["-D", data, "-l", join(directory, "postgres.log"), "-o", `-p ${port} -h 127.0.0.1 -k ${directory}`, "-w", "start"], { stdio: "pipe" });
  started = true;
  execFileSync(binary("createdb"), ["-h", "127.0.0.1", "-p", String(port), "-U", "postgres", database], { stdio: "pipe" });
  const schema = execFileSync(join(root, "lib/db/node_modules/.bin/drizzle-kit"), ["export", "--config=drizzle.config.ts"], { cwd: join(root, "lib/db"), env, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const file = join(directory, "schema.sql"); writeFileSync(file, schema);
  execFileSync(binary("psql"), ["-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1", "-f", file], { stdio: "pipe" });
  console.log("Fresh isolated PostgreSQL cluster provisioned from schema; no migrations executed.");
  const files = process.argv.slice(2);
  const args = ["--test", ...(files.length ? files : ["artifacts/api-server/src/lib/accountCapacity.integration.test.ts"])];
  const child = spawn(join(root, "node_modules/.pnpm/node_modules/.bin/tsx"), args, { cwd: root, env, stdio: "inherit" });
  process.exitCode = await new Promise((resolveCode, reject) => { child.on("error", reject); child.on("exit", code => resolveCode(code ?? 1)); });
} finally {
  if (started) execFileSync(binary("pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"], { stdio: "pipe" });
  rmSync(directory, { recursive: true, force: true });
}
