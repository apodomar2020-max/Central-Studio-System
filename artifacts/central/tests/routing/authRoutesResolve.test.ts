/**
 * Expo Router auth-route resolution guard.
 *
 * Android Preview regression (build dce0b92d, source 5eb3671): Sign In and
 * Sign Up rendered `app/+not-found.tsx` ("This screen doesn't exist") on a
 * real device. That turned out NOT to be a source-routing defect — but the
 * class of defect it looked like is real, silent, and easy to reintroduce:
 *
 *   - a navigation target string that no route file backs
 *   - a route file renamed/moved without updating its callers
 *   - a CASING mismatch that works on the developers' case-insensitive
 *     macOS filesystem and breaks on the case-sensitive Linux EAS builders
 *
 * None of those are caught by `tsc` (every target is cast or typed as a
 * loose string somewhere), by lint, or by a successful bundle — the app
 * builds fine and only fails at the moment a user taps the button.
 *
 * This test reconstructs the Expo Router route table from the real `app/`
 * directory the same way the bundler's `require.context` does, then checks
 * every literal navigation target in the codebase against it, comparing
 * paths BYTE-FOR-BYTE (case-sensitive) regardless of host filesystem.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

const MOBILE_ROOT = join(process.cwd(), "artifacts", "central");
const APP_DIR = join(MOBILE_ROOT, "app");

/** Directories whose contents are never Expo Router routes. */
const SCAN_DIRS = ["app", "components", "hooks", "services", "utils", "contexts", "providers"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * Case-sensitive existence check. `statSync` on macOS happily resolves
 * `app/auth/Login.tsx` for a file actually named `login.tsx`, which is
 * exactly the bug this test exists to catch — so the real filenames are
 * read from Git, which stores the true byte-for-byte case, and every
 * comparison below is done against that set.
 */
function gitTrackedAppFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "artifacts/central/app"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  return out.split("\n").filter((l) => l.endsWith(".tsx") || l.endsWith(".ts"));
}

/**
 * Maps a route FILE to the URL path Expo Router serves it at:
 *   app/auth/login.tsx        -> /auth/login
 *   app/index.tsx             -> /
 *   app/(tabs)/profile.tsx    -> /(tabs)/profile  AND  /profile   (groups are
 *                                transparent in the URL, but router.push()
 *                                accepts the explicit group form too)
 *   app/class/[id].tsx        -> /class/[id]      (dynamic — matched loosely)
 * Files starting with `+` (+not-found, +native-intent) and `_layout` are not
 * navigable routes.
 */
function routePathsForFile(repoRelPath: string): string[] {
  const rel = repoRelPath.replace(/^artifacts\/central\/app\//, "").replace(/\.tsx?$/, "");
  const base = rel.split("/").pop()!;
  if (base.startsWith("+") || base === "_layout") return [];

  const withGroups = "/" + rel;
  const paths = new Set<string>();
  paths.add(withGroups.replace(/\/index$/, "") || "/");
  // Group segments like `(tabs)` are invisible in the served URL.
  const withoutGroups = withGroups.replace(/\/\([^)]+\)/g, "");
  paths.add(withoutGroups.replace(/\/index$/, "") || "/");
  return [...paths].map((p) => (p === "" ? "/" : p));
}

const ROUTE_FILES = gitTrackedAppFiles();
const ROUTE_PATHS = new Set<string>(ROUTE_FILES.flatMap(routePathsForFile));

/** A dynamic route `/class/[id]` should accept `/class/123`. */
function resolves(target: string): boolean {
  const path = target.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  if (ROUTE_PATHS.has(path)) return true;
  const segs = path.split("/");
  for (const candidate of ROUTE_PATHS) {
    const cs = candidate.split("/");
    if (cs.length !== segs.length) continue;
    if (cs.every((c, i) => c === segs[i] || /^\[.+\]$/.test(c))) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────

test("the five auth entry routes exist with exact lowercase filenames", () => {
  // Spelled out literally rather than derived, so a rename/recase of any of
  // these fails here loudly instead of silently redefining what's "correct".
  const required = [
    "artifacts/central/app/auth/login.tsx",
    "artifacts/central/app/auth/register.tsx",
    "artifacts/central/app/auth/forgot-password.tsx",
    "artifacts/central/app/auth/reset-password.tsx",
    "artifacts/central/app/verify-email.tsx",
  ];
  for (const f of required) {
    assert.ok(ROUTE_FILES.includes(f), `missing (or wrongly cased) route file: ${f}`);
  }
});

test("Sign In and Sign Up navigation targets resolve to real routes", () => {
  for (const target of ["/auth/login", "/auth/register"]) {
    assert.ok(resolves(target), `${target} does not resolve to any route file`);
  }
});

test("sibling auth routes (forgot/reset password, OTP verify) resolve too", () => {
  for (const target of ["/auth/forgot-password", "/auth/reset-password", "/auth/complete-profile", "/verify-email"]) {
    assert.ok(resolves(target), `${target} does not resolve to any route file`);
  }
});

test("every literal navigation target in the app resolves to an existing route", () => {
  const files = SCAN_DIRS.flatMap((d) => {
    const dir = join(MOBILE_ROOT, d);
    try { return walk(dir); } catch { return []; }
  }).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));

  // router.push("/x") | router.replace('/x') | href="/x" | href={"/x"}
  const NAV = /(?:router\.(?:push|replace|navigate)\(\s*|href\s*=\s*\{?\s*)["'`](\/[^"'`\s${}]*)["'`]/g;
  const failures: string[] = [];

  for (const file of files) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(NAV)) {
      const target = m[1];
      // Bare "/" is the root redirect; template literals with ${} are skipped
      // by the regex above since they can't be statically resolved here.
      if (!resolves(target)) {
        failures.push(`${relative(MOBILE_ROOT, file)} -> ${target}`);
      }
    }
  }

  assert.deepEqual(failures, [], `unresolvable navigation target(s):\n  ${failures.join("\n  ")}`);
});

test("no two route files differ only by case (breaks case-sensitive EAS builders)", () => {
  const seen = new Map<string, string>();
  const collisions: string[] = [];
  for (const f of ROUTE_FILES) {
    const key = f.toLowerCase();
    const prev = seen.get(key);
    if (prev && prev !== f) collisions.push(`${prev} vs ${f}`);
    else seen.set(key, f);
  }
  assert.deepEqual(collisions, [], `case-colliding route files: ${collisions.join(", ")}`);
});
