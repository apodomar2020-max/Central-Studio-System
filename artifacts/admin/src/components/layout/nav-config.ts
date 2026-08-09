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
  description?: string;
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
  extra?: Partial<Pick<NavLink, "pageTitle" | "description" | "comingSoon" | "exact">>,
): NavLink => ({ kind: "link", title, href, perm, icon, ...extra });

const group = (title: string, icon: ElementType, children: NavNode[]): NavGroup => ({
  kind: "group",
  title,
  icon,
  children,
});

// ─── Navigation tree (Phase 2 structure) ─────────────────────────────────────

export const NAV_TREE: NavNode[] = [
  link("Dashboard", "/", [["dashboard", "view"]], LayoutDashboard, {
    description: "System overview, active metrics, and quick operational status",
  }),
  link("Attendance", "/attendance", [["attendance", "view"]], ScanLine, {
    description: "Class check-in, attendance verification, and daily rosters",
  }),

  group("Studio", Warehouse, [
    link("Calendar", "/calendar", [["schedules", "view"], ["ballet.schedules", "view"]], Calendar, {
      description: "Studio schedule at a glance",
    }),
    link("Branches", "/branches", [["branches", "view"]], Building2, {
      description: "Studio location branches and facility management",
    }),
    link("Instructors", "/instructors", [["instructors", "view"]], Users, {
      description: "Teaching staff and instructor profiles",
    }),
    link("Classes", "/classes", [["classes", "view"]], CalendarDays, {
      description: "Class definitions and program requirements",
    }),
    link("Schedules", "/schedules", [["schedules", "view"]], CalendarRange, {
      description: "Weekly timetable and schedule management",
    }),
    link("Packages", "/packages", [["packages", "view"]], CreditCard, {
      description: "Class passes and subscription packages",
    }),
    group("Ballet", BallerinaIcon, [
      link("Applications", "/ballet/applications", [["ballet.applications", "view"]], ClipboardList, {
        pageTitle: "Ballet Applications",
        description: "Review and manage assessment applications",
      }),
      link("Students", "/ballet/students", [["ballet.applications", "view"]], GraduationCap, {
        pageTitle: "Ballet Students",
        description: "Ballet student files created from level assignments",
      }),
      link("Levels", "/ballet/levels", [["ballet.levels", "view"]], Trophy, {
        pageTitle: "Ballet Levels",
        description: "Ballet program curriculum levels and requirements",
      }),
      link("Instructors", "/ballet/instructors", [["ballet.instructors", "view"]], Users, {
        pageTitle: "Ballet Instructors",
        description: "Teaching staff for the Ballet program",
      }),
      link("Classes", "/ballet/classes", [["ballet.classes", "view"]], Layers, {
        pageTitle: "Ballet Classes",
        description: "Create Class details and assign weekly schedule slots",
      }),
      link("Schedules", "/ballet/schedules", [["ballet.schedules", "view"]], CalendarClock, {
        pageTitle: "Ballet Schedules",
        description: "Weekly timetable for Ballet classes",
      }),
      link("Groups", "/ballet/groups", [["ballet.groups", "view"]], UsersRound, {
        pageTitle: "Ballet Groups",
        description: "Cohorts of children within a level",
      }),
      link("Packages", "/ballet/packages", [["ballet.packages", "view"]], Wallet, {
        pageTitle: "Ballet Packages",
        description: "Ballet subscription packages and pricing",
      }),
      link("Payments", "/ballet/payments", [["finance", "view"]], Receipt, {
        pageTitle: "Ballet Payments",
        description: "Payment-cycle history and pending renewal management",
      }),
      link("Cancellation Requests", "/ballet/cancellation-requests", [["ballet.applications", "view"]], FileClock, {
        pageTitle: "Ballet Cancellation Requests",
        description: "Review and finalize active cancellation requests",
      }),
      link("Refunds", "/ballet/refunds", [["finance", "view"]], Receipt, {
        pageTitle: "Ballet Refunds",
        description: "Cash refund review and processing",
      }),
      link("Performances", "/ballet/performances", [["ballet.performances", "view"]], Sparkles, {
        pageTitle: "Ballet Performance Opportunities",
        description: "Recitals, galas, and competitions students can perform at",
      }),
      link("General Settings", "/ballet/settings", [["ballet.settings", "view"]], Settings2, {
        description: "Ballet program configuration, requirements, and policies",
      }),
    ]),
  ]),

  group("Marketing", Megaphone, [
    link("Promotions", "/promotions", [["promotions", "view"]], Tag, {
      description: "Promotional codes and discount offer campaigns",
    }),
    link("Notifications", "/notifications", [["notifications", "view"]], Bell, {
      description: "Broadcast mobile push notifications to members",
    }),
    link("WhatsApp Campaigns", "/marketing", [["marketing", "view"]], Send, {
      description: "Automated WhatsApp marketing messages and campaigns",
    }),
    link("Feedback", "/feedback", [["feedback", "view"]], MessageSquareText, {
      description: "Parent and student feedback submissions",
    }),
  ]),

  group("Finance", Landmark, [
    link("Overview", "/finance", [["finance", "view"]], PiggyBank, {
      pageTitle: "Finance Overview",
      description: "Studio revenue summary and financial health metrics",
      exact: true,
    }),
    link("Transactions", "/finance/transactions", [["finance", "view"]], ArrowLeftRight, {
      pageTitle: "Finance Transactions",
      description: "Income and expenditure transaction ledger",
    }),
    link("Package Payments", "/finance/packages", [["finance", "view"]], ShoppingBag, {
      pageTitle: "Finance Package Payments",
      description: "Package order payments and revenue streams",
    }),
    link("Class & Walk-in", "/finance/class-payments", [["finance", "view"]], Ticket, {
      pageTitle: "Finance Class & Walk-in",
      description: "Individual class booking payments",
    }),
    link("Ballet Finance", "/finance/ballet", [["finance", "view"]], BallerinaIcon, {
      pageTitle: "Ballet Finance",
      description: "Ballet program financial reconciliation and statements",
    }),
    link("Refunds & Cancellations", "/finance/refunds", [["finance", "view"]], Receipt, {
      pageTitle: "Finance Refunds & Cancellations",
      description: "Processed refunds and canceled subscriptions",
    }),
    link("Discounts", "/finance/discounts", [["finance", "view"]], BadgePercent, {
      pageTitle: "Finance Discounts",
      description: "Applied discounts and promotional adjustments",
    }),
    link("Reports & Exports", "/finance/exports", [["finance", "view"]], FileDown, {
      pageTitle: "Finance Reports & Exports",
      description: "Financial statements and downloadable CSV reports",
    }),
  ]),

  group("System", ShieldCheck, [
    link("Bookings", "/bookings", [["bookings", "view"]], Ticket, {
      description: "Class booking records and attendance status",
    }),
    group("Users", UserSquare2, [
      link("Students", "/students", [["students", "view"]], undefined, {
        description: "Student profiles and enrollment directory",
      }),
      link("Parents", "/parents", [["parents", "view"]], undefined, {
        description: "Parent account profiles and family contacts",
      }),
    ]),
    link("Package Order", "/package-orders", [["packageOrders", "view"]], ShoppingBag, {
      pageTitle: "Package Orders",
      description: "Customer package purchases and order history",
    }),
    link("Reports", "/reports", [["reports", "view"]], BarChart3, {
      description: "Studio operational and analytics reports",
    }),
    link("Roles", "/system-users", [["adminUsers", "view"], ["roles", "view"]], ShieldCheck, {
      pageTitle: "System Users",
      description: "Manage admin accounts, roles, and permissions",
    }),
    link("Logs", "/logs", [["auditLogs", "view"]], FileClock, {
      description: "System audit logs and admin activity tracking",
    }),
  ]),

  group("App", Smartphone, [
    link("Hero Slides", "/hero-items", [["heroSlides", "view"]], ImagePlay, {
      description: "Mobile app hero banner slides and promotions",
    }),
    link("App Content", "/app-content", [["appContent", "view"]], FileText, {
      description: "Mobile app CMS content blocks and dynamic copy",
    }),
  ]),

  link("Settings", "/settings", [["settings", "view"]], Settings2, {
    description: "Studio system settings and global configuration",
  }),
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
  description?: string;
  icon?: ElementType;
  breadcrumbs: string[];
}

/**
 * Resolve full page metadata (title, description, icon, breadcrumb chain) for wouter location.
 * Walks NAV_TREE for longest prefix match and inherits group icon / breadcrumb ancestry.
 */
export function resolvePageMeta(location: string): PageMeta {
  const path = location.split("?")[0] ?? "/";
  if (path === "/" || path === "") {
    return {
      title: "Dashboard",
      description: "System overview, active metrics, and quick operational status",
      icon: LayoutDashboard,
      breadcrumbs: ["Dashboard"],
    };
  }

  let bestMatch: {
    title: string;
    description?: string;
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
              description: node.description,
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
    description?: string;
    href: string;
    icon?: ElementType;
    ancestors: string[];
  } | null;

  if (match) {
    const { title, description, href, icon, ancestors } = match;
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
      description,
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

