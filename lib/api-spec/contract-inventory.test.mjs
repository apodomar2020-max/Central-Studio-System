import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ensureGeneratedExport, REQUIRED_LINE } from "./ensure-zod-index-export.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const openapi = readFileSync(path.join(here, "openapi.yaml"), "utf8");
const generatedClient = readFileSync(
  path.join(repo, "lib", "api-client-react", "src", "generated", "api.ts"),
  "utf8",
);
const generatedSchemas = readFileSync(
  path.join(repo, "lib", "api-client-react", "src", "generated", "api.schemas.ts"),
  "utf8",
);

function sourceFiles(root) {
  const files = [];
  const skip = new Set([
    "node_modules", "dist", "build", ".expo", ".next", "generated",
    "ios", "android",
  ]);
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (skip.has(entry) || entry.startsWith(".")) continue;
      const full = path.join(dir, entry);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry)) files.push(full);
    }
  };
  walk(root);
  return files;
}

function exportedSymbols(source) {
  return new Set(
    [...source.matchAll(/export\s+(?:declare\s+)?(?:const|function|interface|type|enum)\s+([A-Za-z0-9_$]+)/g)]
      .map((match) => match[1]),
  );
}

test("all Admin and Central generated-package imports still exist", () => {
  const exports = new Set([
    ...exportedSymbols(generatedClient),
    ...exportedSymbols(generatedSchemas),
  ]);
  const manual = new Set([
    "customFetch", "setBaseUrl", "setAuthTokenGetter", "setAdminTokenGetter",
    "normalizeMediaUrl", "extractGoogleDriveFileId", "isYouTubeUrl",
    "AuthTokenGetter", "CustomFetchOptions", "ErrorType", "BodyType",
  ]);
  const missing = [];
  for (const rootName of ["admin", "central"]) {
    for (const file of sourceFiles(path.join(repo, "artifacts", rootName))) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(
        /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']@workspace\/api-client-react["']/g,
      )) {
        for (const raw of match[1].split(",")) {
          const name = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
          if (name && !manual.has(name) && !exports.has(name)) {
            missing.push(`${name}:${path.relative(repo, file)}`);
          }
        }
      }
    }
  }
  assert.deepEqual(missing, []);
});

test("operation IDs are unique and each produces a generated React Query hook", () => {
  const ids = [...openapi.matchAll(/^\s*operationId:\s*([A-Za-z0-9_]+)\s*$/gm)]
    .map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  const missing = ids.filter((id) => {
    const hook = `use${id[0].toUpperCase()}${id.slice(1)}`;
    return !generatedClient.includes(hook);
  });
  assert.deepEqual(missing, []);
});

test("critical reconciled operations and Phase B catalogue schemas remain canonical", () => {
  for (const name of [
    "listStudents", "listDanceTypes", "checkInQr", "listCreditTransactions",
    "adjustCredits", "getMyPackages", "getMyCredits", "getMyAttendance",
    "CatalogueEligibility", "CatalogueConfigurationState", "ageRangeLabel",
    "allowAllAges", "minAge", "maxAge", "allowedDanceTypeIds",
  ]) {
    assert.ok(openapi.includes(name), `openapi.yaml is missing ${name}`);
  }
});

test("the non-destructive Zod barrel helper is idempotent", () => {
  const original = "export * from './ballet';\n";
  const once = ensureGeneratedExport(original);
  assert.ok(once.includes(REQUIRED_LINE));
  assert.equal(ensureGeneratedExport(once), once);
  assert.ok(once.includes("./ballet"));
});
