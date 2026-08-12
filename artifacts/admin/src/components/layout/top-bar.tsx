import { useEffect, useRef, useState, type ElementType } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  RefreshCw,
  ScanLine,
  Settings2,
  Sun,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { useAdminTheme } from "@/contexts/AdminThemeContext";
import { allows } from "@/lib/permissions";
import {
  NAV_TREE,
  filterVisibleNavTree,
  firstVisibleNavLink,
  navNodeContainsLocation,
  resolveNavigationContext,
  resolvePageMeta,
  type NavNode,
} from "@/components/layout/nav-config";

function initials(name: string | undefined): string {
  if (!name) return "SA";
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("") || "SA";
}

function ContextualDestination({ node, location, activeRef }: { node: NavNode; location: string; activeRef: React.RefObject<HTMLAnchorElement | null> }) {
  const link = firstVisibleNavLink(node);
  if (!link) return null;
  const selected = navNodeContainsLocation(node, location);
  const DestinationIcon = node.icon ?? link.icon ?? LayoutDashboard;
  return <Link
    ref={selected ? activeRef : undefined}
    href={link.href}
    className={cn("admin2-context-link", selected && "is-active")}
    aria-current={selected ? "page" : undefined}
  >
    <DestinationIcon aria-hidden="true" />
    <span>{node.title}</span>
  </Link>;
}

function ContextIcon({ icon: Icon }: { icon?: ElementType }) {
  const Resolved = Icon ?? LayoutDashboard;
  return <Resolved aria-hidden="true" />;
}

function ContextModuleIdentity({ label, icon, href }: { label: string; icon?: ElementType; href?: string }) {
  const identity = <span className="admin2-context-label" aria-label={`${label} module`} role="img"><ContextIcon icon={icon} /></span>;
  return <Tooltip delayDuration={100}>
    <TooltipTrigger asChild>
      {href ? <Link href={href} className="admin2-context-module" aria-label={`${label} module`}>{identity}</Link> : identity}
    </TooltipTrigger>
    <TooltipContent>{label}</TooltipContent>
  </Tooltip>;
}

