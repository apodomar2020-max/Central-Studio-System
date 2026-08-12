import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";

/**
 * Local sub-workspace navigation for the Users group (Students / Parents).
 *
 * NAV_TREE already models Students and Parents as siblings under a "Users"
 * group (components/layout/nav-config.ts) — but the global contextual nav
 * only renders one flattened level, so that group collapses into a single
 * pill and Parents becomes unreachable once you're on /students. This
 * restores the local workspace relationship the group data already implies,
 * reusing the same pill/cyan-active language as every other Admin 2.0
 * local-subworkspace switcher (System Users' Users/Roles tabs, App
 * Content's Pages/FAQ/Categories/Contact Links) rather than introducing a
 * new navigation pattern.
 *
 * Both destinations are always passed in already permission-filtered by the
 * caller — if only one is visible, nothing renders (a single-item switcher
 * has nothing to switch between).
 */

interface UsersWorkspaceNavItem {
  label: string;
  href: string;
}

export function UsersWorkspaceNav({ items }: { items: UsersWorkspaceNavItem[] }) {
  const [location] = useLocation();

  if (items.length < 2) return null;

  return (
    <nav className="admin2-workspace-tabs" aria-label="Users workspace">
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
