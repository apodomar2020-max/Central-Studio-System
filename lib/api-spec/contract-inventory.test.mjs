/**
 * Permanent contract/inventory regression tests.
 *
 * These exist because the repository previously drifted into a state where
 * `openapi.yaml` no longer described operations that Admin and Central were
 * still importing generated hooks for. The stale committed generated files
 * masked the drift, so nothing failed until codegen was re-run — at which
 * point valid, actively-used hooks silently disappeared.
 *
 * Each test below fails loudly on one specific way that drift can come back.
 * They are deliberately structural (symbol presence / operationId identity),
 * never formatting-sensitive, so ordinary regeneration or prettier changes
 * cannot make them flap.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");

const OPENAPI = path.join(REPO, "lib", "api-spec", "openapi.yaml");
const GENERATED_CLIENT = path.join(REPO, "lib", "api-client-react", "src", "generated", "api.ts");
const GENERATED_ZOD = path.join(REPO, "lib", "api-zod", "src", "generated", "api.ts");
const ZOD_INDEX = path.join(REPO, "lib", "api-zod", "src", "index.ts");
const CONSUMER_ROOTS = [
  path.join(REPO, "artifacts", "admin"),
  path.join(REPO, "artifacts", "central"),
];

// ---------------------------------------------------------------------------
// Helpers — intentionally tiny and dependency-free so this test can never be
// the reason codegen or CI breaks.
// ---------------------------------------------------------------------------

/** Every `export const|function|interface|type NAME` in a generated file. */
function exportedSymbols(file) {
  const src = readFileSync(file, "utf8");
  const names = new Set();
  const re = /export\s+(?:declare\s+)?(?:const|function|interface|type|enum)\s+([A-Za-z0-9_$]+)/g;
  let m;
  while ((m = re.exec(src)) !== null) names.add(m[1]);
  return names;
}

/** Recursively collect .ts/.tsx files, skipping node_modules and build output. */
function sourceFiles(root) {
  const out = [];
  const skip = new Set(["node_modules", "dist", "build", ".expo", ".next", "generated"]);
  (function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (skip.has(entry) || entry.startsWith(".")) continue;
      const full = path.join(dir, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry)) out.push(full);
    }
  })(root);
  return out;
}

/**
 * Symbols imported from the generated client package by real app code.
 * Handles `import {...}`, `import type {...}`, inline `type` specifiers and
 * `as` aliases — the alias's *source* name is what must exist.
 */
function importedFromClientPackage(root) {
  const found = new Map(); // symbol -> Set(files)
  const importRe = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']@workspace\/api-client-react["']/g;
  for (const file of sourceFiles(root)) {
    const src = readFileSync(file, "utf8");
    let m;
    while ((m = importRe.exec(src)) !== null) {
      for (const raw of m[1].split(",")) {
        const name = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
        if (!name) continue;
        if (!found.has(name)) found.set(name, new Set());
        found.get(name).add(path.relative(REPO, file));
      }
    }
  }
  return found;
}

/**
 * operationIds from openapi.yaml. Parsed with a line scanner rather than a
 * YAML dependency so this test adds no install surface; `operationId:` is
 * always written as a plain scalar in this spec.
 */
