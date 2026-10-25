/** Local Mac operator only. No Railway environment/secret lookup or remote shell. */
import pg from "pg";
import { X509Certificate } from "node:crypto";
import { readFileSync, mkdtempSync, writeFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import type { ConnectionOptions } from "node:tls";
import {
  inventoryPromotionsOnClient,
  inventoryFailureMessage,
  serializeInventory,
} from "./promotionsInventory";

/** CA verification PLUS exact leaf pin, obtained through authenticated service Console.
 * No hostname alias: localhost is never asserted as the external proxy's identity.
 * Node verifies the CA chain/validity before invoking checkServerIdentity.
 */
export function pinnedInventoryTls(
  ca: string,
  serverCertificate: string,
): ConnectionOptions {
  const root = new X509Certificate(ca),
    leaf = new X509Certificate(serverCertificate);
  if (
    !root.ca ||
    leaf.ca ||
    !leaf.verify(root.publicKey) ||
    !leaf.checkIssued(root)
  )
    throw new Error("Service certificate pair is invalid");
  return {
    ca,
    rejectUnauthorized: true,
    minVersion: "TLSv1.2",
    checkServerIdentity: (_hostname, presented) =>
      presented.raw?.equals(leaf.raw)
        ? undefined
        : new Error("Service certificate pin mismatch"),
  };
}

export async function promptInventoryPassword(
  signal?: AbortSignal,
): Promise<string> {
  if (!process.stdin.isTTY || !process.stderr.isTTY)
    throw new Error("Private interactive terminal required");
  const muted = new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });
  const reader = createInterface({
    input: process.stdin,
    output: muted,
    terminal: true,
  });
  const cancelled = new AbortController();
  reader.once("SIGINT", () => cancelled.abort());
  reader.once("close", () => cancelled.abort());
  process.stderr.write(
    "PostgreSQL administrator password (private, no echo): ",
  );
  try {
    const password = await reader.question("", {
      signal: signal
        ? AbortSignal.any([signal, cancelled.signal])
        : cancelled.signal,
    });
    if (!password) throw new Error("Empty password refused");
    return password;
  } finally {
    reader.close();
    process.stderr.write("\n");
  }
}

export function saveInventoryReport(
  result: unknown,
  parent = homedir(),
): string {
  const output = serializeInventory(result);
  const directory = mkdtempSync(join(parent, ".central-promotions-inventory-"));
  const pending = join(directory, "inventory.pending.json");
  writeFileSync(pending, output, { flag: "wx", mode: 0o600 });
  const final = join(directory, "inventory.json");
  renameSync(pending, final);
  return final;
}

export async function runPinnedInventory(
  caPath: string,
  certificatePath: string,
) {
  if (!process.stdin.isTTY || !process.stderr.isTTY)
    throw new Error("Private interactive terminal required");
  const ssl = pinnedInventoryTls(
    readFileSync(caPath, "utf8"),
    readFileSync(certificatePath, "utf8"),
  );
  // Do not spend the five-second connection deadline waiting for human input.
  // Collect privately first; pg sends authentication only after verified TLS.
  const inputAbort = new AbortController();
  const inputDeadline = setTimeout(() => inputAbort.abort(), 120000);
  let password: string;
  try {
    password = await promptInventoryPassword(inputAbort.signal);
  } finally {
    clearTimeout(inputDeadline);
  }
  // Explicit fields: never consult application DATABASE_URL or a credential URL.
  const client = new pg.Client({
    host: "acela.proxy.rlwy.net",
    port: 54187,
    database: "railway",
    user: "postgres",
    password,
    ssl,
    connectionTimeoutMillis: 5000,
    application_name: "central-promotions-inventory",
    options:
      "-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=500 -c idle_in_transaction_session_timeout=15000",
  });
  // A finite whole-run deadline supplements per-statement/idle/connect bounds.
  // On expiry destroy this one
  // connection rather than querying a privileged cancellation endpoint.
  let expired = false;
  client.on("error", () => {
    expired = true;
  });
  const deadline = setTimeout(() => {
    expired = true;
    void client.end().catch(() => {});
  }, 120000);
  try {
    await client.connect();
    const result = await inventoryPromotionsOnClient(client, "railway");
    if (expired) throw new Error("Inventory whole-run deadline exceeded");
    return saveInventoryReport(result);
  } finally {
    clearTimeout(deadline);
    await client.end().catch(() => {});
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const args = process.argv.slice(2);
    if (
      args.length !== 4 ||
      args[0] !== "--approved-read-only-inventory" ||
      args[1] !== "--approved-pinned-admin-transport"
    )
      throw new Error(
        "Separate inventory and pinned administrator transport approval required",
      );
    process.stdout.write(
      `Complete inventory saved privately: ${await runPinnedInventory(args[2], args[3])}\n`,
    );
  } catch (error) {
    process.stderr.write(inventoryFailureMessage(error) + "\n");
    process.exitCode = 1;
  }
}
