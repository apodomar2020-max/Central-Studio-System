/**
 * Standalone child-process script for B3B0-1A process-level startup proof.
 *
 * This imports the REAL production function `ensureProvenanceActivated`
 * from studentEmailChangeService.ts (unmodified) and calls it exactly the
 * same way src/index.ts does at startup, then prints a marker and exits.
 * This file is NOT imported by index.ts or app.ts — it is only ever
 * invoked via `node`/`tsx` as a genuine separate OS process by the
 * process-level tests, mirroring index.ts's own try/catch/exit(1) shape.
 */
import { ensureProvenanceActivated } from "./studentEmailChangeService";

try {
  const t0 = await ensureProvenanceActivated();
  // eslint-disable-next-line no-console
  console.log(`READY_TO_LISTEN t0=${t0}`);
  process.exit(0);
} catch (err) {
  // eslint-disable-next-line no-console
  console.error("STARTUP_FATAL", err instanceof Error ? err.message : err);
  process.exit(1);
}
