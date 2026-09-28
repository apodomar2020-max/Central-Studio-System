/**
 * Desktop discoverability for the nested Website → Editorial and
 * Website → Configuration groups.
 *
 * The contextual TopBar renders only one level below the active top-level
 * group, so a nested group collapses into a single pill pointing at its first
 * child — Authors/Topics/Placements and Links had no visible desktop control.
 * The fix reuses the existing page-local WorkspaceRouteNav (the Backgrounds
 * and Users precedent). NAV_TREE data is covered by
 * components/layout/editorialNavigation.test.ts; this file proves the pages
 * actually RENDER the switcher.
 *
 * The pages import `@/` aliases and generated hooks, so they cannot be mounted
 * under `node --test` (no jsdom in this workspace) — the established Admin
 * source-inspection convention applies. Active state is proven by evaluating
 * each page's item list against WorkspaceRouteNav's own active predicate,
 * which is itself pinned below so the two can never drift.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const component = read("../../components/admin/workspace-route-nav.tsx");
const app = read("../../App.tsx");
const nav = read("../../components/layout/nav-config.ts");

/** WorkspaceRouteNav's active predicate, mirrored and pinned (see first test). */
const isActive = (location: string, href: string) => location === href || location.startsWith(href + "/");

type Item = { perm: string; label: string; href: string };

function workspaceNav(source: string): { ariaLabel: string; items: Item[] } {
  const block = source.match(/<WorkspaceRouteNav\s+ariaLabel="([^"]+)"\s+items=\{\[([\s\S]*?)\]\}\s*\/>/);
  assert.ok(block, "page renders <WorkspaceRouteNav ariaLabel=… items={[…]} />");
  assert.equal(source.match(/<WorkspaceRouteNav\b/g)?.length, 1, "exactly one switcher per page");
  const items = [
    ...block[2].matchAll(
      /\.\.\.\(can\("([^"]+)", "view"\) \? \[\{ label: "([^"]+)", href: "([^"]+)" \}\] : \[\]\)/g,
    ),
  ].map(([, perm, label, href]) => ({ perm, label, href }));
  return { ariaLabel: block[1], items };
}

const EDITORIAL = [
  { file: "./EditorialPostsListPage.tsx", route: "/editorial/posts", active: "Posts" },
  { file: "./EditorialAuthorsPage.tsx", route: "/editorial/authors", active: "Authors" },
  { file: "./EditorialTopicsPage.tsx", route: "/editorial/topics", active: "Topics" },
  { file: "./EditorialPlacementsPage.tsx", route: "/editorial/placements", active: "Placements" },
];
const EDITORIAL_ITEMS = [
  { perm: "website.posts", label: "Posts", href: "/editorial/posts" },
  { perm: "website.posts", label: "Authors", href: "/editorial/authors" },
  { perm: "website.posts", label: "Topics", href: "/editorial/topics" },
  { perm: "website.posts", label: "Placements", href: "/editorial/placements" },
];

const CONFIGURATION = [
  { file: "../website/settings/WebsiteSettingsLanguagesPage.tsx", route: "/website/settings/languages", active: "Languages" },
  { file: "../website/settings/WebsiteSettingsLinksPage.tsx", route: "/website/settings/links", active: "Links" },
];
const CONFIGURATION_ITEMS = [
  { perm: "website.settings", label: "Languages", href: "/website/settings/languages" },
  { perm: "website.settings", label: "Links", href: "/website/settings/links" },
];

test("WorkspaceRouteNav active predicate and <2-item guard are unchanged", () => {
  assert.match(component, /const active = location === item\.href \|\| location\.startsWith\(item\.href \+ "\/"\);/);
  assert.match(component, /if \(items\.length < 2\) return null;/);
  assert.match(component, /aria-current=\{active \? "page" : undefined\}/);
});

for (const { file, route, active } of EDITORIAL) {
  test(`${file} renders all 4 Editorial destinations with ${active} active`, () => {
    const source = read(file);
    assert.match(source, /import \{ WorkspaceRouteNav \} from "@\/components\/admin\/workspace-route-nav";/);
    const { ariaLabel, items } = workspaceNav(source);
    assert.equal(ariaLabel, "Editorial workspace");
    assert.deepEqual(items, EDITORIAL_ITEMS);
    assert.deepEqual(items.filter((i) => isActive(route, i.href)).map((i) => i.label), [active]);
  });
}

for (const { file, route, active } of CONFIGURATION) {
  test(`${file} renders both Configuration destinations with ${active} active`, () => {
    const source = read(file);
    assert.match(source, /import \{ WorkspaceRouteNav \} from "@\/components\/admin\/workspace-route-nav";/);
    const { ariaLabel, items } = workspaceNav(source);
    assert.equal(ariaLabel, "Website configuration workspace");
    assert.deepEqual(items, CONFIGURATION_ITEMS);
    assert.deepEqual(items.filter((i) => isActive(route, i.href)).map((i) => i.label), [active]);
  });
}

test("switcher labels/hrefs/permissions match nav-config.ts exactly", () => {
  for (const { label, href, perm } of [...EDITORIAL_ITEMS, ...CONFIGURATION_ITEMS]) {
    const escaped = href.replace(/[/.]/g, "\\$&");
    assert.match(nav, new RegExp(`link\\("${label}", "${escaped}", \\[\\["${perm.replace(".", "\\.")}", "view"\\]\\]`));
  }
});

test("RBAC unchanged: route guards still require the same permission each switcher item filters on", () => {
  for (const key of ["editorialPosts", "editorialAuthors", "editorialTopics", "editorialPlacements"]) {
    assert.match(app, new RegExp(`${key}: \\[\\["website\\.posts", "view"\\]\\],`));
  }
  assert.match(app, /websiteSettings: \[\["website\.settings", "view"\]\],/);
  assert.match(app, /<Route path="\/website\/settings\/languages">\{guarded\(ROUTE_PERMS\.websiteSettings,/);
  assert.match(app, /<Route path="\/website\/settings\/links">\{guarded\(ROUTE_PERMS\.websiteSettings,/);
  // Items are filtered by the same can() the guard uses: an editor with only
  // website.posts:view sees the Editorial switcher but no Configuration one.
  const grants = new Set(["website.posts"]);
  const visible = (items: Item[]) => items.filter((i) => grants.has(i.perm));
  assert.equal(visible(EDITORIAL_ITEMS).length, 4);
  assert.ok(visible(CONFIGURATION_ITEMS).length < 2, "Configuration switcher renders nothing without website.settings:view");
});
