/**
 * nav-config — single source of truth for admin routes and page titles.
 *
 * Phase 1 (Layout Foundation): consumed by the TopBar to resolve the current
 * page title from the wouter location.
 * Phase 2 (Navigation Restructure) will reuse the same entries to build the
 * modular sidebar, which is why each entry already carries its permission
 * requirement — identical to the pairs used in App.tsx ROUTE_PERMS and the
 * current sidebar arrays.
 *
 * Title resolution rule: longest matching href prefix wins, so dynamic
 * children resolve to their parent title (e.g. /students/42 → "Students",
 * /ballet/applications/7 → "Ballet Applications"). "/" matches exactly.
 */
import type { PermRequirement } from "@/lib/permissions";

export interface NavRouteEntry {
  /** Human title shown in the TopBar (and later in the sidebar). */
  title: string;
  /** Route path as registered in App.tsx (without dynamic segments). */
  href: string;
  /** Permission requirement (any one pair grants access) — Phase 2 use. */
  perm: PermRequirement;
}

export const NAV_ROUTES: NavRouteEntry[] = [
  { title: "Dashboard",            href: "/",                    perm: [["dashboard", "view"]] },
  { title: "Instructors",          href: "/instructors",         perm: [["instructors", "view"]] },
  { title: "Classes",              href: "/classes",             perm: [["classes", "view"]] },
  { title: "Schedules",            href: "/schedules",           perm: [["schedules", "view"]] },
  { title: "Packages",             href: "/packages",            perm: [["packages", "view"]] },
  { title: "Bookings",             href: "/bookings",            perm: [["bookings", "view"]] },
  { title: "Students",             href: "/students",            perm: [["students", "view"]] },
  { title: "Parents",              href: "/parents",             perm: [["parents", "view"]] },
  { title: "Offers",               href: "/offers",              perm: [["offers", "view"]] },
  { title: "Promotions",           href: "/promotions",          perm: [["offers", "view"]] },
  { title: "Notifications",        href: "/notifications",       perm: [["notifications", "view"]] },
  { title: "Marketing",            href: "/marketing",           perm: [["marketing", "view"]] },
  { title: "Package Orders",       href: "/package-orders",      perm: [["packageOrders", "view"]] },
  { title: "Attendance",           href: "/attendance",          perm: [["attendance", "view"]] },
  { title: "Feedback",             href: "/feedback",            perm: [["feedback", "view"]] },
  { title: "Reports",              href: "/reports",             perm: [["reports", "view"]] },
  { title: "Hero Slides",          href: "/hero-items",          perm: [["heroSlides", "view"]] },
  { title: "App Content",          href: "/app-content",         perm: [["appContent", "view"]] },
  { title: "System Users",         href: "/system-users",        perm: [["adminUsers", "view"], ["roles", "view"]] },
  { title: "Ballet Applications",  href: "/ballet/applications", perm: [["ballet.applications", "view"]] },
  { title: "Assessment Dates",     href: "/ballet/slots",        perm: [["ballet.assessmentDates", "view"]] },
  { title: "Pricing & Settings",   href: "/ballet/settings",     perm: [["ballet.pricing", "view"]] },
  { title: "Ballet Levels",        href: "/ballet/levels",       perm: [["ballet.levels", "view"]] },
  { title: "Settings",             href: "/settings",            perm: [["settings", "view"]] },
];

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
