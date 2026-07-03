/**
 * TopBar — shared global header rendered on every authenticated admin page.
 *
 * Phase 1 (Layout Foundation). Lives inside the right-hand flex column of the
 * Layout in App.tsx as a `shrink-0` row above the scrollable <main>, so it can
 * never overlap page content (no fixed/absolute positioning).
 *
 * Contents:
 *  - Current page title (resolved from nav-config by wouter location)
 *  - Central brand mark
 *  - Refresh (refetches ACTIVE queries only — gated by dashboard.refresh)
 *  - Dark / light theme toggle (existing AdminThemeContext — gated by
 *    dashboard.themeToggle; "night" is the light scheme, UI says Light/Dark)
 *  - Settings shortcut (gated by settings.view)
 *  - User menu: identity + sign out (always visible when authenticated)
 */
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Moon, RefreshCw, Settings2, Sun, LogOut, ChevronDown } from "lucide-react";
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
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { useAdminTheme } from "@/contexts/AdminThemeContext";
import { resolvePageTitle } from "@/components/layout/nav-config";

function initials(name: string | undefined): string {
  if (!name) return "AD";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "AD";
}

export function TopBar() {
  const [location] = useLocation();
  const { user, logout, can } = useAdminAuth();
  const { theme, toggleTheme } = useAdminTheme();
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const title = resolvePageTitle(location);

  // Same permissions the dashboard buttons used before Phase 1 relocated them.
  const canRefresh = can("dashboard", "refresh");
  const canThemeToggle = can("dashboard", "themeToggle");
  const canSettings = can("settings", "view");

  // "night" is the light color scheme (see index.css) — label it Light in UI.
  const isDark = theme === "dark";

  async function handleRefresh() {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      // Refetch only queries currently mounted on the page — no full reload.
      await queryClient.refetchQueries({ type: "active" });
    } finally {
      setIsRefreshing(false);
    }
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/95 px-4 transition-colors duration-200 sm:px-6">
      {/* Brand mark + page title */}
      <div className="flex min-w-0 items-center gap-3">
        <img
          src={`${import.meta.env.BASE_URL}logo-central-white.png`}
          alt="Central Studio"
          className="h-7 w-auto shrink-0 rounded bg-[#071014] px-1.5"
        />
        <div className="h-5 w-px shrink-0 bg-border" aria-hidden="true" />
        <h1 className="truncate text-sm font-semibold tracking-tight text-foreground" data-testid="topbar-title">
          {title}
        </h1>
      </div>

      {/* Right cluster */}
      <div className="ml-auto flex items-center gap-1.5">
        {canRefresh && (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRefresh}
            disabled={isRefreshing}
            title="Refresh current page data"
            aria-label="Refresh current page data"
            data-testid="topbar-refresh"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
          </Button>
        )}

        {canThemeToggle && (
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            title={isDark ? "Switch to light mode" : "Switch to dark mode"}
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            data-testid="topbar-theme-toggle"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
          >
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        )}

        {canSettings && (
          <Link href="/settings">
            <Button
              variant="ghost"
              size="icon"
              title="Settings"
              aria-label="Settings"
              data-testid="topbar-settings"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
            >
              <Settings2 className="h-4 w-4" />
            </Button>
          </Link>
        )}

        <div className="mx-1 h-5 w-px bg-border" aria-hidden="true" />

        {/* User menu — always visible for authenticated admins */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-accent focus:outline-none"
              data-testid="topbar-user-menu"
            >
              <Avatar className="h-7 w-7">
                <AvatarFallback className="text-[10px] font-semibold">
                  {initials(user?.fullName)}
                </AvatarFallback>
              </Avatar>
              <span className="hidden max-w-[140px] truncate text-xs font-medium text-foreground sm:block">
                {user?.fullName ?? "Admin"}
              </span>
              <ChevronDown className="hidden h-3.5 w-3.5 text-muted-foreground sm:block" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <p className="truncate text-sm font-medium">{user?.fullName ?? "Admin"}</p>
              <p className="truncate text-xs font-normal text-muted-foreground">{user?.username}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={logout}
              data-testid="topbar-sign-out"
              className="cursor-pointer text-destructive focus:text-destructive"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
