#!/usr/bin/env node
/**
 * checkNoNativeAlert.js
 *
 * Source-level completeness guard for the CentralAlertProvider migration.
 * Fails the check if any Central Studio application source file introduces
 * a new direct call to React Native's native `Alert.alert(` / `Alert.prompt(`
 * outside the explicit allowlist below.
 *
 * Run manually or wire into CI:
 *   node scripts/checkNoNativeAlert.js
 *
 * Scope: artifacts/central application source only (app/, components/,
 * services/, hooks/, providers/, contexts/, utils/). Does NOT scan
 * node_modules, .expo, ios/, android/, static-build/, or any other
 * generated/build output — those are irrelevant to this migration and would
 * produce noise (e.g. vendored RN internals legitimately call Alert.alert).
 *
 * ── Allowlist ────────────────────────────────────────────────────────────
 * Kept intentionally minimal. Add an entry ONLY for a call site that is
 * unavoidably tied to an operating-system-owned interaction this migration
 * explicitly excludes (see CENTRAL_STUDIO_DESIGN_SYSTEM.md scope notes) —
 * e.g. a native permission/settings bridge that has no branded-dialog
 * equivalent. Every entry must include a one-line justification.
 *
 * Currently empty: every application-owned alert in this app has been
 * migrated to CentralAlertProvider (see providers/CentralAlertProvider.tsx).
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

const SCAN_DIRS = ["app", "components", "services", "hooks", "providers", "contexts", "utils"];

const EXCLUDED_DIR_NAMES = new Set([
  "node_modules",
  ".expo",
  "ios",
  "android",
  "static-build",
  "build",
  "Pods",
  ".git",
]);

/**
 * file (relative to artifacts/central) → justification.
 * @type {Record<string, string>}
 */
const ALLOWLIST = {
  // (empty — see file header)
};

const CALL_PATTERN = /\bAlert\.(alert|prompt)\s*\(/;

/** Strips // line comments and /* block comments *\/ so documentation that
 *  merely *mentions* `Alert.alert(` (e.g. this migration's own doc comments)
 *  doesn't trip the guard. Deliberately simple — good enough for this
 *  codebase's comment style, not a full TS parser. */
function stripComments(source) {
  let out = "";
  let i = 0;
  const n = source.length;
  while (i < n) {
    const two = source.slice(i, i + 2);
    if (two === "//") {
      const end = source.indexOf("\n", i);
      i = end === -1 ? n : end;
      continue;
    }
    if (two === "/*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (source[i] === "`" || source[i] === '"' || source[i] === "'") {
      const quote = source[i];
      let j = i + 1;
      while (j < n && source[j] !== quote) {
        if (source[j] === "\\") j += 1;
        j += 1;
      }
      out += source.slice(i, Math.min(j + 1, n));
      i = j + 1;
      continue;
    }
    out += source[i];
    i += 1;
  }
  return out;
}

function walk(dir, files) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".test.tsx")) {
      files.push(full);
    }
  }
  return files;
}

function main() {
  const files = [];
  for (const dir of SCAN_DIRS) {
    const abs = path.join(ROOT, dir);
    if (fs.existsSync(abs)) walk(abs, files);
  }

  const violations = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file);
    const source = fs.readFileSync(file, "utf8");
    // Comment/string stripping is deliberately applied to code lookup only —
    // the string-literal branch above still preserves template/string
    // contents verbatim so a real `Alert.alert(` call is never hidden by
    // being (unusually) written inside a string; it's the comment stripping
    // that matters here.
    const codeOnly = stripComments(source);
    const lines = codeOnly.split("\n");
    lines.forEach((line, idx) => {
      if (CALL_PATTERN.test(line)) {
        if (ALLOWLIST[rel]) return; // allowlisted file — justification lives above
        violations.push({ file: rel, line: idx + 1, text: line.trim() });
      }
    });
  }

  if (violations.length > 0) {
    console.error("\n✗ Native Alert.alert()/Alert.prompt() usage found outside the CentralAlertProvider migration:\n");
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}  ${v.text}`);
    }
    console.error(
      "\nUse useCentralAlert() (components/hooks) or presentCentralAlert() (non-component utility\n" +
        "modules) from providers/CentralAlertProvider.tsx instead. If this call site is genuinely\n" +
        "unavoidable (an OS-owned interaction), add it to ALLOWLIST in scripts/checkNoNativeAlert.js\n" +
        "with a one-line justification.\n",
    );
    process.exitCode = 1;
    return;
  }

  console.log(`✓ No direct native Alert usage found (scanned ${files.length} files).`);
}

main();
