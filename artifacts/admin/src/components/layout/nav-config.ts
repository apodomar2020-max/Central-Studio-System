/**
 * nav-config — single source of truth for admin navigation and page titles.
 *
 * Phase 1: flat route→title lookup for the TopBar (resolvePageTitle).
 * Phase 2: full nested navigation tree (NAV_TREE) consumed by the modular
 * sidebar — groups, nested children, icons, permission requirements and
 * "coming soon" placeholders.
 *
 * The TopBar keeps working unchanged: NAV_ROUTES is now derived by
 * flattening NAV_TREE (links only), and resolvePageTitle keeps the same
 * longest-prefix-match behavior so dynamic children resolve to their parent
 * title (/students/42 → "Students", /ballet/applications/7 → "Applications").
 *
 * Permission pairs mirror App.tsx ROUTE_PERMS exactly — this file never
 * loosens access; the sidebar additionally filters with allows(can, perm).
 */
import type { ElementType } from "react";
import {
  LayoutDashboard,
  ScanLine,
  Warehouse,
  Users,
  Calendar,
  CalendarDays,
  CalendarRange,
  CreditCard,
  ClipboardList,
  GraduationCap,
  Settings2,
  Trophy,
  Megaphone,
  Tag,
  Bell,
  Send,
  MessageSquareText,
  Ticket,
  UserSquare2,
  ShoppingBag,
  BarChart3,
  ShieldCheck,
  FileClock,
  Smartphone,
  ImagePlay,
  FileText,
  Layers,
  CalendarClock,
  UsersRound,
  Wallet,
  Sparkles,
  Receipt,
  Landmark,
  ArrowLeftRight,
  PiggyBank,
  BadgePercent,
  FileDown,
  Building2,
} from "lucide-react";
import { BallerinaIcon } from "@/components/icons/ballerina-icon";
import type { PermRequirement } from "@/lib/permissions";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NavLink {
  kind: "link";
  title: string;
  href: string;
  icon?: ElementType;
  /** Permission requirement (any one pair grants access). */
  perm: PermRequirement;
  /**
   * TopBar title when it should differ from the sidebar label
   * (e.g. sidebar "Roles" → page title "System Users").
   */
  pageTitle?: string;
  /** Route/page does not exist yet — rendered disabled, never a real link. */
  comingSoon?: boolean;
  /**
   * Highlight only on an exact location match, instead of the default
   * prefix match. Needed when this link's href is a strict prefix of its
   * siblings' (e.g. Finance Overview "/finance" vs "/finance/packages"),
   * where prefix matching would mark the parent active on every child page.
   */
  exact?: boolean;
}

export interface NavGroup {
  kind: "group";
  title: string;
  icon?: ElementType;
  children: NavNode[];
}

export type NavNode = NavLink | NavGroup;

const link = (
  title: string,
  href: string,
  perm: PermRequirement,
  icon?: ElementType,
  extra?: Partial<Pick<NavLink, "pageTitle" | "comingSoon" | "exact">>,
): NavLink => ({ kind: "link", title, href, perm, icon, ...extra });

const group = (title: string, icon: ElementType, children: NavNode[]): NavGroup => ({
  kind: "group",
  title,
  icon,
  children,
});

// ─── Navigation tree (Phase 2 structure) ─────────────────────────────────────

