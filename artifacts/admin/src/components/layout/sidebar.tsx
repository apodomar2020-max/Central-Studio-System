/**
 * Sidebar — modular, config-driven navigation (Phase 2).
 *
 * Reads NAV_TREE from nav-config.ts and renders it recursively:
 *  - Groups (Studio, Marketing, System, App) expand/collapse; nested groups
 *    (Studio → Ballet, System → Users) do too.
 *  - The group chain containing the active route auto-expands — including on
 *    a direct page reload of a nested route.
 *  - Permission filtering reuses allows(can, perm); a link the user cannot
 *    view is hidden, and a group whose children are all hidden disappears.
 *  - Collapsed mode (icon rail, persisted in localStorage): top-level links
 *    show icon + tooltip; clicking a group icon re-expands the sidebar with
 *    that group open.
 *  - "Coming Soon" entries (e.g. Logs before Phase 7) render disabled —
 *    never a real link.
 *
 * Mobile drawer readiness: the inner content is exported as <SidebarNav />
 * with an optional onNavigate callback, so Phase 5 can mount the exact same
 * nav inside a Sheet/drawer and close it after navigation. This file adds no
 * responsive behavior itself.
 */
import { Link, useLocation } from "wouter";
import { useEffect, useState } from "react";
import { ChevronDown, ChevronsLeft, ChevronsRight, LogOut, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { allows } from "@/lib/permissions";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import {
  NAV_TREE,
  isRouteActive,
  type NavGroup,
  type NavLink,
  type NavNode,
} from "@/components/layout/nav-config";

const COLLAPSED_STORAGE_KEY = "central-admin-sidebar-collapsed";
const ACCENT = "#00B6D7";

// ─── Tree helpers ─────────────────────────────────────────────────────────────

type Can = (module: string, action: string) => boolean;

/** Permission filter: hide forbidden links; drop groups left with no children. */
function filterVisible(nodes: NavNode[], can: Can): NavNode[] {
  return nodes.flatMap<NavNode>((node) => {
    if (node.kind === "link") return allows(can, node.perm) ? [node] : [];
    const children = filterVisible(node.children, can);
    return children.length > 0 ? [{ ...node, children }] : [];
  });
}

/** True if any (non coming-soon) descendant link matches the location. */
function containsActive(group: NavGroup, location: string): boolean {
  return group.children.some((child) =>
    child.kind === "group"
      ? containsActive(child, location)
      : !child.comingSoon && isRouteActive(child.href, location),
  );
}

// ─── Leaf link ────────────────────────────────────────────────────────────────

function NavLinkItem({
  item,
  depth,
  location,
  onNavigate,
}: {
  item: NavLink;
  depth: number;
  location: string;
  onNavigate?: () => void;
}) {
  const active = !item.comingSoon && isRouteActive(item.href, location);
  const Icon = item.icon as LucideIcon | undefined;
  const nested = depth > 0;

  const row = (
    <div
      className={cn(
        "group flex items-center rounded-r-lg border-l-2 text-sm font-medium transition-all duration-150",
        nested ? "px-3 py-1.5 text-[13px]" : "px-3 py-2",
        item.comingSoon
          ? "cursor-not-allowed border-transparent text-muted-foreground/40"
          : active
            ? "cursor-pointer border-[#00B6D7] bg-[#00B6D7]/10 text-[#00B6D7]"
            : "cursor-pointer border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
      style={{ paddingLeft: `${12 + depth * 14}px` }}
    >
      {Icon && (
        <Icon
          className={cn(
            "mr-3 h-[18px] w-[18px] flex-shrink-0 transition-colors",
            nested && "h-4 w-4",
            item.comingSoon
              ? "text-muted-foreground/30"
              : active
                ? "text-[#00B6D7]"
                : "text-muted-foreground/60 group-hover:text-muted-foreground",
          )}
          aria-hidden="true"
        />
      )}
      <span className="truncate">{item.title}</span>
      {item.comingSoon && (
        <Badge
          variant="outline"
          className="ml-auto border-muted-foreground/20 px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/50"
        >
          Soon
        </Badge>
      )}
    </div>
  );

  if (item.comingSoon) {
    return <div title="Coming soon">{row}</div>;
  }

  return (
    <Link href={item.href} onClick={onNavigate}>
      {row}
    </Link>
  );
}

// ─── Group (recursive) ────────────────────────────────────────────────────────

function NavGroupItem({
  item,
  depth,
  path,
  location,
  openMap,
  toggle,
  onNavigate,
}: {
  item: NavGroup;
  depth: number;
  path: string;
  location: string;
  openMap: Record<string, boolean>;
  toggle: (key: string) => void;
  onNavigate?: () => void;
}) {
  const active = containsActive(item, location);
  // Manual toggle wins; otherwise the group holding the active route is open.
  const open = openMap[path] ?? active;
  const Icon = item.icon as LucideIcon | undefined;

  return (
    <div className="space-y-0.5">
      <button
        onClick={() => toggle(path)}
        aria-expanded={open}
        data-testid={`nav-group-${path}`}
        className={cn(
          "group flex w-full items-center justify-between rounded-r-lg border-l-2 py-2 pr-3 text-sm font-medium transition-all duration-150 focus:outline-none",
          active
            ? "border-[#00B6D7] bg-[#00B6D7]/10 text-[#00B6D7]"
            : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
        style={{ paddingLeft: `${12 + depth * 14}px` }}
      >
        <span className="flex min-w-0 items-center">
          {Icon && (
            <Icon
              className={cn(
                "mr-3 h-[18px] w-[18px] flex-shrink-0 transition-colors",
                depth > 0 && "h-4 w-4",
                active ? "text-[#00B6D7]" : "text-muted-foreground/60 group-hover:text-muted-foreground",
              )}
              aria-hidden="true"
            />
          )}
          <span className="truncate">{item.title}</span>
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 flex-shrink-0 text-muted-foreground/60 transition-transform duration-150 group-hover:text-muted-foreground",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="space-y-0.5">
          {item.children.map((child) =>
            child.kind === "group" ? (
              <NavGroupItem
                key={`${path}/${child.title}`}
                item={child}
                depth={depth + 1}
                path={`${path}/${child.title}`}
                location={location}
                openMap={openMap}
                toggle={toggle}
                onNavigate={onNavigate}
              />
            ) : (
              <NavLinkItem
                key={child.href}
                item={child}
                depth={depth + 1}
                location={location}
                onNavigate={onNavigate}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

// ─── Collapsed (icon rail) ────────────────────────────────────────────────────

function CollapsedNav({
  nodes,
  location,
  onExpandGroup,
  onNavigate,
}: {
  nodes: NavNode[];
  location: string;
  onExpandGroup: (path: string) => void;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-col items-center gap-1 py-2">
      {nodes.map((node) => {
        const Icon = (node.icon ?? ChevronDown) as LucideIcon;
        if (node.kind === "group") {
          const active = containsActive(node, location);
          return (
            <Tooltip key={node.title} delayDuration={0}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onExpandGroup(node.title)}
                  aria-label={`${node.title} — expand sidebar`}
                  data-testid={`nav-collapsed-group-${node.title}`}
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-md transition-colors",
                    active
                      ? "bg-[#00B6D7]/10 text-[#00B6D7]"
                      : "text-muted-foreground/70 hover:bg-accent hover:text-foreground",
                  )}
                >
                  <Icon className="h-[18px] w-[18px]" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{node.title}</TooltipContent>
            </Tooltip>
          );
        }
        if (node.comingSoon) {
          return (
            <Tooltip key={node.title} delayDuration={0}>
              <TooltipTrigger asChild>
                <div
                  className="flex h-9 w-9 cursor-not-allowed items-center justify-center rounded-md text-muted-foreground/30"
                  aria-disabled="true"
                >
                  <Icon className="h-[18px] w-[18px]" />
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">{node.title} — coming soon</TooltipContent>
            </Tooltip>
          );
        }
        const active = isRouteActive(node.href, location);
        return (
          <Tooltip key={node.href} delayDuration={0}>
            <TooltipTrigger asChild>
              <Link href={node.href} onClick={onNavigate} aria-label={node.title}>
                <div
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-md transition-colors",
                    active
                      ? "bg-[#00B6D7]/10 text-[#00B6D7]"
                      : "text-muted-foreground/70 hover:bg-accent hover:text-foreground",
                  )}
                >
                  <Icon className="h-[18px] w-[18px]" />
                </div>
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">{node.title}</TooltipContent>
          </Tooltip>
        );
      })}
    </nav>
  );
}

// ─── SidebarNav (drawer-reusable content) ─────────────────────────────────────

/**
 * The navigation content without the sidebar shell — reusable inside a
 * future mobile Sheet/drawer (Phase 5). `onNavigate` lets a drawer close
 * itself after a link is clicked; `forceOpenGroup` lets the collapsed icon
 * rail hand over "expand with this group open".
 */
export function SidebarNav({
  onNavigate,
  forceOpenGroup = null,
  onForceOpenHandled,
}: {
  onNavigate?: () => void;
  forceOpenGroup?: string | null;
  onForceOpenHandled?: () => void;
}) {
  const [location] = useLocation();
  const { can } = useAdminAuth();
  const [openMap, setOpenMap] = useState<Record<string, boolean>>(() =>
    forceOpenGroup ? { [forceOpenGroup]: true } : {},
  );

  // One-shot: open the group requested by the collapsed icon rail.
  useEffect(() => {
    if (forceOpenGroup) {
      setOpenMap((prev) => ({ ...prev, [forceOpenGroup]: true }));
      onForceOpenHandled?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceOpenGroup]);

  // Auto-expand the chain around the active route whenever it changes —
  // covers navigation AND direct reload deep-links (manual closes are
  // cleared for groups that now contain the active route).
  useEffect(() => {
    setOpenMap((prev) => {
      const next = { ...prev };
      const walk = (nodes: NavNode[], parentPath: string) => {
        for (const node of nodes) {
          if (node.kind !== "group") continue;
          const path = parentPath ? `${parentPath}/${node.title}` : node.title;
          if (containsActive(node, location) && next[path] === false) delete next[path];
          walk(node.children, path);
        }
      };
      walk(NAV_TREE, "");
      return next;
    });
  }, [location]);

  const visibleTree = filterVisible(NAV_TREE, can);

  const toggle = (key: string) =>
    setOpenMap((prev) => {
      const groupNode = findGroupByPath(visibleTree, key);
      const currentlyOpen =
        prev[key] ?? (groupNode ? containsActive(groupNode, location) : false);
      return { ...prev, [key]: !currentlyOpen };
    });

  return (
    <nav className="space-y-0.5 pr-2" data-testid="sidebar-nav">
      {visibleTree.map((node) =>
        node.kind === "group" ? (
          <NavGroupItem
            key={node.title}
            item={node}
            depth={0}
            path={node.title}
            location={location}
            openMap={openMap}
            toggle={toggle}
            onNavigate={onNavigate}
          />
        ) : (
          <NavLinkItem key={node.href} item={node} depth={0} location={location} onNavigate={onNavigate} />
        ),
      )}
    </nav>
  );
}

function findGroupByPath(nodes: NavNode[], path: string): NavGroup | null {
  const [head, ...rest] = path.split("/");
  for (const node of nodes) {
    if (node.kind !== "group" || node.title !== head) continue;
    return rest.length === 0 ? node : findGroupByPath(node.children, rest.join("/"));
  }
  return null;
}

// ─── Sidebar shell ────────────────────────────────────────────────────────────

export function Sidebar() {
  const [location] = useLocation();
  const { user, logout, can } = useAdminAuth();
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSED_STORAGE_KEY) === "1",
  );
  // Group to force-open when expanding out of collapsed mode via a group icon.
  const [pendingGroup, setPendingGroup] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  const visibleTree = filterVisible(NAV_TREE, can);

  return (
    <div
      className={cn(
        "flex h-full flex-col border-r border-sidebar-border bg-sidebar shadow-[8px_0_28px_rgba(0,0,0,.06)] transition-[width] duration-200",
        collapsed ? "w-16" : "w-60",
      )}
      data-testid="sidebar"
      data-collapsed={collapsed ? "true" : "false"}
    >
      {/* Logo */}
      <div
        className={cn(
          "flex h-20 items-center border-b border-sidebar-border",
          collapsed ? "justify-center px-2" : "px-4",
        )}
      >
        <img
          src={`${import.meta.env.BASE_URL}logo-central-white.png`}
          alt="Central Studio"
          className={cn(
            "w-auto rounded-md bg-[#071014]",
            collapsed ? "h-9 px-1" : "h-14 px-2",
          )}
        />
      </div>

      {/* Nav */}
      <div className="flex-1 overflow-y-auto py-3">
        {collapsed ? (
          <CollapsedNav
            nodes={visibleTree}
            location={location}
            onExpandGroup={(groupTitle) => {
              setPendingGroup(groupTitle);
              setCollapsed(false);
            }}
          />
        ) : (
          <SidebarNav
            forceOpenGroup={pendingGroup}
            onForceOpenHandled={() => setPendingGroup(null)}
          />
        )}
      </div>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        data-testid="sidebar-collapse-toggle"
        className={cn(
          "flex items-center gap-2 border-t border-sidebar-border py-2.5 text-[11px] text-muted-foreground/60 transition-colors hover:text-muted-foreground",
          collapsed ? "justify-center" : "px-4",
        )}
      >
        {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
        {!collapsed && "Collapse"}
      </button>

      {/* Footer — unchanged identity block (sign out also lives in TopBar menu) */}
      <div className={cn("border-t border-sidebar-border py-3", collapsed ? "px-0" : "px-4")}>
        {collapsed ? (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                onClick={logout}
                aria-label="Sign out"
                className="mx-auto flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-muted-foreground"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Sign out</TooltipContent>
          </Tooltip>
        ) : (
          <>
            <p className="truncate text-[11px] text-muted-foreground">{user?.fullName ?? "Admin"}</p>
            <p className="truncate text-[10px] text-muted-foreground/60">{user?.username}</p>
            <button
              onClick={logout}
              className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground/60 transition-colors hover:text-muted-foreground"
            >
              <LogOut className="h-3 w-3" />
              Sign out
            </button>
          </>
        )}
      </div>
    </div>
  );
}

