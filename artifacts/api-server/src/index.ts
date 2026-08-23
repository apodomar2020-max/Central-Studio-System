import app from "./app";
import { logger } from "./lib/logger";
import { initErrorMonitoring, captureError } from "./lib/errorMonitoring";
import { ensureProvenanceActivated } from "./lib/studentEmailChangeService";

await initErrorMonitoring();

// Phase B3B0-1A completion (T0 activation): establish (or confirm) the
// student-email-provenance T0 boundary before this API process starts
// accepting traffic. Fail-closed — if this DB write/read fails, the process
// must NOT start up successfully while silently having failed to establish
// T0 (mirrors this file's existing failed-listen handling below: log a
// critical error via the same errorMonitoring path and exit non-zero rather
// than serve traffic with provenance protection silently absent).
//
// This is API-only. The Worker process (src/worker.ts) is a separate entry
// point/process and must NEVER call this — Worker does not own student
// email provenance (grep confirms worker.ts has no student-email-mutation
// routes; it only runs background jobs).
//
// Deliberately distinct from IDENTITY_PROVENANCE_PEPPER, which stays LAZY
// (read only inside fingerprintStudentEmail at the moment of an actual
// email-identity mutation). That split is safe because T0 and the pepper
// protect different things: T0 is a structural fact ("when did this system
// start being able to prove anything") that must be established exactly
// once, deterministically, before ANY email-mutating request can be served
// — if it were lazy, two concurrent first-ever email changes on different
// students could race to establish two different app-level "first" T0
// values before the DB constraint arbitrates, and worse, a server that
// never received an email-mutating request would never even attempt to
// establish T0, leaving future T0-dependent logic (e.g. the pre-T0
// first-change fix) unable to assume T0 always already exists. The pepper,
// by contrast, is a plain secret with no ordering/single-writer requirement
// — requiring it at startup would just make local/dev boots that never
// touch provenance fail for no safety benefit, whereas failing THAT specific
// write closed at point-of-use already fully protects the data (no
// insecure fallback exists in fingerprintStudentEmail).
try {
  const t0 = await ensureProvenanceActivated();
  logger.info({ t0 }, "Student email provenance T0 activation confirmed");
} catch (err) {
  captureError(err, { task: "provenance_activation_startup" });
  logger.error({ err }, "Failed to establish student email provenance T0 activation at startup — refusing to start");
  process.exit(1);
}

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