export const NAV_TREE: NavNode[] = [
  link("Dashboard", "/", [["dashboard", "view"]], LayoutDashboard),
  link("Attendance", "/attendance", [["attendance", "view"]], ScanLine),

  group("Studio", Warehouse, [
    link("Calendar", "/calendar", [["schedules", "view"], ["ballet.schedules", "view"]], Calendar),
    link("Branches", "/branches", [["branches", "view"]], Building2),
    link("Instructors", "/instructors", [["instructors", "view"]], Users),
    link("Classes", "/classes", [["classes", "view"]], CalendarDays),
    link("Schedules", "/schedules", [["schedules", "view"]], CalendarRange),
    link("Packages", "/packages", [["packages", "view"]], CreditCard),
    group("Ballet", BallerinaIcon, [
      link("Applications", "/ballet/applications", [["ballet.applications", "view"]], ClipboardList, {
        pageTitle: "Ballet Applications",
      }),
      link("Students", "/ballet/students", [["ballet.applications", "view"]], GraduationCap, {
        pageTitle: "Ballet Students",
      }),
      link("Levels", "/ballet/levels", [["ballet.levels", "view"]], Trophy, { pageTitle: "Ballet Levels" }),
      link("Instructors", "/ballet/instructors", [["ballet.instructors", "view"]], Users, {
        pageTitle: "Ballet Instructors",
      }),
      link("Classes", "/ballet/classes", [["ballet.classes", "view"]], Layers, { pageTitle: "Ballet Classes" }),
      link("Schedules", "/ballet/schedules", [["ballet.schedules", "view"]], CalendarClock, {
        pageTitle: "Ballet Schedules",
      }),
      link("Groups", "/ballet/groups", [["ballet.groups", "view"]], UsersRound, { pageTitle: "Ballet Groups" }),
      link("Packages", "/ballet/packages", [["ballet.packages", "view"]], Wallet, { pageTitle: "Ballet Packages" }),
      link("Payments", "/ballet/payments", [["finance", "view"]], Receipt, { pageTitle: "Ballet Payments" }),
      link("Cancellation Requests", "/ballet/cancellation-requests", [["ballet.applications", "view"]], FileClock, {
        pageTitle: "Ballet Cancellation Requests",
      }),
      link("Refunds", "/ballet/refunds", [["finance", "view"]], Receipt, { pageTitle: "Ballet Refunds" }),
      link("Performances", "/ballet/performances", [["ballet.performances", "view"]], Sparkles, {
        pageTitle: "Ballet Performance Opportunities",
      }),
      link("General Settings", "/ballet/settings", [["ballet.settings", "view"]], Settings2),
    ]),
  ]),

  group("Marketing", Megaphone, [
    link("Promotions", "/promotions", [["promotions", "view"]], Tag),
    link("Notifications", "/notifications", [["notifications", "view"]], Bell),
    link("WhatsApp Campaigns", "/marketing", [["marketing", "view"]], Send),
    link("Feedback", "/feedback", [["feedback", "view"]], MessageSquareText),
  ]),

  // Finance Department — gated on the single finance.view permission (Finance
  // Roles & Permissions integration). Every Finance page requires finance.view;
  // this group never widens access, and the backend enforces the same
  // permission independently on every read endpoint regardless of what the
  // sidebar shows (hiding a menu item alone is not security).
  group("Finance", Landmark, [
    link("Overview", "/finance", [["finance", "view"]], PiggyBank, {
      pageTitle: "Finance Overview",
      // "/finance" prefixes every sibling route, so exact matching keeps
      // Overview from highlighting while a child page is open.
      exact: true,
    }),
    link("Transactions", "/finance/transactions", [["finance", "view"]], ArrowLeftRight, { pageTitle: "Finance Transactions" }),
    link("Package Payments", "/finance/packages", [["finance", "view"]], ShoppingBag, {
      pageTitle: "Finance Package Payments",
    }),
    link("Class & Walk-in", "/finance/class-payments", [["finance", "view"]], Ticket, {
      pageTitle: "Finance Class & Walk-in",
    }),
    link("Ballet Finance", "/finance/ballet", [["finance", "view"]], BallerinaIcon, {
      pageTitle: "Ballet Finance",
    }),
    link("Refunds & Cancellations", "/finance/refunds", [["finance", "view"]], Receipt, {
      pageTitle: "Finance Refunds & Cancellations",
    }),
    link("Discounts", "/finance/discounts", [["finance", "view"]], BadgePercent, {
      pageTitle: "Finance Discounts",
    }),
    link("Reports & Exports", "/finance/exports", [["finance", "view"]], FileDown, {
      pageTitle: "Finance Reports & Exports",
    }),
  ]),

  group("System", ShieldCheck, [
    link("Bookings", "/bookings", [["bookings", "view"]], Ticket),
    group("Users", UserSquare2, [
      link("Students", "/students", [["students", "view"]]),
      link("Parents", "/parents", [["parents", "view"]]),
    ]),
    link("Package Order", "/package-orders", [["packageOrders", "view"]], ShoppingBag, {
      pageTitle: "Package Orders",
    }),
    link("Reports", "/reports", [["reports", "view"]], BarChart3),
    link("Roles", "/system-users", [["adminUsers", "view"], ["roles", "view"]], ShieldCheck, {
      pageTitle: "System Users",
    }),
    // Phase 7B: Admin Activity Logs — live route, gated by auditLogs.view.
    link("Logs", "/logs", [["auditLogs", "view"]], FileClock),
  ]),

  group("App", Smartphone, [
    link("Hero Slides", "/hero-items", [["heroSlides", "view"]], ImagePlay),
    link("App Content", "/app-content", [["appContent", "view"]], FileText),
  ]),

  link("Settings", "/settings", [["settings", "view"]], Settings2),
];

