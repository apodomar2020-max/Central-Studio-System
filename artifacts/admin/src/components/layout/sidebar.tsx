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
 * Mobile drawer (Phase 5A): <MobileSidebarDrawer /> mounts the exact same
 * <SidebarNav /> inside a left Sheet for small screens; navigating closes the
 * drawer via onNavigate. The desktop <Sidebar /> accepts an optional className
 * so the Layout can hide it below the lg breakpoint without changing anything
 * about its own desktop behavior (collapse mode, persistence, footer).
 */
import { Link, useLocation } from "wouter";
import { useEffect, useState } from "react";
import { Activity, ChevronDown, LogOut, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { allows } from "@/lib/permissions";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import {
  NAV_TREE,
  filterVisibleNavTree,
  firstVisibleNavLink,
  isNavLinkActive,
  navNodeContainsLocation,
  type NavGroup,
  type NavLink,
  type NavNode,
} from "@/components/layout/nav-config";
import "./admin2-shell.css";

// ─── Tree helpers ─────────────────────────────────────────────────────────────

type Can = (module: string, action: string) => boolean;

/** Permission filter: hide forbidden links; drop groups left with no children. */
function filterVisible(nodes: NavNode[], can: Can): NavNode[] {
  return filterVisibleNavTree(nodes, can, allows);
}

/** True if any (non coming-soon) descendant link matches the location. */
function containsActive(group: NavGroup, location: string): boolean {
  return navNodeContainsLocation(group, location);
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
  const active = !item.comingSoon && isNavLinkActive(item, location);
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
        const active = isNavLinkActive(node, location);
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

export function Sidebar({ className }: { className?: string } = {}) {
  const [location, navigate] = useLocation();
  const { can } = useAdminAuth();
  const visibleTree = filterVisible(NAV_TREE, can);
  const railNodes = visibleTree.filter((node) => !(node.kind === "link" && node.href === "/attendance"));

  return (
    <aside
      className={cn(
        "admin2-rail",
        className,
      )}
      data-testid="sidebar"
      data-collapsed="true"
      aria-label="Central Studio modules"
    >
      <Link href="/" className="admin2-rail-brand" aria-label="Central Studio Dashboard"><Activity /></Link>
      <nav className="admin2-rail-nav" aria-label="Global modules">
        {railNodes.map((node) => {
          const Icon = (node.icon ?? ChevronDown) as LucideIcon;
          const active = navNodeContainsLocation(node, location);
          const target = firstVisibleNavLink(node);
          const label = node.title;
          return <Tooltip key={node.kind === "link" ? node.href : node.title} delayDuration={100}>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn("admin2-rail-button", active && "is-active")}
                onClick={() => target && navigate(target.href)}
                aria-label={label}
                aria-current={active ? "page" : undefined}
                disabled={!target}
              >
                <span className="admin2-rail-indicator" aria-hidden="true" />
                <Icon />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>;
        })}
      </nav>
      <span className="admin2-rail-version">2.0</span>
    </aside>
  );
}

// ─── Mobile drawer (Phase 5A) ─────────────────────────────────────────────────

/**
 * MobileSidebarDrawer — the same SidebarNav mounted inside a left Sheet for
 * small screens (< lg, where the Layout hides the desktop sidebar). Controlled
 * by the Layout; the TopBar hamburger opens it and any navigation closes it.
 * Permission filtering, active-route highlighting, and group expand/collapse
 * are identical to desktop because the nav component is shared.
 */
export function MobileSidebarDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user, logout } = useAdminAuth();
  const close = () => onOpenChange(false);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="flex w-72 max-w-[85vw] flex-col gap-0 border-r border-sidebar-border bg-sidebar p-0 lg:hidden"
        data-testid="mobile-sidebar-drawer"
      >
        {/* Radix a11y: dialog needs a title/description (visually hidden). */}
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SheetDescription className="sr-only">Admin navigation menu</SheetDescription>

        {/* Logo — same brand block as the desktop sidebar */}
        <div className="flex h-20 shrink-0 items-center border-b border-sidebar-border px-4">
          <img
            src={`${import.meta.env.BASE_URL}logo-central-white.png`}
            alt="Central Studio"
            className="h-14 w-auto rounded-md bg-[#071014] px-2"
          />
        </div>

        {/* Nav — shared SidebarNav; navigating closes the drawer */}
        <div className="flex-1 overflow-y-auto py-3">
          <SidebarNav onNavigate={close} />
        </div>

        {/* Footer — same identity block as the desktop sidebar */}
        <div className="shrink-0 border-t border-sidebar-border px-4 py-3">
          <p className="truncate text-[11px] text-muted-foreground">{user?.fullName ?? "Admin"}</p>
          <p className="truncate text-[10px] text-muted-foreground/60">{user?.username}</p>
          <button
            onClick={logout}
            className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground/60 transition-colors hover:text-muted-foreground"
          >
            <LogOut className="h-3 w-3" />
            Sign out
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
