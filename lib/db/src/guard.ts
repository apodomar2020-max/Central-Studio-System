/**
 * Local safety guard — refuses to use a remote Railway database from a
 * developer machine.
 *
 * A DATABASE_URL pointing at Railway's public proxy (…proxy.rlwy.net) on a
 * local machine means every query, migration, and seed script hits
 * PRODUCTION data. This guard blocks that combination:
 *
 *   blocked  = Railway-looking DB host  AND  not running on Railway
 *              AND  ALLOW_REMOTE_DATABASE_LOCAL !== "true"
 *
 * On Railway itself (API, worker, preDeploy migration) the platform injects
 * RAILWAY_* environment variables, so the guard is a no-op there and never
 * affects deployments.
 *
 * Emergency override (dangerous — connects local tooling to remote data):
 *
 *   ALLOW_REMOTE_DATABASE_LOCAL=true
 */

const REMOTE_RAILWAY_HOST_PATTERN = /\.(rlwy\.net|railway\.app|railway\.internal)$/i;

function isRunningOnRailway(): boolean {
  return Boolean(
    process.env.RAILWAY_ENVIRONMENT ||
      process.env.RAILWAY_ENVIRONMENT_NAME ||
      process.env.RAILWAY_PROJECT_ID ||
      process.env.RAILWAY_SERVICE_ID,
  );
}

export function assertDatabaseUrlSafeOutsideRailway(databaseUrl: string): void {
  if (isRunningOnRailway()) return;

  let hostname: string;
  try {
    hostname = new URL(databaseUrl).hostname;
  } catch {
    // Unparseable URL — let the pg driver produce its own connection error.
    return;
  }

  if (!REMOTE_RAILWAY_HOST_PATTERN.test(hostname)) return;

  if (process.env.ALLOW_REMOTE_DATABASE_LOCAL === "true") {
    console.warn(
      `[db-guard] WARNING: ALLOW_REMOTE_DATABASE_LOCAL=true — connecting to remote Railway database "${hostname}" from outside Railway. Every query hits REMOTE (likely production) data. Unset this variable as soon as you are done.`,
    );
    return;
  }

  throw new Error(
    [
      `Refusing to use remote Railway database "${hostname}" from outside Railway.`,
      "",
      "DATABASE_URL points at a Railway host, but no RAILWAY_* environment",
      "variables are present, so this looks like a local machine. Running",
      "against this database would read/write PRODUCTION data.",
      "",
      "Fix: use a local Postgres database for development, e.g.",
      "  DATABASE_URL=postgresql://centralstudio_user:changeme@localhost:5432/centralstudio",
      "(see HOW_TO_RUN.md, Step 1).",
      "",
      "Emergency override (dangerous, for deliberate manual operations only):",
      "  ALLOW_REMOTE_DATABASE_LOCAL=true",
    ].join("\n"),
  );
}
