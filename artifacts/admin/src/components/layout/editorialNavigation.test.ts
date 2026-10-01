/**
 * Wave 2.1A — navigation contract for the unified Editorial CMS.
 *
 * These are real behaviour tests, not source inspection: NAV_TREE and
 * filterVisibleNavTree are plain data/functions, so the permission filtering
 * every navigation surface uses can be exercised directly.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NAV_TREE, filterVisibleNavTree, NAV_ROUTES, type NavNode, type NavGroup } from "./nav-config.ts";
import type { PermRequirement } from "../../lib/permissions";

/**
 * Local mirror of lib/permissions.tsx's `allows`. The real module cannot be
 * imported here — it pulls in AdminAuthContext, which reads `import.meta.env`
 * and therefore only exists inside a Vite bundle. The final test in this file
 * pins the real implementation to this exact semantics, so the mirror can
 * never silently drift.
 */
const allows = (
  can: (module: string, action: string) => boolean,
  req?: PermRequirement,
  mode: "any" | "all" = "any",
): boolean => {
  if (!req || req.length === 0) return true;
  const predicate = ([module, action]: readonly [string, string]) => can(module, action);
  return mode === "all" ? req.every(predicate) : req.some(predicate);
};

function findGroup(nodes: NavNode[], title: string): NavGroup {
  for (const node of nodes) {
    if (node.kind !== "group") continue;
    if (node.title === title) return node;
  }
  throw new Error(`nav group "${title}" not found`);
}

function groupTitles(nodes: NavNode[]): string[] {
  return nodes.filter((n): n is NavGroup => n.kind === "group").map((n) => n.title);
}

/** Build a `can()` from an explicit grant list. Super Admin bypasses via `all`. */
function canFrom(granted: string[] | "all") {
  return (module: string, action: string) =>
    granted === "all" || granted.includes(`${module}:${action}`);
}

function visibleFor(granted: string[] | "all"): NavNode[] {
  return filterVisibleNavTree(NAV_TREE, canFrom(granted), allows);
}

const website = () => findGroup(NAV_TREE, "Website");
const editorialWorkspaceNav = readFileSync(
  new URL("../editorial/editorial-workspace-nav.tsx", import.meta.url),
  "utf8",
);

// ─── Structure ───────────────────────────────────────────────────────────────

test("Website presents Editorial, Performance, Backgrounds, and Configuration in operational order", () => {
  assert.deepEqual(website().children.map((node) => node.title), ["Editorial", "Performance", "Backgrounds", "Configuration"]);
});

test("Editorial exposes primary content destinations followed by Compatibility", () => {
  const editorial = findGroup(website().children, "Editorial");
  assert.deepEqual(
    editorial.children.map((n) => (n.kind === "link" ? [n.title, n.href] : ["group", n.title])),
    [
      ["Posts", "/editorial/posts"],
      ["Authors", "/editorial/authors"],
      ["Topics", "/editorial/topics"],
      ["Placements", "/editorial/placements"],
      ["Compatibility", "/website/news"],
    ],
  );
  for (const node of editorial.children.slice(0, 4)) {
    assert.equal(node.kind, "link");
    if (node.kind !== "link") continue;
    assert.deepEqual(node.perm, [["website.posts", "view"]]);
    assert.ok(node.icon, `${node.title} must carry an icon`);
    assert.ok(node.pageTitle, `${node.title} must carry a pageTitle`);
    assert.ok(node.description, `${node.title} must carry a description`);
  }
  const compatibility = editorial.children.at(-1);
  assert.ok(compatibility && compatibility.kind === "link");
  if (!compatibility || compatibility.kind !== "link") return;
  assert.deepEqual(compatibility.perm, [["website.news", "view"]]);
  assert.equal(compatibility.href, "/website/news");
  assert.equal(compatibility.pageTitle, "News Compatibility");
  assert.equal(compatibility.description, "Legacy metadata and relationships used by migrated public News");
});

