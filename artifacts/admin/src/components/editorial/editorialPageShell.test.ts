/**
 * Wave 2.1A — EditorialPageShell contract.
 *
 * Source-inspection style (the component is `@/`-aliased JSX, which plain
 * node:test cannot execute), matching pages/branches.test.ts.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Read as source rather than imported: the module pulls in a CSS side-effect
// import, which node:test cannot resolve outside a Vite bundle.
const shell = readFileSync(new URL("./editorial-page-shell.tsx", import.meta.url), "utf8");

test("the shell has no persistent Editorial authority banner", () => {
  assert.doesNotMatch(shell, /EDITORIAL_COEXISTENCE_NOTICE|editorial-coexistence-banner|noticeDismissed/);
  assert.doesNotMatch(shell, /role="status"/);
  assert.doesNotMatch(shell, /<div[^>]*onClick/, "no clickable divs");
});

test("the shell keeps children, optional context, and actions independent of navigation", () => {
  assert.match(shell, /\{children\}/);
  assert.match(shell, /\{\(heading \|\| description \|\| actions\) && \(/);
  // No navigation, layout or global concern is touched here.
  // Strip all comments: they name the TopBar when explaining page-identity
  // ownership, but the code itself must not reach for it.
  const code = shell.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /Sidebar|TopBar|NAV_TREE|nav-config|localStorage|useLocation/);
});

test("it uses the same Admin 2.0 page wrapper and CSS convention as the existing CMS pages", () => {
  assert.match(shell, /className="admin2-final-page admin2-cms-workspace admin2-editorial space-y-6"/);
  assert.match(shell, /import "@\/pages\/admin2-final\.css";/);
});

test("the shell holds no business logic", () => {
  assert.doesNotMatch(shell, /useQuery|useMutation|@workspace\/api-client-react|fetch\(/);
});
