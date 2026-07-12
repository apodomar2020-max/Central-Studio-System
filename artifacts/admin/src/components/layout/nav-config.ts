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
  CalendarDays,
  CalendarRange,
  CreditCard,
  Music2,
  ClipboardList,
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
} from "lucide-react";
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
  extra?: Partial<Pick<NavLink, "pageTitle" | "comingSoon">>,
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
    link("Instructors", "/instructors", [["instructors", "view"]], Users),
    link("Classes", "/classes", [["classes", "view"]], CalendarDays),
    link("Schedules", "/schedules", [["schedules", "view"]], CalendarRange),
    link("Packages", "/packages", [["packages", "view"]], CreditCard),
    group("Ballet", Music2, [
      link("Applications", "/ballet/applications", [["ballet.applications", "view"]], ClipboardList, {
        pageTitle: "Ballet Applications",
      }),
      link("Assessment Dates", "/ballet/slots", [["ballet.assessmentDates", "view"]], CalendarDays),
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
      link("Payments", "/ballet/payments", [["ballet.payments", "view"]], Receipt, { pageTitle: "Ballet Payments" }),
      link("Performances", "/ballet/performances", [["ballet.performances", "view"]], Sparkles, {
        pageTitle: "Ballet Performance Opportunities",
      }),
      link("General Settings", "/ballet/settings", [["ballet.pricing", "view"]], Settings2),
    ]),
  ]),

  group("Marketing", Megaphone, [
    link("Promotions", "/promotions", [["promotions", "view"]], Tag),
    link("Notifications", "/notifications", [["notifications", "view"]], Bell),
    link("WhatsApp Campaigns", "/marketing", [["marketing", "view"]], Send),
    link("Feedback", "/feedback", [["feedback", "view"]], MessageSquareText),
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
 * Resolve the page title for the current wouter location.
 * Longest-prefix match so dynamic routes inherit their parent title.
 * Falls back to a prettified first path segment for unknown routes
 * (e.g. /design-lab → "Design Lab"), and "Central Studio" as last resort.
 */
export function resolvePageTitle(location: string): string {
  const path = location.split("?")[0] ?? "/";
  if (path === "/" || path === "") return "Dashboard";

  let best: NavRouteEntry | null = null;
  for (const entry of NAV_ROUTES) {
    if (entry.href === "/") continue;
    if (path === entry.href || path.startsWith(entry.href + "/")) {
      if (!best || entry.href.length > best.href.length) best = entry;
    }
  }
  if (best) return best.title;

  const segment = path.split("/").filter(Boolean)[0];
  if (!segment) return "Central Studio";
  return segment
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
