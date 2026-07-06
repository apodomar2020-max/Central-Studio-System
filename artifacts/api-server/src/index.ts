import app from "./app";
import { logger } from "./lib/logger";
import { initErrorMonitoring, captureError } from "./lib/errorMonitoring";

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

// Migrations are NOT run here. They are an explicit deployment step:
// Railway runs `node artifacts/api-server/dist/migrate.mjs` as a
// preDeployCommand before this process starts (see railway.toml).
app.listen(port, (err) => {
  if (err) {
    captureError(err, { task: "server_listen" });
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
