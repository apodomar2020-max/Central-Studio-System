import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Users,
  CalendarDays,
  CalendarRange,
  CreditCard,
  Ticket,
  UserSquare2,
  Tag,
  Bell,
  Megaphone,
  ShoppingBag,
  ScanLine,
  BarChart3,
  ImagePlay,
  ShieldCheck,
  LogOut,
  Music2,
  ClipboardList,
  Settings2,
  Trophy,
  FileText,
  ChevronDown,
} from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { allows, type PermRequirement } from "@/lib/permissions";

interface NavEntry {
  name: string;
  href: string;
  icon: React.ElementType;
  /** Permission requirement to display this entry (any one pair grants it). */
  perm: PermRequirement;
}

const studioNavTop: NavEntry[] = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard, perm: [["dashboard", "view"]] },
  { name: "Instructors", href: "/instructors", icon: Users, perm: [["instructors", "view"]] },
  { name: "Classes", href: "/classes", icon: CalendarDays, perm: [["classes", "view"]] },
  { name: "Schedules", href: "/schedules", icon: CalendarRange, perm: [["schedules", "view"]] },
  { name: "Packages", href: "/packages", icon: CreditCard, perm: [["packages", "view"]] },
  { name: "Bookings", href: "/bookings", icon: Ticket, perm: [["bookings", "view"]] },
];

const studioNavBottom: NavEntry[] = [
  { name: "Offers", href: "/offers", icon: Tag, perm: [["offers", "view"]] },
  { name: "Hero Slides", href: "/hero-items", icon: ImagePlay, perm: [["heroSlides", "view"]] },
];

const balletNav: NavEntry[] = [
  { name: "Applications", href: "/ballet/applications", icon: ClipboardList, perm: [["ballet.applications", "view"]] },
  { name: "Assessment Dates", href: "/ballet/slots", icon: CalendarDays, perm: [["ballet.assessmentDates", "view"]] },
  { name: "Pricing & Settings", href: "/ballet/settings", icon: Settings2, perm: [["ballet.pricing", "view"]] },
  { name: "Levels", href: "/ballet/levels", icon: Trophy, perm: [["ballet.levels", "view"]] },
];

const generalNav: NavEntry[] = [
  { name: "Notifications", href: "/notifications", icon: Bell, perm: [["notifications", "view"]] },
  { name: "Marketing", href: "/marketing", icon: Megaphone, perm: [["marketing", "view"]] },
  { name: "Package Orders", href: "/package-orders", icon: ShoppingBag, perm: [["packageOrders", "view"]] },
  { name: "Attendance", href: "/attendance", icon: ScanLine, perm: [["attendance", "view"]] },
  { name: "Reports", href: "/reports", icon: BarChart3, perm: [["reports", "view"]] },
];

const systemNav: NavEntry[] = [
  { name: "App Content", href: "/app-content", icon: FileText, perm: [["appContent", "view"]] },
  { name: "System Users", href: "/system-users", icon: ShieldCheck, perm: [["adminUsers", "view"], ["roles", "view"]] },
  { name: "Settings", href: "/settings", icon: Settings2, perm: [["settings", "view"]] },
];

function NavItem({
  item,
  isActive,
  accent,
}: {
  item: { name: string; href: string; icon: React.ElementType };
  isActive: boolean;
  accent: "studio" | "stage" | "general";
}) {
  const accentColor =
    accent === "studio"
      ? "text-[#00B6D7]"
      : accent === "stage"
      ? "text-[#00B6D6]"
      : "text-[#9CA3AF]";

  const activeBg =
    accent === "studio"
      ? "bg-[#00B6D7]/10 border-l-2 border-[#00B6D7]"
      : accent === "stage"
      ? "bg-[#00B6D6]/10 border-l-2 border-[#00B6D6]"
      : "bg-[#00B6D7]/8 border-l-2 border-[#00B6D7]/60";

  return (
    <Link href={item.href}>
      <div
        className={cn(
          "group flex items-center px-3 py-2 text-sm font-medium rounded-r-lg cursor-pointer transition-all duration-150 ml-0 pl-3",
          isActive
            ? cn(activeBg, accentColor)
            : "text-muted-foreground hover:text-foreground hover:bg-accent border-l-2 border-transparent"
        )}
      >
        <item.icon
          className={cn(
            "mr-3 h-[18px] w-[18px] flex-shrink-0 transition-colors",
            isActive
              ? accentColor
              : "text-muted-foreground/60 group-hover:text-muted-foreground"
          )}
          aria-hidden="true"
        />
        {item.name}
      </div>
    </Link>
  );
}

