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

// ─── Structure ───────────────────────────────────────────────────────────────

test("Editorial and Configuration are nested inside the existing Website group", () => {
  assert.deepEqual(groupTitles(website().children), ["Backgrounds", "Editorial", "Configuration"]);
});

test("Editorial exposes exactly the four approved links, all on website.posts:view", () => {
  const editorial = findGroup(website().children, "Editorial");
  assert.deepEqual(
    editorial.children.map((n) => (n.kind === "link" ? [n.title, n.href] : ["group", n.title])),
    [
      ["Posts", "/editorial/posts"],
      ["Authors", "/editorial/authors"],
      ["Topics", "/editorial/topics"],
      ["Placements", "/editorial/placements"],
    ],
  );
  for (const node of editorial.children) {
    assert.equal(node.kind, "link");
    if (node.kind !== "link") continue;
    assert.deepEqual(node.perm, [["website.posts", "view"]]);
    assert.ok(node.icon, `${node.title} must carry an icon`);
    assert.ok(node.pageTitle, `${node.title} must carry a pageTitle`);
    assert.ok(node.description, `${node.title} must carry a description`);
  }
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

test("the Editorial entry states plainly that it is not connected to the public website", () => {
  const editorial = findGroup(website().children, "Editorial");
  const posts = editorial.children.find((n) => n.kind === "link" && n.title === "Posts");
  assert.ok(posts && posts.kind === "link");
  assert.match(posts.description ?? "", /not yet connected to the public website/i);
  assert.match(posts.description ?? "", /News and Performance/);
});

test("every new Editorial/Configuration link is reachable through NAV_ROUTES for the TopBar", () => {
  for (const href of [
    "/editorial/posts",
    "/editorial/authors",
    "/editorial/topics",
    "/editorial/placements",
    "/website/settings/languages",
    "/website/settings/links",
  ]) {
    assert.ok(NAV_ROUTES.some((r) => r.href === href), `NAV_ROUTES missing ${href}`);
  }
});

// ─── Legacy coexistence: the untouched entries ───────────────────────────────

test("the legacy Performance / News / Backgrounds entries are byte-identical to before this wave", () => {
  const legacy = website()
    .children.filter((n) => !(n.kind === "group" && (n.title === "Editorial" || n.title === "Configuration")))
    .map((n) =>
      n.kind === "link"
        ? { kind: n.kind, title: n.title, href: n.href, perm: n.perm, pageTitle: n.pageTitle, description: n.description }
        : {
            kind: n.kind,
            title: n.title,
            children: n.children.map((c) =>
              c.kind === "link" ? { title: c.title, href: c.href, perm: c.perm, pageTitle: c.pageTitle } : { title: c.title },
            ),
          },
    );

  assert.deepEqual(legacy, [
    {
      kind: "link",
      title: "Performance",
      href: "/website/performances",
      perm: [["website.performance", "view"]],
      pageTitle: "Performance",
      description: "Public-website Performance repertoire, hero, and detail content",
    },
    {
      kind: "link",
      title: "News",
      href: "/website/news",
      perm: [["website.news", "view"]],
      pageTitle: "News",
      description: "Public-website News posts — listing, detail content, and related articles",
    },
    {
      kind: "group",
      title: "Backgrounds",
      children: [
        { title: "Home", href: "/website/backgrounds/home", perm: [["website.backgrounds", "view"]], pageTitle: "Home Backgrounds" },
        { title: "About Studio", href: "/website/backgrounds/about-studio", perm: [["website.backgrounds", "view"]], pageTitle: "About Studio Backgrounds" },
        { title: "Ballet", href: "/website/backgrounds/ballet", perm: [["website.backgrounds", "view"]], pageTitle: "Ballet Backgrounds" },
        { title: "Classes", href: "/website/backgrounds/classes", perm: [["website.backgrounds", "view"]], pageTitle: "Classes Backgrounds" },
      ],
    },
  ]);
});

// ─── Permission filtering ────────────────────────────────────────────────────

test("Super Admin (can() returns true for everything) sees both Editorial and Configuration", () => {
  const visible = findGroup(visibleFor("all"), "Website");
  assert.deepEqual(groupTitles(visible.children), ["Backgrounds", "Editorial", "Configuration"]);
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

test("neither permission hides both groups — and, with nothing else granted, the whole Website group", () => {
  assert.equal(
    visibleFor([]).length,
    0,
    "a user granted nothing must see no navigation at all",
  );
  const legacyOnly = findGroup(visibleFor(["website.news:view"]), "Website");
  assert.deepEqual(
    legacyOnly.children.map((n) => n.title),
    ["News"],
    "a News-only user must still see News and neither new group",
  );
});

test("the local `allows` mirror still matches the real lib/permissions implementation", () => {
  const source = readFileSync(new URL("../../lib/permissions.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(!req \|\| req\.length === 0\) return true;/);
  assert.match(source, /const predicate = \(\[module, action\]: readonly \[string, string\]\) => can\(module, action\);/);
  assert.match(source, /return mode === "all" \? req\.every\(predicate\) : req\.some\(predicate\);/);
});
