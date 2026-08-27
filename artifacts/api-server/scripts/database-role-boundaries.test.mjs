import assert from "node:assert/strict";
import test from "node:test";

import {
  createRuntimeEnvironment,
  resolveMigrationDatabaseUrl,
} from "./database-role-boundaries.mjs";

test("Railway migrations require the dedicated migration credential", () => {
  assert.throws(
    () =>
      resolveMigrationDatabaseUrl({
        DATABASE_URL: "postgresql://runtime.invalid/railway",
        RAILWAY_ENVIRONMENT: "production",
      }),
    /MIGRATION_DATABASE_URL must be set/,
  );
});

test("Railway migrations use the dedicated migration credential", () => {
  const migrationUrl = "postgresql://migrator.invalid/railway";

  assert.equal(
    resolveMigrationDatabaseUrl({
      DATABASE_URL: "postgresql://runtime.invalid/railway",
      MIGRATION_DATABASE_URL: migrationUrl,
      RAILWAY_SERVICE_ID: "api",
    }),
    migrationUrl,
  );
});

test("local migrations retain the DATABASE_URL fallback", () => {
  const localUrl = "postgresql://localhost/central_studio_test";
  assert.equal(
    resolveMigrationDatabaseUrl({ DATABASE_URL: localUrl }),
    localUrl,
  );
});

test("runtime child receives no migration credential", () => {
  const sourceEnv = {
    DATABASE_URL: "postgresql://runtime.invalid/railway",
    MIGRATION_DATABASE_URL: "postgresql://migrator.invalid/railway",
    QUEUE_WORKER_ENABLED: "false",
  };

  const runtimeEnv = createRuntimeEnvironment(sourceEnv);

  assert.equal(runtimeEnv.DATABASE_URL, sourceEnv.DATABASE_URL);
  assert.equal(runtimeEnv.MIGRATION_DATABASE_URL, undefined);
  assert.equal(
    sourceEnv.MIGRATION_DATABASE_URL,
    "postgresql://migrator.invalid/railway",
  );
});