export function Sidebar() {
  const [location] = useLocation();
  const { user, logout, can } = useAdminAuth();
  const [usersOpen, setUsersOpen] = useState(
    location === "/students" || location.startsWith("/parents")
  );

  useEffect(() => {
    if (location === "/students" || location.startsWith("/parents")) {
      setUsersOpen(true);
    }
  }, [location]);

  const isActive = (href: string) =>
    href === "/"
      ? location === "/"
      : location === href || location.startsWith(href + "/");

  // ── Permission-filtered nav (Super Admin passes everything via can()) ──
  const visible = (entries: NavEntry[]) => entries.filter((e) => allows(can, e.perm));
  const studioTop = visible(studioNavTop);
  const studioBottom = visible(studioNavBottom);
  const ballet = visible(balletNav);
  const general = visible(generalNav);
  const system = visible(systemNav);

  // Users group: only its real sub-links (Students/Parents) gate visibility, so
  // we never render an empty group.
  const canStudents = allows(can, [["students", "view"]]);
  const canParents = allows(can, [["parents", "view"]]);
  const usersGroupVisible = canStudents || canParents;

  const studioSectionVisible =
    studioTop.length > 0 || studioBottom.length > 0 || usersGroupVisible;

  return (
    <div className="flex h-full w-60 flex-col border-r bg-sidebar border-sidebar-border shadow-[8px_0_28px_rgba(0,0,0,.06)] transition-colors duration-200">
      {/* Logo */}
      <div className="flex h-20 items-center px-4 border-b border-sidebar-border">
        <img
          src={`${import.meta.env.BASE_URL}logo-central-white.png`}
          alt="Central Studio"
          className="h-14 w-auto rounded-md bg-[#071014] px-2"
        />
      </div>

      <div className="flex-1 overflow-y-auto py-4 space-y-5">
        {/* Studio section */}
        {studioSectionVisible && (
          <div>
            <div className="px-4 mb-1">
              <span className="text-[10px] font-semibold tracking-widest uppercase text-[#00B6D7]/60">
                Studio
              </span>
            </div>
            <nav className="space-y-0.5 pr-2">
              {studioTop.map((item) => (
                <NavItem
                  key={item.name}
                  item={item}
                  isActive={isActive(item.href)}
                  accent="studio"
                />
              ))}

              {/* Collapsible Users Group (only its real sub-links gate visibility) */}
              {usersGroupVisible && (
                <div className="space-y-0.5">
                  <button
                    onClick={() => setUsersOpen(!usersOpen)}
                    className={cn(
                      "w-full group flex items-center justify-between px-3 py-2 text-sm font-medium rounded-r-lg cursor-pointer transition-all duration-150 ml-0 pl-3 focus:outline-none",
                      (location === "/students" || location.startsWith("/parents"))
                        ? "bg-[#00B6D7]/10 text-[#00B6D7] border-l-2 border-[#00B6D7]"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent border-l-2 border-transparent"
                    )}
                  >
                    <div className="flex items-center">
                      <UserSquare2
                        className={cn(
                          "mr-3 h-[18px] w-[18px] flex-shrink-0 transition-colors",
                          (location === "/students" || location.startsWith("/parents"))
                            ? "text-[#00B6D7]"
                            : "text-muted-foreground/60 group-hover:text-muted-foreground"
                        )}
                      />
                      <span>Users</span>
                    </div>
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 transition-transform duration-150 text-muted-foreground/60 group-hover:text-muted-foreground",
                        usersOpen && "transform rotate-180"
                      )}
                    />
                  </button>

                  {usersOpen && (
                    <div className="pl-6 space-y-0.5 mt-0.5">
                      {canStudents && (
                        <Link href="/students">
                          <div
                            className={cn(
                              "flex items-center px-3 py-1.5 text-xs font-medium rounded-r-lg cursor-pointer transition-all duration-150 border-l-2 border-transparent",
                              location === "/students"
                                ? "text-[#00B6D7] bg-[#00B6D7]/5"
                                : "text-muted-foreground hover:text-foreground hover:bg-accent"
                            )}
                          >
                            Students
                          </div>
                        </Link>
                      )}
                      {canParents && (
                        <Link href="/parents">
                          <div
                            className={cn(
                              "flex items-center px-3 py-1.5 text-xs font-medium rounded-r-lg cursor-pointer transition-all duration-150 border-l-2 border-transparent",
                              location.startsWith("/parents")
                                ? "text-[#00B6D7] bg-[#00B6D7]/5"
                                : "text-muted-foreground hover:text-foreground hover:bg-accent"
                            )}
                          >
                            Parents
                          </div>
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              )}

              {studioBottom.map((item) => (
                <NavItem
                  key={item.name}
                  item={item}
                  isActive={isActive(item.href)}
                  accent="studio"
                />
              ))}
            </nav>
          </div>
        )}

        {/* Ballet section */}
        {ballet.length > 0 && (
          <>
            {studioSectionVisible && <div className="mx-4 border-t border-sidebar-border" />}
            <div>
              <div className="px-4 mb-1 flex items-center gap-1.5">
                <Music2 className="h-2.5 w-2.5 text-[#00B6D6]/60" />
                <span className="text-[10px] font-semibold tracking-widest uppercase text-[#00B6D6]/60">
                  Ballet
                </span>
              </div>
              <nav className="space-y-0.5 pr-2">
                {ballet.map((item) => (
                  <NavItem
                    key={item.name}
                    item={item}
                    isActive={isActive(item.href)}
                    accent="stage"
                  />
                ))}
              </nav>
            </div>
          </>
        )}

        {/* General */}
        {general.length > 0 && (
          <>
            <div className="mx-4 border-t border-sidebar-border" />
            <div>
              <nav className="space-y-0.5 pr-2">
                {general.map((item) => (
                  <NavItem
                    key={item.name}
                    item={item}
                    isActive={isActive(item.href)}
                    accent="general"
                  />
                ))}
              </nav>
            </div>
          </>
        )}

        {/* System section — visible per-permission (Super Admin sees all) */}
        {system.length > 0 && (
          <>
            <div className="mx-4 border-t border-sidebar-border" />
            <div>
              <div className="px-4 mb-1">
                <span className="text-[10px] font-semibold tracking-widest uppercase text-[#00B6D6]/60">
                  System
                </span>
              </div>
              <nav className="space-y-0.5 pr-2">
                {system.map((item) => (
                  <NavItem
                    key={item.name}
                    item={item}
                    isActive={isActive(item.href)}
                    accent="stage"
                  />
                ))}
              </nav>
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-sidebar-border px-4 py-3">
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
    </div>
  );
}
