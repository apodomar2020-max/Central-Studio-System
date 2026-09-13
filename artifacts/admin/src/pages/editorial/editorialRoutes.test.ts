/**
 * Wave 2.1A — Editorial routing, RBAC and placeholder-page contract.
 *
 * App.tsx cannot be imported by node:test (Vite-only `import.meta.env`, JSX,
 * `@/` aliases), so the routing table is asserted by source inspection — the
 * established frontend test convention in this app (pages/branches.test.ts,
 * pages/login.test.ts). The permission-filtering behaviour itself is covered
 * functionally in components/layout/editorialNavigation.test.ts.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const pages = readFileSync(new URL("./EditorialPlaceholderPages.tsx", import.meta.url), "utf8");

const EDITORIAL_ROUTES: Array<[string, string, string]> = [
  ["/editorial/posts/new", "editorialPosts", "EditorialPostCreatePage"],
  ["/editorial/posts/:id/:languageCode", "editorialPosts", "EditorialPostTranslationPage"],
  ["/editorial/posts/:id", "editorialPosts", "EditorialPostDetailPage"],
  ["/editorial/posts", "editorialPosts", "EditorialPostsListPage"],
  ["/editorial/authors", "editorialAuthors", "EditorialAuthorsPage"],
  ["/editorial/topics", "editorialTopics", "EditorialTopicsPage"],
  ["/editorial/placements", "editorialPlacements", "EditorialPlacementsPage"],
  ["/website/settings/languages", "websiteSettings", "WebsiteSettingsLanguagesPage"],
  ["/website/settings/links", "websiteSettings", "WebsiteSettingsLinksPage"],
];

test("all nine Editorial routes are registered, guarded, and wired to their page", () => {
  for (const [path, permKey, component] of EDITORIAL_ROUTES) {
    const escaped = path.replace(/[/:]/g, (c) => `\\${c}`);
    const pattern = new RegExp(
      `<Route path="${escaped}">\\{guarded\\(ROUTE_PERMS\\.${permKey}, <${component} />\\)\\}</Route>`,
    );
    assert.match(app, pattern, `route not registered as expected: ${path}`);
  }
});

test("Editorial routes guard on website.posts:view, Settings routes on website.settings:view", () => {
  for (const key of ["editorialPosts", "editorialAuthors", "editorialTopics", "editorialPlacements"]) {
    assert.match(app, new RegExp(`${key}: \\[\\["website\\.posts", "view"\\]\\],`), `${key} must guard on website.posts:view`);
  }
  assert.match(app, /websiteSettings: \[\["website\.settings", "view"\]\],/);
});

test("route guards are VIEW-only — create/edit/publish are not gated at the route level", () => {
  const permBlock = app.slice(app.indexOf("const ROUTE_PERMS"), app.indexOf("} satisfies Record<string, PermRequirement>"));
  for (const key of ["editorialPosts", "editorialAuthors", "editorialTopics", "editorialPlacements", "websiteSettings"]) {
    const line = permBlock.split("\n").find((l) => l.trim().startsWith(`${key}:`));
    assert.ok(line, `${key} missing from ROUTE_PERMS`);
    assert.doesNotMatch(line, /"create"|"edit"|"delete"|"publish"/);
  }
  // The guard uses the default "any" mode, matching the News/Performance convention.
  assert.doesNotMatch(app, /ROUTE_PERMS\.(editorial|websiteSettings)[A-Za-z]*, <[A-Za-z]+ \/>, "all"/);
});

test("the more specific post routes are matched before the list route", () => {
  const order = EDITORIAL_ROUTES.slice(0, 4).map(([path]) => app.indexOf(`<Route path="${path}">`));
  assert.ok(order.every((i) => i > -1));
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(order[i] > order[i - 1], "wouter Switch order must run most-specific first");
  }
});

test("this wave grants no permission to any role — Super Admin reaches Editorial via its existing bypass", () => {
  // A grant would have to name the new modules somewhere other than the route
  // guard / nav config; assert App.tsx contains no permission-seeding code.
  assert.doesNotMatch(app, /website\.posts["']?\s*:\s*\{/);
  assert.doesNotMatch(app, /permissions\s*[:=]/);
});

test("the global QueryClient instantiation is untouched by this wave", () => {
  assert.match(app, /^const queryClient = new QueryClient\(\);$/m);
  assert.equal((app.match(/new QueryClient\(/g) ?? []).length, 1);
  assert.doesNotMatch(app, /new QueryClient\(\{/, "no default query options may be added globally");
});

// ─── Placeholder pages ───────────────────────────────────────────────────────

test("every placeholder component referenced by a route is exported", () => {
  for (const [, , component] of EDITORIAL_ROUTES) {
    assert.match(pages, new RegExp(`export function ${component}\\(`), `missing export: ${component}`);
    assert.match(app, new RegExp(`\\s${component},`), `${component} must be imported by App.tsx`);
  }
});

test("the four Editorial placeholders render inside EditorialPageShell", () => {
  assert.match(pages, /import \{ EditorialPageShell \} from "@\/components\/editorial\/editorial-page-shell";/);
  assert.match(pages, /<EditorialPageShell heading=\{heading\} description=\{description\}>/);
  // Settings placeholders deliberately use plain admin page chrome instead.
  assert.match(pages, /function SettingsPlaceholder\(/);
  assert.match(pages, /<div className="admin2-final-page admin2-cms-workspace space-y-6">/);
});

test("placeholders state they are delivered in a later sub-wave and carry no CRUD", () => {
  assert.equal(
    (pages.match(/delivered in a later Wave 2\.1 sub-wave/g) ?? []).length,
    9,
    "each of the nine placeholders must say a later sub-wave delivers it",
  );
  assert.doesNotMatch(pages, /useMutation|useQuery|<Table|<form|onSubmit/);
  assert.doesNotMatch(pages, /@workspace\/api-client-react/);
});

test("placeholders use semantic headings, not styled divs", () => {
  assert.match(pages, /<h2 className="text-base font-semibold text-foreground">/);
  assert.doesNotMatch(pages, /<div[^>]*role="heading"/);
});
