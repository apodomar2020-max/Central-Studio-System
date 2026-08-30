/**
 * Expo Go compatibility guard for the Sign In / Sign Up route modules.
 *
 * THE BUG THIS LOCKS DOWN
 *
 * `hooks/useFacebookSignIn.ts` imported `react-native-fbsdk-next` at module
 * scope. That module is a CUSTOM native module (config plugin, see
 * app.config.js) present only in binaries we build — never in Expo Go — and
 * it throws while being evaluated when the native side is absent.
 *
 * The hook is imported by `app/auth/login.tsx` and `app/auth/register.tsx`
 * and by NOTHING else, so under Expo Go exactly those two route modules
 * failed to evaluate, Expo Router could not read their default export, and
 * it rendered `app/+not-found.tsx` — "This screen doesn't exist" — on Sign
 * In and Sign Up only, while every other screen worked. Android was fine
 * because it runs a real EAS build with the SDK compiled in.
 *
 * These are static-source assertions rather than a rendering harness on
 * purpose: the defect is about WHEN a module is evaluated, which is a
 * property of the import graph, not of any rendered output. A React test
 * renderer would have to already have loaded the module to observe it —
 * exactly the thing that must not happen.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const MOBILE = join(process.cwd(), "artifacts", "central");
const read = (p: string) => readFileSync(join(MOBILE, p), "utf8");

/** Strips block/line comments so doc-comment prose can't satisfy a check. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Top-level `import ... from "<mod>"` (the form that runs on evaluation). */
function hasStaticImport(src: string, mod: string): boolean {
  return new RegExp(`^\\s*import\\s[^;]*?from\\s+["']${mod.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&")}["']`, "m").test(code(src));
}

const FBSDK = "react-native-fbsdk-next";

// ─── 1 & 2: the two route modules must not pull FBSDK in on evaluation ──────

test("1: app/auth/login.tsx does not statically import the Facebook native SDK", () => {
  assert.equal(hasStaticImport(read("app/auth/login.tsx"), FBSDK), false);
});

test("2: app/auth/register.tsx does not statically import the Facebook native SDK", () => {
  assert.equal(hasStaticImport(read("app/auth/register.tsx"), FBSDK), false);
});

test("1+2 (transitive): no module reachable from the auth routes' own imports statically imports FBSDK", () => {
  // The original bug was one level deep (route -> hook -> fbsdk), which a
  // direct-import check alone would have missed. Walk the local `@/` graph.
  const seen = new Set<string>();
  const offenders: string[] = [];

  function resolve(spec: string): string | null {
    if (!spec.startsWith("@/")) return null;
    const base = spec.slice(2);
    for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
      try { readFileSync(join(MOBILE, base + ext), "utf8"); return base + ext; } catch { /* next */ }
    }
    return null;
  }

  function walk(rel: string) {
    if (seen.has(rel)) return;
    seen.add(rel);
    let src: string;
    try { src = read(rel); } catch { return; }
    if (hasStaticImport(src, FBSDK)) offenders.push(rel);
    for (const m of code(src).matchAll(/^\s*import\s[^;]*?from\s+["'](@\/[^"']+)["']/gm)) {
      const next = resolve(m[1]);
      if (next) walk(next);
    }
  }

  walk("app/auth/login.tsx");
  walk("app/auth/register.tsx");

  assert.deepEqual(offenders, [], `module(s) statically importing ${FBSDK}: ${offenders.join(", ")}`);
  assert.ok(seen.has("hooks/useFacebookSignIn.ts"), "sanity: the walk must actually reach the Facebook hook");
});

// ─── 3 & 4: Expo Go must not initialize the SDK, and must fail gracefully ───

test("3: the SDK loader is guarded by Expo Go detection and never evaluates FBSDK at import time", () => {
  const src = read("services/facebookSdk.ts");
  const c = code(src);
  assert.equal(hasStaticImport(src, FBSDK), false, "loader must not statically import the SDK");
  assert.match(c, /require\(\s*["']react-native-fbsdk-next["']\s*\)/, "SDK must be resolved via a deferred require");
  assert.match(c, /appOwnership\s*===\s*["']expo["']/, "must use the project's Expo Go detection");
  // The require must be inside a function body, not at module top level.
  const requireLine = c.split("\n").findIndex((l) => l.includes('require("react-native-fbsdk-next")'));
  const before = c.split("\n").slice(0, requireLine).join("\n");
  assert.ok(/function\s+loadFacebookSdk/.test(before), "the require must sit inside loadFacebookSdk()");
  assert.match(c, /try\s*\{/, "the require must be wrapped in try/catch");
});

test("4: the Facebook action is unavailable and graceful in Expo Go (no throw, no fake login)", () => {
  const hook = code(read("hooks/useFacebookSignIn.ts"));
  assert.match(hook, /const\s+sdk\s*=\s*loadFacebookSdk\(\)/, "signIn must resolve the SDK lazily");
  assert.match(hook, /if\s*\(!sdk\)/, "signIn must bail out when the SDK is unavailable");
  assert.match(hook, /available:\s*sdkAvailable/, "hook must expose `available` for the UI");
  // No browser/implicit-flow fallback smuggled in as a "fix".
  assert.equal(/expo-auth-session[^"']*facebook/i.test(hook), false, "must not fall back to a web OAuth flow");
});

test("4b: both auth screens disable the Facebook button when the SDK is unavailable", () => {
  for (const screen of ["app/auth/login.tsx", "app/auth/register.tsx"]) {
    const c = code(read(screen));
    assert.match(c, /disabled=\{facebook\.loading \|\| !facebook\.available\}/,
      `${screen} must disable the Facebook button when unavailable`);
  }
});

// ─── 5: real native builds must still use the real SDK ──────────────────────

test("5: a compatible native build still invokes the real FBSDK implementation", () => {
  const hook = code(read("hooks/useFacebookSignIn.ts"));
  assert.match(hook, /sdk\.LoginManager\.logInWithPermissions\(\s*\["public_profile",\s*"email"\]\s*\)/,
    "native path must still call LoginManager with the same permissions");
  assert.match(hook, /sdk\.AccessToken\.getCurrentAccessToken\(\)/,
    "native path must still read the access token from the SDK");
  // The backend contract must be untouched.
  assert.match(hook, /\/api\/auth\/facebook/, "still exchanges the provider token with the same backend route");
  assert.match(hook, /JSON\.stringify\(\{\s*accessToken\s*\}\)/, "request body shape unchanged");
  // The dependency itself must remain installed for real builds.
  const pkg = JSON.parse(read("package.json"));
  assert.ok(pkg.dependencies[FBSDK], "react-native-fbsdk-next must remain a dependency");
});

// ─── 6: Google audited for the same class of defect ─────────────────────────

test("6: Google sign-in uses expo-auth-session (bundled in Expo Go), so it needs no deferral", () => {
  const src = read("hooks/useGoogleSignIn.ts");
  assert.equal(hasStaticImport(src, FBSDK), false);
  assert.ok(
    hasStaticImport(src, "expo-auth-session/providers/google"),
    "Google must keep using expo-auth-session, which Expo Go ships",
  );
  // Guard against a future migration to a custom native Google SDK silently
  // reintroducing the exact bug this file exists to prevent.
  for (const custom of ["@react-native-google-signin/google-signin", "react-native-fbsdk-next"]) {
    assert.equal(hasStaticImport(src, custom), false, `Google hook must not statically import ${custom}`);
  }
});