function operationIds() {
  const src = readFileSync(OPENAPI, "utf8");
  const ids = [];
  for (const line of src.split("\n")) {
    const m = /^\s*operationId:\s*([A-Za-z0-9_]+)\s*$/.exec(line);
    if (m) ids.push(m[1]);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// 1. Active generated-import inventory
// ---------------------------------------------------------------------------

/**
 * Names the package re-exports from hand-written modules rather than from
 * generated output. They are legitimately absent from generated/api.ts.
 */
const PACKAGE_MANUAL_EXPORTS = new Set([
  "customFetch",
  "setBaseUrl",
  "setAuthTokenGetter",
  "setAdminTokenGetter",
  "normalizeMediaUrl",
  "extractGoogleDriveFileId",
  "isYouTubeUrl",
  "AuthTokenGetter",
  "CustomFetchOptions",
  "ErrorType",
  "BodyType",
]);

test("every generated symbol imported by Admin/Central exists in the generated client", () => {
  const generated = exportedSymbols(GENERATED_CLIENT);
  const missing = [];

  for (const root of CONSUMER_ROOTS) {
    for (const [symbol, files] of importedFromClientPackage(root)) {
      if (PACKAGE_MANUAL_EXPORTS.has(symbol)) continue;
      if (!generated.has(symbol)) {
        missing.push(`${symbol}  (imported by ${[...files].sort().join(", ")})`);
      }
    }
  }

  assert.deepEqual(
    missing,
    [],
    `Generated client is missing symbols that live app code imports.\n` +
      `Either the OpenAPI operation was dropped, or codegen regressed.\n` +
      missing.map((m) => `  - ${m}`).join("\n"),
  );
});

test("the inventory scan actually found consumers (guards against a silently empty scan)", () => {
  // A bug in the file walker would make the test above vacuously pass, so
  // assert the scan has real signal before trusting a green result.
  const total = CONSUMER_ROOTS.reduce((n, root) => n + importedFromClientPackage(root).size, 0);
  assert.ok(total > 20, `expected many imported symbols across Admin+Central, found ${total}`);
});

// ---------------------------------------------------------------------------
// 2. OpenAPI operation integrity
// ---------------------------------------------------------------------------

test("openapi.yaml has no duplicate operationIds", () => {
  const ids = operationIds();
  const seen = new Set();
  const dupes = new Set();
  for (const id of ids) {
    if (seen.has(id)) dupes.add(id);
    seen.add(id);
  }
  assert.deepEqual([...dupes], [], `duplicate operationIds in openapi.yaml: ${[...dupes].join(", ")}`);
  assert.ok(ids.length > 0, "no operationIds parsed — the spec or this scanner is broken");
});

test("critical active operations remain defined in openapi.yaml", () => {
  // Each of these backs a hook that live Admin or Central code calls. They
  // were all absent from the spec at one point while still being imported.
  const REQUIRED = [
    "getMyAttendance",
    "getMyCredits",
    "getMyPackages",
    "listCreditTransactions",
    "listDanceTypes",
    "checkInQr",
    "createBooking",
    "updateBooking",
    "deleteBooking",
  ];
  const ids = new Set(operationIds());
  const missing = REQUIRED.filter((id) => !ids.has(id));
  assert.deepEqual(missing, [], `openapi.yaml lost active operations: ${missing.join(", ")}`);
});

test("each operationId yields a callable hook in the generated client", () => {
  // Guards the Orval "split mode drops mutation hooks" regression class:
  // the spec can be perfect while generation silently omits the use* wrapper.
  const generated = exportedSymbols(GENERATED_CLIENT);
  const missing = operationIds()
    .map((id) => `use${id[0].toUpperCase()}${id.slice(1)}`)
    .filter((hook) => !generated.has(hook));
  assert.deepEqual(missing, [], `operations with no generated React Query hook: ${missing.join(", ")}`);
});

// ---------------------------------------------------------------------------
// 3. Attendance parser preservation
// ---------------------------------------------------------------------------

test("generated Zod preserves the Attendance record fields", () => {
  const zod = readFileSync(GENERATED_ZOD, "utf8");
  for (const field of ["program", "durationMinutes"]) {
    assert.ok(zod.includes(field), `generated Zod parser dropped Attendance.${field}`);
  }
});

test("generated Zod preserves every Attendance Stats counter", () => {
  const zod = readFileSync(GENERATED_ZOD, "utf8");
  const COUNTERS = [
    "checkedInCount",
    "lateCount",
    "absentCount",
    "cancelledCount",
    "studioCreditsConsumed",
    "balletMinutesConsumed",
  ];
  const missing = COUNTERS.filter((c) => !zod.includes(c));
  assert.deepEqual(missing, [], `generated Zod parser dropped Attendance Stats counters: ${missing.join(", ")}`);
});

test("Attendance fields are also present in the generated TypeScript client", () => {
  const client = readFileSync(GENERATED_CLIENT, "utf8");
  for (const field of ["program", "durationMinutes", "checkedInCount", "balletMinutesConsumed"]) {
    assert.ok(client.includes(field), `generated client dropped ${field}`);
  }
});

// ---------------------------------------------------------------------------
// 4. Zod barrel safety
// ---------------------------------------------------------------------------

test("the api-zod barrel still re-exports the generated module and every manual module", () => {
  const index = readFileSync(ZOD_INDEX, "utf8");
  const REQUIRED_EXPORTS = [
    "./generated/api",
    "./ballet",
    "./balletCancellation",
    "./permissions",
    "./qr-attendance",
  ];
  const missing = REQUIRED_EXPORTS.filter((mod) => !index.includes(mod));
  assert.deepEqual(
    missing,
    [],
    `codegen truncated lib/api-zod/src/index.ts — lost re-exports: ${missing.join(", ")}`,
  );
});

test("the stricter hand-written request schemas stay authoritative over generated ones", () => {
  // These four names are emitted by BOTH the generated client and
  // ./qr-attendance. The hand-written versions encode constraints the spec
  // cannot express (qrToken must be a UUID, ids must be positive ints) and
  // the backend relies on them at the request boundary, so the barrel must
  // keep resolving the ambiguity in their favour.
  const index = readFileSync(ZOD_INDEX, "utf8");
  const explicit = /export\s*\{([^}]*)\}\s*from\s*["']\.\/qr-attendance["']/.exec(index);
  assert.ok(explicit, "expected an explicit re-export block from './qr-attendance' to resolve TS2308");
  for (const name of [
    "CheckInQrBody",
    "CheckInQrResponse",
    "ListCreditTransactionsQueryParams",
    "ListCreditTransactionsResponse",
  ]) {
    assert.ok(explicit[1].includes(name), `${name} must be explicitly re-exported from ./qr-attendance`);
  }
});
