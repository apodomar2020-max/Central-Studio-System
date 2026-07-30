import { execSync, spawn } from "child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "fs";
import { join, resolve } from "path";

function findBinary(name: string, fallbackPaths: string[]): string {
  for (const path of fallbackPaths) {
    if (existsSync(path)) return path;
  }
  try {
    const out = execSync(`which ${name}`, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).trim();
    if (out && existsSync(out)) return out;
  } catch {
    // continue fallback
  }
  throw new Error(`Required binary "${name}" not found in PATH or standard locations: ${fallbackPaths.join(", ")}`);
}

const psqlBin = findBinary("psql", ["/opt/homebrew/bin/psql", "/opt/homebrew/opt/libpq/bin/psql"]);
const initdbBin = findBinary("initdb", ["/opt/homebrew/bin/initdb", "/opt/homebrew/opt/libpq/bin/initdb"]);
const postgresBin = findBinary("postgres", ["/opt/homebrew/bin/postgres", "/opt/homebrew/opt/libpq/bin/postgres"]);
const pgCtlBin = findBinary("pg_ctl", ["/opt/homebrew/bin/pg_ctl", "/opt/homebrew/opt/libpq/bin/pg_ctl"]);
const createdbBin = findBinary("createdb", ["/opt/homebrew/bin/createdb", "/opt/homebrew/opt/libpq/bin/createdb"]);
const redisBin = findBinary("redis-server", ["/opt/homebrew/bin/redis-server"]);
const redisCliBin = findBinary("redis-cli", ["/opt/homebrew/bin/redis-cli"]);

const tsxBin = resolve(process.cwd(), "node_modules/.pnpm/node_modules/.bin/tsx");

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForPostgres(port: number, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      execSync(`${psqlBin} -h 127.0.0.1 -p ${port} -U postgres -c "SELECT 1"`, { stdio: "ignore" });
      return;
    } catch {
      await sleep(150);
    }
  }
  throw new Error(`Timed out waiting for Postgres on port ${port}`);
}

async function waitForRedis(port: number, timeoutMs = 10000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const out = execSync(`${redisCliBin} -p ${port} PING`, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).trim();
      if (out === "PONG") return;
    } catch {
      await sleep(100);
    }
  }
  throw new Error(`Timed out waiting for Redis on port ${port}`);
}

function verifyPortsAvailable(ports: number[]) {
  for (const port of ports) {
    try {
      const pids = execSync(`lsof -t -i :${port}`, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).trim();
      if (pids) {
        throw new Error(`[Disposable Infra Error] Port ${port} is already in use by PID ${pids}. Refusing to terminate existing process.`);
      }
    } catch (err: any) {
      if (err.message?.includes("already in use")) throw err;
      // lsof exit code 1 indicates port is free
    }
  }
}

