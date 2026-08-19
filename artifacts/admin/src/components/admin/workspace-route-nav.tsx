import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";

/**
 * Local sub-workspace navigation for a NAV_TREE group nested inside another
 * group (originally built for System → Users → Students/Parents; also used
 * for Website → Backgrounds → Home/About Studio/Ballet/Classes).
 *
 * The global contextual TopBar only renders one navigation level
 * (components/layout/top-bar.tsx, resolveNavigationContext in
 * components/layout/nav-config.ts) — a group nested inside another group
 * collapses into a single pill in that bar, and its own children become
 * unreachable through any visible desktop control. This restores the local
 * workspace relationship the nested group data already implies, reusing the
 * same pill/cyan-active language as every other Admin 2.0 local-subworkspace
 * switcher (System Users' own Users/Roles tabs, App Content's Pages/FAQ/
 * Categories/Contact Links) rather than introducing a new navigation
 * pattern. Deliberately does NOT touch the TopBar/NAV_TREE/Sidebar — this is
 * a page-local addition only.
 *
 * Items are always passed in already permission-filtered by the caller — if
 * fewer than 2 are visible, nothing renders (a single-item switcher has
 * nothing to switch between).
 */

interface WorkspaceRouteNavItem {
  label: string;
  href: string;
}

export function WorkspaceRouteNav({
  items,
  ariaLabel,
}: {
  items: WorkspaceRouteNavItem[];
  /** e.g. "Users workspace", "Backgrounds workspace". */
  ariaLabel: string;
}) {
  const [location] = useLocation();

  if (items.length < 2) return null;

  return (
    <nav className="admin2-workspace-tabs" aria-label={ariaLabel}>
      {items.map((item) => {
        const active = location === item.href || location.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn("admin2-workspace-tab", active && "is-active")}
            aria-current={active ? "page" : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
