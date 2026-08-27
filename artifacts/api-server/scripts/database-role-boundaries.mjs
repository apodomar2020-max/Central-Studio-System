const RAILWAY_ENVIRONMENT_KEYS = [
  "RAILWAY_ENVIRONMENT",
  "RAILWAY_ENVIRONMENT_NAME",
  "RAILWAY_PROJECT_ID",
  "RAILWAY_SERVICE_ID",
];

export function isRailwayEnvironment(env) {
  return RAILWAY_ENVIRONMENT_KEYS.some((key) => Boolean(env[key]));
}

export function resolveMigrationDatabaseUrl(env) {
  if (env.MIGRATION_DATABASE_URL) {
    return env.MIGRATION_DATABASE_URL;
  }

  if (isRailwayEnvironment(env)) {
    throw new Error(
      "MIGRATION_DATABASE_URL must be set for Railway API migrations.",
    );
  }

  if (env.DATABASE_URL) {
    return env.DATABASE_URL;
  }

  throw new Error(
    "MIGRATION_DATABASE_URL or DATABASE_URL must be set before running migrations.",
  );
}

export function createRuntimeEnvironment(env) {
  const runtimeEnv = { ...env };
  delete runtimeEnv.MIGRATION_DATABASE_URL;
  return runtimeEnv;
}
