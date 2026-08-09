/**
 * TopBar — unified single global header for the admin shell.
 *
 * Spans the full width of the main content area with:
 *  - Left-aligned page identity block (icon in glowing container, page title, and breadcrumb path)
 *  - Right-aligned authentic controls cluster (Refresh pill button, premium Theme toggle switch,
 *    Settings link if permitted, and User Profile dropdown pill)
 */
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  Menu,
  Moon,
  RefreshCw,
  Settings2,
  Sun,
  LogOut,
  ChevronDown,
  LayoutDashboard,
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
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { useAdminTheme } from "@/contexts/AdminThemeContext";
import { resolvePageMeta } from "@/components/layout/nav-config";

function initials(name: string | undefined): string {
  if (!name) return "SA";
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "SA"
  );
}

export function TopBar({ onOpenMobileNav }: { onOpenMobileNav?: () => void } = {}) {
  const [location] = useLocation();
  const { user, logout, can } = useAdminAuth();
  const { theme, toggleTheme } = useAdminTheme();
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const meta = resolvePageMeta(location);
  const IconComponent = meta.icon;

  const canRefresh = can("dashboard", "refresh");
  const canThemeToggle = can("dashboard", "themeToggle");
  const canSettings = can("settings", "view");

  const isDark = theme === "dark";

  async function handleRefresh() {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await queryClient.refetchQueries({ type: "active" });
    } finally {
      setIsRefreshing(false);
    }
  }

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between border-b border-border/70 bg-background/95 px-4 backdrop-blur transition-colors duration-200 sm:px-6">
      {/* Left section: Mobile drawer trigger + Page Identity Block */}
      <div className="flex min-w-0 items-center gap-3">
        {onOpenMobileNav && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenMobileNav}
            title="Open navigation menu"
            aria-label="Open navigation menu"
            data-testid="topbar-mobile-menu"
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </Button>
        )}

        {/* Primary Page Identity Block */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#00B6D7]/25 bg-[#00B6D7]/10 text-[#00B6D7] shadow-sm">
            {IconComponent ? (
              <IconComponent className="h-5 w-5" />
            ) : (
              <LayoutDashboard className="h-5 w-5" />
            )}
          </div>

          <div className="flex flex-col min-w-0 justify-center">
            <h1
              className="truncate text-sm font-bold tracking-tight text-foreground sm:text-base leading-tight"
              data-testid="topbar-title"
            >
              {meta.title}
            </h1>
            <div className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground truncate leading-tight mt-0.5">
              {meta.breadcrumbs.map((crumb, idx) => (
                <span key={idx} className="flex items-center gap-1 shrink-0">
                  {idx > 0 && <span className="text-muted-foreground/40">/</span>}
                  <span
                    className={
                      idx === meta.breadcrumbs.length - 1
                        ? "text-muted-foreground"
                        : "text-muted-foreground/70"
                    }
                  >
                    {crumb}
                  </span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Right section: Header Controls Cluster */}
      <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
        {/* Refresh Action */}
        {canRefresh && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            title="Refresh current page data"
            aria-label="Refresh current page data"
            data-testid="topbar-refresh"
            className="h-8 gap-1.5 rounded-lg border-border/60 bg-muted/30 px-3 text-xs font-medium text-foreground hover:bg-accent hover:text-foreground transition-all"
          >
            <RefreshCw
              className={cn(
                "h-3.5 w-3.5 text-muted-foreground",
                isRefreshing && "animate-spin text-[#00B6D7]"
              )}
            />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        )}

        {/* Premium Theme Switcher */}
        {canThemeToggle && (
          <div className="flex items-center gap-2 px-1 text-xs font-medium text-muted-foreground">
            <span className="hidden sm:inline text-xs">Theme</span>
            <button
              onClick={toggleTheme}
              type="button"
              data-testid="topbar-theme-toggle"
              title={isDark ? "Switch to light mode" : "Switch to dark mode"}
              aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
              className={cn(
                "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-1 focus:ring-[#00B6D7]",
                isDark ? "bg-[#00B6D7]/20 border-[#00B6D7]/40" : "bg-slate-300"
              )}
            >
              <span
                className={cn(
                  "pointer-events-none inline-flex h-4 w-4 transform items-center justify-center rounded-full bg-[#00B6D7] text-black shadow-md ring-0 transition duration-200 ease-in-out",
                  isDark ? "translate-x-4" : "translate-x-0 bg-amber-400"
                )}
              >
                {isDark ? <Sun className="h-2.5 w-2.5" /> : <Moon className="h-2.5 w-2.5" />}
              </span>
            </button>
          </div>
        )}

        {/* Settings Shortcut Link */}
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

        {/* User Profile Pill Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex items-center gap-2.5 rounded-lg border border-border/50 bg-muted/20 px-2.5 py-1 text-left transition-colors hover:bg-accent focus:outline-none"
              data-testid="topbar-user-menu"
            >
              <Avatar className="h-7 w-7">
                <AvatarFallback className="bg-[#00B6D7]/20 text-[#00B6D7] text-[11px] font-bold">
                  {initials(user?.fullName)}
                </AvatarFallback>
              </Avatar>
              <div className="hidden flex-col sm:flex min-w-0 max-w-[120px]">
                <span className="truncate text-xs font-semibold text-foreground leading-none">
                  {user?.fullName ?? "Super Admin"}
                </span>
                <span className="truncate text-[10px] text-muted-foreground leading-tight mt-0.5">
                  {user?.role?.name ?? (user?.isSuperAdmin ? "Administrator" : "User")}
                </span>
              </div>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <p className="truncate text-sm font-medium">{user?.fullName ?? "Admin"}</p>
              <p className="truncate text-xs font-normal text-muted-foreground">{user?.username}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {canSettings && (
              <DropdownMenuItem asChild className="cursor-pointer">
                <Link href="/settings">
                  <Settings2 className="mr-2 h-4 w-4" />
                  Settings
                </Link>
              </DropdownMenuItem>
            )}
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