// ─── Flat route list (TopBar title lookup) ────────────────────────────────────

export interface NavRouteEntry {
  title: string;
  href: string;
  perm: PermRequirement;
}

function flattenLinks(nodes: NavNode[]): NavRouteEntry[] {
  return nodes.flatMap((node) =>
    node.kind === "group"
      ? flattenLinks(node.children)
      : node.comingSoon
        ? []
        : [{ title: node.pageTitle ?? node.title, href: node.href, perm: node.perm }],
  );
}

export const NAV_ROUTES: NavRouteEntry[] = flattenLinks(NAV_TREE);

// ─── Title + active-route helpers ─────────────────────────────────────────────

/** Exact match for "/", prefix match for everything else (same as before). */
export function isRouteActive(href: string, location: string): boolean {
  return href === "/" ? location === "/" : location === href || location.startsWith(href + "/");
}

/**
 * Active state for a nav link, honouring its `exact` flag. Links without the
 * flag keep the original prefix-matching behaviour exactly.
 */
export function isNavLinkActive(item: NavLink, location: string): boolean {
  return item.exact ? location === item.href : isRouteActive(item.href, location);
}

/**
 * Resolve the page title for the current wouter location.
 * Longest-prefix match so dynamic routes inherit their parent title.
 * Falls back to a prettified first path segment for unknown routes
 * (e.g. /design-lab → "Design Lab"), and "Central Studio" as last resort.
 */
export function resolvePageTitle(location: string): string {
  return resolvePageMeta(location).title;
}

export interface PageMeta {
  title: string;
  icon?: ElementType;
  breadcrumbs: string[];
}

/**
 * Resolve full page metadata (title, icon, breadcrumb chain) for wouter location.
 * Walks NAV_TREE for longest prefix match and inherits group icon / breadcrumb ancestry.
 */
export function resolvePageMeta(location: string): PageMeta {
  const path = location.split("?")[0] ?? "/";
  if (path === "/" || path === "") {
    return {
      title: "Dashboard",
      icon: LayoutDashboard,
      breadcrumbs: ["Dashboard"],
    };
  }

  let bestMatch: {
    title: string;
    href: string;
    icon?: ElementType;
    ancestors: string[];
  } | null = null;
  let maxLen = -1;

  function walk(nodes: NavNode[], parents: string[], groupIcon?: ElementType) {
    for (const node of nodes) {
      if (node.kind === "group") {
        walk(node.children, [...parents, node.title], node.icon ?? groupIcon);
      } else {
        if (!node.comingSoon && (path === node.href || path.startsWith(node.href + "/"))) {
          if (node.href.length > maxLen) {
            maxLen = node.href.length;
            bestMatch = {
              title: node.pageTitle ?? node.title,
              href: node.href,
              icon: node.icon ?? groupIcon,
              ancestors: [...parents, node.title],
            };
          }
        }
      }
    }
  }

  walk(NAV_TREE, []);

  const match = bestMatch as {
    title: string;
    href: string;
    icon?: ElementType;
    ancestors: string[];
  } | null;

  if (match) {
    const { title, href, icon, ancestors } = match;
    const extraPath = path.slice(href.length).replace(/^\/+/, "");
    const breadcrumbs: string[] = [...ancestors];

    if (extraPath) {
      const parts = extraPath.split("/");
      parts.forEach((p) => {
        if (/^\d+$/.test(p)) {
          breadcrumbs.push(`#${p}`);
        } else {
          breadcrumbs.push(
            p
              .split("-")
              .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
              .join(" ")
          );
        }
      });
    }

    return {
      title,
      icon,
      breadcrumbs,
    };
  }

  const segments = path.split("/").filter(Boolean);
  const title = segments[0]
    ? segments[0]
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ")
    : "Central Studio";

  return {
    title,
    icon: LayoutDashboard,
    breadcrumbs: segments.map((s) =>
      s
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ")
    ),
  };
}

