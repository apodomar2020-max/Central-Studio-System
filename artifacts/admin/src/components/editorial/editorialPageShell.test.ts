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

test("the banner text is exactly the approved coexistence wording", () => {
  assert.match(
    shell,
    /export const EDITORIAL_COEXISTENCE_NOTICE =\n\s+"The public website still reads the existing News and Performance sections\. Content published here is not live yet\.";/,
  );
});

test("the banner renders by default and is announced as a status", () => {
  assert.match(shell, /const \[noticeDismissed, setNoticeDismissed\] = useState\(false\);/);
  assert.match(shell, /\{!noticeDismissed && \(/);
  assert.match(shell, /role="status"/);
  assert.match(shell, /\{EDITORIAL_COEXISTENCE_NOTICE\}/);
});

test("the banner is dismissible from a real, keyboard-reachable, labelled button", () => {
  assert.match(shell, /<Button\n\s+type="button"/);
  assert.match(shell, /aria-label="Dismiss the Editorial coexistence notice"/);
  assert.match(shell, /onClick=\{\(\) => setNoticeDismissed\(true\)\}/);
  // Icon-only control: the glyph itself must be hidden from assistive tech.
  assert.match(shell, /<X className="h-4 w-4" aria-hidden="true" \/>/);
  assert.doesNotMatch(shell, /<div[^>]*onClick/, "no clickable divs");
});

test("dismissal affects only the banner — nav, page chrome and children are untouched", () => {
  // The dismiss state is read in exactly one place: the banner's own guard.
  assert.equal(
    (shell.match(/(?<![A-Za-z])noticeDismissed/g) ?? []).length,
    2,
    "the dismiss state is declared once and read in exactly one render guard",
  );
  // Children and the heading slot render unconditionally of the banner.
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