async function main() {
  verifyPortsAvailable([5602, 5612, 6389]);
  const rand = Math.random().toString(36).substring(2, 8);
  const pgDir5602 = `/tmp/central_studio_disposable_pg_5602_${rand}`;
  const pgDir5612 = `/tmp/central_studio_disposable_pg_5612_${rand}`;
  const redisDir = `/tmp/central_studio_disposable_redis_${rand}`;

  let pgProcess5602: ReturnType<typeof spawn> | null = null;
  let pgProcess5612: ReturnType<typeof spawn> | null = null;
  let redisProcess: ReturnType<typeof spawn> | null = null;

  try {
    console.log("[Disposable Infra] Setting up temporary clusters & directories...");
    mkdirSync(pgDir5602, { recursive: true });
    mkdirSync(pgDir5612, { recursive: true });
    mkdirSync(redisDir, { recursive: true });

    // Initialize Postgres clusters
    execSync(`${initdbBin} -D ${pgDir5602} -U postgres -A trust --no-locale --encoding=UTF8`, { stdio: "ignore" });
    execSync(`${initdbBin} -D ${pgDir5612} -U postgres -A trust --no-locale --encoding=UTF8`, { stdio: "ignore" });

    // Start Postgres 5602
    pgProcess5602 = spawn(postgresBin, ["-D", pgDir5602, "-p", "5602", "-k", "/tmp", "-c", "max_connections=200"], { stdio: "ignore" });
    // Start Postgres 5612
    pgProcess5612 = spawn(postgresBin, ["-D", pgDir5612, "-p", "5612", "-k", "/tmp", "-c", "max_connections=200"], { stdio: "ignore" });
    // Start Redis 6389
    redisProcess = spawn(redisBin, ["--port", "6389", "--dir", redisDir], { stdio: "ignore" });

    console.log("[Disposable Infra] Waiting for Postgres (5602, 5612) and Redis (6389) readiness...");
    await Promise.all([waitForPostgres(5602), waitForPostgres(5612), waitForRedis(6389)]);
    console.log("[Disposable Infra] Infrastructure servers online and responsive.");

    // Create databases
    console.log("[Disposable Infra] Creating databases...");
    try {
      execSync(`${createdbBin} -h 127.0.0.1 -p 5602 -U postgres central_studio_disposable_routes`, { stdio: "pipe" });
      execSync(`${createdbBin} -h 127.0.0.1 -p 5602 -U postgres central_studio_disposable_ballet_class`, { stdio: "pipe" });
      execSync(`${createdbBin} -h 127.0.0.1 -p 5602 -U postgres central_studio_disposable_ballet_class_legacy`, { stdio: "pipe" });
      execSync(`${createdbBin} -h 127.0.0.1 -p 5612 -U postgres central_studio_disposable_attendance`, { stdio: "pipe" });
    } catch (err: any) {
      console.error("[Disposable Infra] Database creation failed:", err.stderr?.toString() || err.message);
      throw err;
    }

    // Read all SQL migrations in order
    let rootDir = process.cwd();
    if (!existsSync(join(rootDir, "lib/db/migrations")) && existsSync(join(rootDir, "../lib/db/migrations"))) {
      rootDir = resolve(rootDir, "..");
    }
    const migrationsDir = resolve(rootDir, "lib/db/migrations");
    const sqlFiles = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort((a, b) => a.localeCompare(b));

    // Helper to apply migrations
    const applySqlFiles = (port: number, dbName: string, files: string[]) => {
      for (const f of files) {
        const fullPath = resolve(migrationsDir, f);
        try {
          execSync(`${psqlBin} -h 127.0.0.1 -p ${port} -U postgres -d ${dbName} -v ON_ERROR_STOP=1 -f "${fullPath}"`, { stdio: "pipe" });
        } catch (err: any) {
          console.error(`[Disposable Infra] Migration failed on ${dbName} (${f}):`, err.stderr?.toString() || err.message);
          throw err;
        }
      }
    };

    console.log(`[Disposable Infra] Applying ${sqlFiles.length} migrations to routes, attendance, and ballet_class DBs...`);
    applySqlFiles(5602, "central_studio_disposable_routes", sqlFiles);
    applySqlFiles(5612, "central_studio_disposable_attendance", sqlFiles);
    applySqlFiles(5602, "central_studio_disposable_ballet_class", sqlFiles);

    // Legacy DB: Migrations 0001..0074, Seed, then 0075..0080
    console.log("[Disposable Infra] Provisioning legacy compatibility DB (0001..0074 -> legacy seed -> 0075..0080)...");
    const pre0075Files = sqlFiles.filter((f) => {
      const idxStr = f.split("_")[0];
      return parseInt(idxStr, 10) < 75;
    });
    const post0074Files = sqlFiles.filter((f) => {
      const idxStr = f.split("_")[0];
      return parseInt(idxStr, 10) >= 75;
    });

    applySqlFiles(5602, "central_studio_disposable_ballet_class_legacy", pre0075Files);

    const legacySeedSql = `
      INSERT INTO ballet_levels (id, name, is_active) VALUES (1001, 'Level A (Prod-shaped)', true), (1002, 'Level B (Prod-shaped)', true);
      INSERT INTO ballet_instructors (id, name, is_active) VALUES (1001, 'Prod Instructor', true);
      INSERT INTO ballet_groups (id, name, level_id, is_active) VALUES (1001, 'Prod Group', 1001, true);
      INSERT INTO ballet_classes (id, title, is_active, instructor_id) VALUES (1001, 'Legacy Class 1 (Prod-shaped)', false, 1001), (1002, 'Legacy Class 2 (Prod-shaped)', false, 1001);
      INSERT INTO ballet_class_levels (class_id, level_id) VALUES (1001, 1001), (1002, 1002);
      INSERT INTO ballet_schedules (id, class_id, status, duration_mins, day_of_week, start_time, end_time) VALUES (1001, 1001, 'cancelled', NULL, 1, '10:00:00', '11:00:00');
      INSERT INTO attendance (id, ballet_class_id, ballet_schedule_id, student_name, student_email) VALUES (10001, 1001, 1001, 'Prod Shaped Student One', 'student1@example.com'), (10002, 1002, NULL, 'Prod Shaped Student Two', 'student2@example.com');
    `;
    try {
      execSync(`${psqlBin} -h 127.0.0.1 -p 5602 -U postgres -d central_studio_disposable_ballet_class_legacy -v ON_ERROR_STOP=1 -c "${legacySeedSql}"`, { stdio: "pipe" });
    } catch (seedErr: any) {
      console.error("[Disposable Infra] Legacy seed failed:", seedErr.stderr?.toString() || seedErr.stdout?.toString() || seedErr.message);
      throw seedErr;
    }

    applySqlFiles(5602, "central_studio_disposable_ballet_class_legacy", post0074Files);

    console.log("[Disposable Infra] All databases fully provisioned and seeded.");

    // Environment variables
    const env = {
      ...process.env,
      DATABASE_URL: "postgresql://postgres@127.0.0.1:5602/central_studio_disposable_routes",
      DISPOSABLE_ROUTES_DATABASE_URL: "postgresql://postgres@127.0.0.1:5602/central_studio_disposable_routes",
      DISPOSABLE_OWNERSHIP_DATABASE_URL: "postgresql://postgres@127.0.0.1:5602/central_studio_disposable_routes",
      DISPOSABLE_HOTFIX_DATABASE_URL: "postgresql://postgres@127.0.0.1:5602/central_studio_disposable_routes",
      DISPOSABLE_ACTIVATION_INDEX_DATABASE_URL: "postgresql://postgres@127.0.0.1:5602/central_studio_disposable_routes",
      DISPOSABLE_OCCURRENCE_UNIQUE_DATABASE_URL: "postgresql://postgres@127.0.0.1:5602/central_studio_disposable_routes",
      DISPOSABLE_LAST_CREDIT_DATABASE_URL: "postgresql://postgres@127.0.0.1:5602/central_studio_disposable_routes",
      DISPOSABLE_PACKAGE_CAPTURE_DATABASE_URL: "postgresql://postgres@127.0.0.1:5602/central_studio_disposable_routes",
      DISPOSABLE_SINGLE_CLASS_BOOKING_DATABASE_URL: "postgresql://postgres@127.0.0.1:5602/central_studio_disposable_routes",
      DISPOSABLE_PAYMENT_RECORDS_DATABASE_URL: "postgresql://postgres@127.0.0.1:5602/central_studio_disposable_routes",
      REMINDERS_TEST_DATABASE_URL: "postgresql://postgres@127.0.0.1:5602/central_studio_disposable_routes",
      DISPOSABLE_ATTENDANCE_DATABASE_URL: "postgresql://postgres@127.0.0.1:5612/central_studio_disposable_attendance",
      DISPOSABLE_STUDIO_WALKIN_DATABASE_URL: "postgresql://postgres@127.0.0.1:5612/central_studio_disposable_attendance",
      DISPOSABLE_H4_ATTENDANCE_DATABASE_URL: "postgresql://postgres@127.0.0.1:5612/central_studio_disposable_attendance",
      DISPOSABLE_H5_ATTENDANCE_DATABASE_URL: "postgresql://postgres@127.0.0.1:5612/central_studio_disposable_attendance",
      DISPOSABLE_BALLET_CLASS_DATABASE_URL: "postgresql://postgres@127.0.0.1:5602/central_studio_disposable_ballet_class?sslmode=disable",
      DISPOSABLE_BALLET_CLASS_LEGACY_DATABASE_URL: "postgresql://postgres@127.0.0.1:5602/central_studio_disposable_ballet_class_legacy?sslmode=disable",
      REDIS_URL: "redis://127.0.0.1:6389",
    };

    const targetSuites = [
      "./artifacts/api-server/src/lib/balletCancellationRouteIntegration.test.ts",
      "./artifacts/api-server/src/lib/balletMyClassesRouteIntegration.test.ts",
      "./artifacts/api-server/src/routes/adminBalletMultipleSchedules.integration.test.ts",
      "./artifacts/api-server/src/lib/balletAutoAbsence.integration.test.ts",
      "./artifacts/api-server/src/lib/balletAttendanceWrite.integration.test.ts",
      "./artifacts/api-server/src/lib/balletClassCanonicalDatabase.test.ts",
      "./artifacts/api-server/src/lib/balletClassCanonicalMigrationCompat.test.ts",
      "./artifacts/api-server/src/lib/balletAutoAbsenceBullMq.integration.test.ts",
      "./artifacts/api-server/src/lib/balletClassEntitlementInvariants.test.ts",
    ];

    const specificFiles = process.argv.slice(2);
    const suitesToRun = specificFiles.length > 0 ? specificFiles : targetSuites;

    let overallFailed = false;

    for (const suite of suitesToRun) {
      console.log(`\n==================================================`);
      console.log(`RUNNING DISPOSABLE SUITE: ${suite}`);
      console.log(`==================================================`);

      try {
        const fullSuitePath = resolve(rootDir, suite);
        const tsxExecutable = resolve(rootDir, "node_modules/.pnpm/node_modules/.bin/tsx");
        const tsxLoader = resolve(rootDir, "node_modules/.pnpm/node_modules/tsx/dist/loader.mjs");
        const requiresModuleMocks = readFileSync(fullSuitePath, "utf8").includes("mock.module(");
        const testCommand = requiresModuleMocks
          ? `"${process.execPath}" --experimental-test-module-mocks --import "${tsxLoader}" --test "${fullSuitePath}"`
          : `${tsxExecutable} --test "${fullSuitePath}"`;
        execSync(testCommand, {
          cwd: rootDir,
          env,
          stdio: "inherit",
        });
      } catch (err: any) {
        console.error(`✖ Catch in runner for ${suite}: status=${err?.status}, code=${err?.code}, msg=${err?.message}`);
        overallFailed = true;
      }
    }

    if (overallFailed) {
      process.exitCode = 1;
    } else {
      console.log("\n✔ ALL DISPOSABLE INTEGRATION SUITES PASSED CLEANLY!");
    }
  } finally {
    console.log("\n[Disposable Infra Cleanup] Tearing down temporary clusters...");
    if (pgProcess5602) {
      try { execSync(`${pgCtlBin} stop -D ${pgDir5602} -m immediate`, { stdio: "ignore" }); } catch {}
      pgProcess5602.kill("SIGKILL");
    }
    if (pgProcess5612) {
      try { execSync(`${pgCtlBin} stop -D ${pgDir5612} -m immediate`, { stdio: "ignore" }); } catch {}
      pgProcess5612.kill("SIGKILL");
    }
    if (redisProcess) {
      try { execSync(`${redisCliBin} -p 6389 shutdown`, { stdio: "ignore" }); } catch {}
      redisProcess.kill("SIGKILL");
    }
    rmSync(pgDir5602, { recursive: true, force: true });
    rmSync(pgDir5612, { recursive: true, force: true });
    rmSync(redisDir, { recursive: true, force: true });
    console.log("[Disposable Infra Cleanup] Teardown complete. Zero processes or temp data left behind.");
  }
}

main().catch((err) => {
  console.error("Fatal runner error:", err);
  process.exit(1);
});