test("Website → Configuration exposes Languages and Links, both on website.settings:view", () => {
  const settings = findGroup(website().children, "Configuration");
  assert.deepEqual(
    settings.children.map((n) => (n.kind === "link" ? [n.title, n.href] : ["group", n.title])),
    [
      ["Languages", "/website/settings/languages"],
      ["Links", "/website/settings/links"],
    ],
  );
  for (const node of settings.children) {
    assert.equal(node.kind, "link");
    if (node.kind !== "link") continue;
    assert.deepEqual(node.perm, [["website.settings", "view"]]);
    assert.ok(node.icon && node.pageTitle && node.description);
  }
});

test("the Editorial Posts entry uses concise News-authoring copy", () => {
  const editorial = findGroup(website().children, "Editorial");
  const posts = editorial.children.find((n) => n.kind === "link" && n.title === "Posts");
  assert.ok(posts && posts.kind === "link");
  assert.equal(posts.description, "Create and manage News content");
});

test("every new Editorial/Configuration link is reachable through NAV_ROUTES for the TopBar", () => {
  for (const href of [
    "/editorial/posts",
    "/editorial/authors",
    "/editorial/topics",
    "/editorial/placements",
    "/website/news",
    "/website/settings/languages",
    "/website/settings/links",
  ]) {
    assert.ok(NAV_ROUTES.some((r) => r.href === href), `NAV_ROUTES missing ${href}`);
  }
});

// ─── Website authority labels ────────────────────────────────────────────────

test("Performance remains a first-class Website destination with its live-authority copy", () => {
  const performance = website().children.find((node) => node.kind === "link" && node.title === "Performance");
  assert.ok(performance && performance.kind === "link");
  if (!performance || performance.kind !== "link") return;
  assert.equal(performance.href, "/website/performances");
  assert.deepEqual(performance.perm, [["website.performance", "view"]]);
  assert.equal(performance.description, "Controls live Central Experience content on the public website");
});

// ─── Permission filtering ────────────────────────────────────────────────────

test("Super Admin (can() returns true for everything) sees both Editorial and Configuration", () => {
  const visible = findGroup(visibleFor("all"), "Website");
  assert.deepEqual(visible.children.map((node) => node.title), ["Editorial", "Performance", "Backgrounds", "Configuration"]);
});

test("website.posts:view alone shows Editorial and hides Configuration", () => {
  const visible = findGroup(visibleFor(["website.posts:view"]), "Website");
  assert.deepEqual(groupTitles(visible.children), ["Editorial"]);
  assert.equal(visible.children.length, 1);
});

test("website.settings:view alone shows Configuration and hides Editorial", () => {
  const visible = findGroup(visibleFor(["website.settings:view"]), "Website");
  assert.deepEqual(groupTitles(visible.children), ["Configuration"]);
  assert.equal(visible.children.length, 1);
});

test("a Compatibility-only user still sees Editorial and its only permitted destination", () => {
  assert.equal(
    visibleFor([]).length,
    0,
    "a user granted nothing must see no navigation at all",
  );
  const legacyOnly = findGroup(visibleFor(["website.news:view"]), "Website");
  assert.deepEqual(
    legacyOnly.children.map((n) => n.title),
    ["Editorial"],
    "a News-only user must still see the Editorial group",
  );
  const editorial = findGroup(legacyOnly.children, "Editorial");
  assert.deepEqual(editorial.children.map((n) => n.title), ["Compatibility"]);
});

test("the shared local Editorial navigation filters Compatibility with its existing permission", () => {
  assert.match(editorialWorkspaceNav, /can\("website\.posts", "view"\)/);
  assert.match(editorialWorkspaceNav, /can\("website\.news", "view"\)/);
  assert.match(editorialWorkspaceNav, /label: "Compatibility", href: "\/website\/news"/);
  assert.match(editorialWorkspaceNav, /<WorkspaceRouteNav/);
});

test("the local `allows` mirror still matches the real lib/permissions implementation", () => {
  const source = readFileSync(new URL("../../lib/permissions.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(!req \|\| req\.length === 0\) return true;/);
  assert.match(source, /const predicate = \(\[module, action\]: readonly \[string, string\]\) => can\(module, action\);/);
  assert.match(source, /return mode === "all" \? req\.every\(predicate\) : req\.some\(predicate\);/);
});
