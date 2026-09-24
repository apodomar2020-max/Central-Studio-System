/**
 * Editorial routing and RBAC contract.
 *
 * Wave 2.1A created this file to pin the routing table and the
 * placeholder-page contract. Final Editorial Phase A retired the LAST two
 * placeholders (Placements and Website Settings → Links), so
 * EditorialPlaceholderPages.tsx no longer exists and the placeholder half of
 * this file is gone with it. The ROUTE and GUARD assertions are unchanged —
 * the point of the retirement is that routing and RBAC did NOT move.
 *
 * App.tsx cannot be imported by node:test (Vite-only `import.meta.env`, JSX,
 * `@/` aliases), so the routing table is asserted by source inspection — the
 * established frontend test convention in this app (pages/branches.test.ts,
 * pages/login.test.ts). The permission-filtering behaviour itself is covered
 * functionally in components/layout/editorialNavigation.test.ts.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");

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

// ─── Every route is a real page ──────────────────────────────────────────────

/**
 * The placeholder file is GONE. Wave 2.1B took Languages out of it, 2.1C
 * Topics and Authors, 2.1D the four Posts routes, and Final Editorial Phase A
 * the last two — Placements and Links. Nothing imports it and it has been
 * deleted, so the only honest assertion left is that every routed component
 * has its own module and none of them is a placeholder.
 */
const REAL_PAGE_MODULES: Record<string, string> = {
  WebsiteSettingsLanguagesPage: "@/pages/website/settings/WebsiteSettingsLanguagesPage",
  WebsiteSettingsLinksPage: "@/pages/website/settings/WebsiteSettingsLinksPage",
  EditorialTopicsPage: "@/pages/editorial/EditorialTopicsPage",
  EditorialAuthorsPage: "@/pages/editorial/EditorialAuthorsPage",
  EditorialPostsListPage: "@/pages/editorial/EditorialPostsListPage",
  EditorialPostCreatePage: "@/pages/editorial/EditorialPostCreatePage",
  EditorialPostDetailPage: "@/pages/editorial/EditorialPostDetailPage",
  EditorialPostTranslationPage: "@/pages/editorial/EditorialPostTranslationPage",
  EditorialPlacementsPage: "@/pages/editorial/EditorialPlacementsPage",
};

test("every routed Editorial component is a real page with its own module", () => {
  for (const [, , component] of EDITORIAL_ROUTES) {
    const modulePath = REAL_PAGE_MODULES[component];
    assert.ok(modulePath, `${component} is routed but has no known module`);
    const escaped = modulePath.replace(/[/@]/g, (c) => `\\${c}`);
    assert.match(
      app,
      new RegExp(`import ${component} from "${escaped}";`),
      `${component} must be a default import from its own module`,
    );
  }
});

test("the placeholder module has been deleted and nothing imports it", () => {
  assert.equal(
    existsSync(new URL("./EditorialPlaceholderPages.tsx", import.meta.url)),
    false,
    "EditorialPlaceholderPages.tsx must be gone once its last consumer left",
  );
  assert.doesNotMatch(app, /EditorialPlaceholderPages/);
});

test("no Editorial Admin placeholder copy remains in App.tsx", () => {
  const editorialImports = app.slice(0, app.indexOf("function App"));
  assert.doesNotMatch(editorialImports, /Coming soon|placeholder proving|Not implemented/i);
});
