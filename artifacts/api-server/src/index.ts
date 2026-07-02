import app from "./app";
import { logger } from "./lib/logger";
import { initErrorMonitoring, captureError } from "./lib/errorMonitoring";
import { runMigrations } from "./lib/migrate";

await initErrorMonitoring();

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Run pending DB migrations before accepting traffic.
// This is safe to run on every startup — Drizzle only applies new migrations.
try {
  await runMigrations();
  logger.info("Database migrations up to date");
} catch (err) {
  captureError(err, { task: "startup_migrations" });
  logger.error({ err }, "Migration failed — aborting startup");
  process.exit(1);
}

app.listen(port, (err) => {
  if (err) {
    captureError(err, { task: "server_listen" });
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