export function TopBar({ onOpenMobileNav }: { onOpenMobileNav?: () => void } = {}) {
  const [location] = useLocation();
  const { user, logout, can } = useAdminAuth();
  const { theme, toggleTheme } = useAdminTheme();
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const activeContextRef = useRef<HTMLAnchorElement>(null);
  const contextTrackRef = useRef<HTMLDivElement>(null);
  const [contextOverflow, setContextOverflow] = useState({ start: false, end: false });

  const meta = resolvePageMeta(location);
  const PageIcon = meta.icon ?? LayoutDashboard;
  const visibleTree = filterVisibleNavTree(NAV_TREE, can, allows);
  const navigationContext = resolveNavigationContext(visibleTree, location);
  const rootContext = navigationContext.root?.kind === "group" ? navigationContext.root : navigationContext.context;
  const contextNodes = rootContext?.children ?? [];
  const contextLabel = navigationContext.root?.title ?? rootContext?.title ?? meta.breadcrumbs[0] ?? "Dashboard";
  const contextIcon = navigationContext.root?.icon ?? rootContext?.icon;
  const contextHome = navigationContext.root ? firstVisibleNavLink(navigationContext.root)?.href : undefined;

  const canRefresh = can("dashboard", "refresh");
  const canThemeToggle = can("dashboard", "themeToggle");
  const canSettings = can("settings", "view");
  const canAttendance = can("attendance", "view");
  const isDark = theme === "dark";

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    activeContextRef.current?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
  }, [location]);

  useEffect(() => {
    const track = contextTrackRef.current;
    if (!track) return;
    const ensureActiveVisible = () => {
      const active = activeContextRef.current;
      if (!active) return;
      const trackRect = track.getBoundingClientRect();
      const activeRect = active.getBoundingClientRect();
      if (activeRect.left < trackRect.left) {
        track.scrollBy({ left: activeRect.left - trackRect.left - 8, behavior: "auto" });
      } else if (activeRect.right > trackRect.right) {
        track.scrollBy({ left: activeRect.right - trackRect.right + 8, behavior: "auto" });
      }
    };
    const updateOverflow = () => {
      ensureActiveVisible();
      const maxScroll = Math.max(0, track.scrollWidth - track.clientWidth);
      setContextOverflow({
        start: track.scrollLeft > 2,
        end: track.scrollLeft < maxScroll - 2,
      });
    };
    const frame = requestAnimationFrame(updateOverflow);
    track.addEventListener("scroll", updateOverflow, { passive: true });
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(track);
    return () => {
      track.removeEventListener("scroll", updateOverflow);
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [contextLabel, contextNodes.length, location]);

  const scrollContext = (direction: -1 | 1) => {
    const track = contextTrackRef.current;
    if (!track) return;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    track.scrollBy({
      left: direction * Math.max(180, Math.round(track.clientWidth * 0.72)),
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
  };

  async function handleRefresh() {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await queryClient.refetchQueries({ type: "active" });
    } finally {
      setIsRefreshing(false);
    }
  }

  return <header className="admin2-topbar">
    <div className="admin2-globalbar">
      <div className="admin2-global-brand">
        {onOpenMobileNav && <Button variant="ghost" size="icon" onClick={onOpenMobileNav} aria-label="Open navigation menu" data-testid="topbar-mobile-menu" className="admin2-utility-button lg:hidden"><Menu /></Button>}
        {/* Production refinement: official Central Studio wordmark replaces
            the generic Wave/Pulse icon (no "Admin 2.0" text beside it — the
            logo is the identity now). The page breadcrumb moves in beside
            the logo, reusing the exact same meta.breadcrumbs the page title
            used to render above itself — same canonical nav-config
            resolution (resolvePageMeta), not a second breadcrumb source —
            so it no longer repeats above the title. */}
        <img
          src={`${import.meta.env.BASE_URL}${isDark ? "logo-central-white.png" : "logo-central-studio.png"}`}
          alt="Central Studio"
          className="admin2-brand-logo"
        />
        <span className="admin2-brand-breadcrumb" title={meta.breadcrumbs.join(" / ")}>{meta.breadcrumbs.join(" / ")}</span>
      </div>

      <nav key={contextLabel} className="admin2-context-nav" aria-label={`${contextLabel} navigation`}>
        <ContextModuleIdentity label={contextLabel} icon={contextIcon} href={contextHome} />
        <button
          type="button"
          className="admin2-context-scroll"
          onClick={() => scrollContext(-1)}
          aria-label={`Scroll ${contextLabel} navigation backward`}
          disabled={!contextOverflow.start}
          data-edge="start"
        ><ChevronLeft /></button>
        <div ref={contextTrackRef} className="admin2-context-track" tabIndex={0}>
          {contextNodes.map((node) => <ContextualDestination key={node.kind === "link" ? node.href : node.title} node={node} location={location} activeRef={activeContextRef} />)}
        </div>
        <button
          type="button"
          className="admin2-context-scroll"
          onClick={() => scrollContext(1)}
          aria-label={`Scroll ${contextLabel} navigation forward`}
          disabled={!contextOverflow.end}
          data-edge="end"
        ><ChevronRight /></button>
      </nav>

      <div className="admin2-utilities">
        {canAttendance && <Link href="/attendance"><Button variant="ghost" size="icon" aria-label="Open Attendance" title="Attendance" className={cn("admin2-utility-button", location.startsWith("/attendance") && "is-active")}><ScanLine /></Button></Link>}
        {canRefresh && <Button variant="ghost" size="icon" onClick={handleRefresh} disabled={isRefreshing} aria-label="Refresh current page data" title="Refresh" data-testid="topbar-refresh" className="admin2-utility-button"><RefreshCw className={isRefreshing ? "animate-spin" : ""} /></Button>}
        {canThemeToggle && <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"} title={isDark ? "Light theme" : "Dark theme"} data-testid="topbar-theme-toggle" className="admin2-utility-button">{isDark ? <Moon /> : <Sun />}</Button>}
        {canSettings && <Link href="/settings"><Button variant="ghost" size="icon" aria-label="Settings" title="Settings" data-testid="topbar-settings" className={cn("admin2-utility-button", location.startsWith("/settings") && "is-active")}><Settings2 /></Button></Link>}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="admin2-profile-button" aria-label="Open account menu" data-testid="topbar-user-menu"><Avatar><AvatarFallback>{initials(user?.fullName)}</AvatarFallback></Avatar><ChevronDown /></button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel><p className="truncate text-sm font-medium">{user?.fullName ?? "Admin"}</p><p className="truncate text-xs font-normal text-muted-foreground">{user?.username}</p></DropdownMenuLabel>
            <DropdownMenuSeparator />
            {canSettings && <DropdownMenuItem asChild><Link href="/settings"><Settings2 className="mr-2 h-4 w-4" />Settings</Link></DropdownMenuItem>}
            <DropdownMenuItem onClick={logout} data-testid="topbar-sign-out" className="text-destructive focus:text-destructive"><LogOut className="mr-2 h-4 w-4" />Sign out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>

    <div className="admin2-pagebar">
      <span className="admin2-page-icon"><PageIcon /></span>
      <div className="admin2-page-copy">
        <h1 data-testid="topbar-title">{location === "/" ? "Operations Dashboard" : meta.title}</h1>
        {meta.description && <p>{meta.description}</p>}
      </div>
    </div>
  </header>;
}
