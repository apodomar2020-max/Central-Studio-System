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

const studioNavTop = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Instructors", href: "/instructors", icon: Users },
  { name: "Classes", href: "/classes", icon: CalendarDays },
  { name: "Schedules", href: "/schedules", icon: CalendarRange },
  { name: "Packages", href: "/packages", icon: CreditCard },
  { name: "Bookings", href: "/bookings", icon: Ticket },
];

const studioNavBottom = [
  { name: "Offers", href: "/offers", icon: Tag },
  { name: "Hero Slides", href: "/hero-items", icon: ImagePlay },
];

const balletNav = [
  { name: "Applications", href: "/ballet/applications", icon: ClipboardList },
  { name: "Assessment Dates", href: "/ballet/slots", icon: CalendarDays },
  { name: "Pricing & Settings", href: "/ballet/settings", icon: Settings2 },
  { name: "Levels", href: "/ballet/levels", icon: Trophy },
];

const generalNav = [
  { name: "Notifications", href: "/notifications", icon: Bell },
  { name: "Marketing", href: "/marketing", icon: Megaphone },
  { name: "Package Orders", href: "/package-orders", icon: ShoppingBag },
  { name: "Attendance", href: "/attendance", icon: ScanLine },
  { name: "Reports", href: "/reports", icon: BarChart3 },
];

const systemNav = [
  { name: "App Content", href: "/app-content", icon: FileText },
  { name: "System Users", href: "/system-users", icon: ShieldCheck },
  { name: "Settings", href: "/settings", icon: Settings2 },
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
            : "text-[#8A9AB0] hover:text-white hover:bg-white/5 border-l-2 border-transparent"
        )}
      >
        <item.icon
          className={cn(
            "mr-3 h-[18px] w-[18px] flex-shrink-0 transition-colors",
            isActive
              ? accentColor
              : "text-[#4E6070] group-hover:text-[#8A9AB0]"
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
  const { user, logout } = useAdminAuth();
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

  return (
    <div
      className="flex h-full w-60 flex-col border-r"
      style={{
        background: "hsl(204 46% 3%)",
        borderColor: "hsl(203 25% 10%)",
      }}
    >
      {/* Logo */}
      <div className="flex h-20 items-center px-4 border-b" style={{ borderColor: "hsl(203 25% 10%)" }}>
        <img
          src={`${import.meta.env.BASE_URL}logo-central-white.png`}
          alt="Central Studio"
          className="h-14 w-auto"
        />
      </div>

      <div className="flex-1 overflow-y-auto py-4 space-y-5">
        {/* Studio section */}
        <div>
          <div className="px-4 mb-1">
            <span className="text-[10px] font-semibold tracking-widest uppercase text-[#00B6D7]/60">
              Studio
            </span>
          </div>
          <nav className="space-y-0.5 pr-2">
            {studioNavTop.map((item) => (
              <NavItem
                key={item.name}
                item={item}
                isActive={isActive(item.href)}
                accent="studio"
              />
            ))}

            {/* Collapsible Users Group */}
            <div className="space-y-0.5">
              <button
                onClick={() => setUsersOpen(!usersOpen)}
                className={cn(
                  "w-full group flex items-center justify-between px-3 py-2 text-sm font-medium rounded-r-lg cursor-pointer transition-all duration-150 ml-0 pl-3 focus:outline-none",
                  (location === "/students" || location.startsWith("/parents"))
                    ? "bg-[#00B6D7]/10 text-[#00B6D7] border-l-2 border-[#00B6D7]"
                    : "text-[#8A9AB0] hover:text-white hover:bg-white/5 border-l-2 border-transparent"
                )}
              >
                <div className="flex items-center">
                  <UserSquare2
                    className={cn(
                      "mr-3 h-[18px] w-[18px] flex-shrink-0 transition-colors",
                      (location === "/students" || location.startsWith("/parents"))
                        ? "text-[#00B6D7]"
                        : "text-[#4E6070] group-hover:text-[#8A9AB0]"
                    )}
                  />
                  <span>Users</span>
                </div>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 transition-transform duration-150 text-[#4E6070] group-hover:text-[#8A9AB0]",
                    usersOpen && "transform rotate-180"
                  )}
                />
              </button>

              {usersOpen && (
                <div className="pl-6 space-y-0.5 mt-0.5">
                  <Link href="/students">
                    <div
                      className={cn(
                        "flex items-center px-3 py-1.5 text-xs font-medium rounded-r-lg cursor-pointer transition-all duration-150 border-l-2 border-transparent",
                        location === "/students"
                          ? "text-[#00B6D7] bg-[#00B6D7]/5"
                          : "text-[#8A9AB0] hover:text-white hover:bg-white/5"
                      )}
                    >
                      Students
                    </div>
                  </Link>
                  <Link href="/parents">
                    <div
                      className={cn(
                        "flex items-center px-3 py-1.5 text-xs font-medium rounded-r-lg cursor-pointer transition-all duration-150 border-l-2 border-transparent",
                        location.startsWith("/parents")
                          ? "text-[#00B6D7] bg-[#00B6D7]/5"
                          : "text-[#8A9AB0] hover:text-white hover:bg-white/5"
                      )}
                    >
                      Parents
                    </div>
                  </Link>
                </div>
              )}
            </div>

            {studioNavBottom.map((item) => (
              <NavItem
                key={item.name}
                item={item}
                isActive={isActive(item.href)}
                accent="studio"
              />
            ))}
          </nav>
        </div>

        {/* Divider */}
        <div className="mx-4 border-t" style={{ borderColor: "hsl(203 25% 12%)" }} />

        {/* Ballet section */}
        <div>
          <div className="px-4 mb-1 flex items-center gap-1.5">
            <Music2 className="h-2.5 w-2.5 text-[#00B6D6]/60" />
            <span className="text-[10px] font-semibold tracking-widest uppercase text-[#00B6D6]/60">
              Ballet
            </span>
          </div>
          <nav className="space-y-0.5 pr-2">
            {balletNav.map((item) => (
              <NavItem
                key={item.name}
                item={item}
                isActive={isActive(item.href)}
                accent="stage"
              />
            ))}
          </nav>
        </div>

        {/* Divider */}
        <div className="mx-4 border-t" style={{ borderColor: "hsl(203 25% 12%)" }} />

        {/* General */}
        <div>
          <nav className="space-y-0.5 pr-2">
            {generalNav.map((item) => (
              <NavItem
                key={item.name}
                item={item}
                isActive={isActive(item.href)}
                accent="general"
              />
            ))}
          </nav>
        </div>

        {/* System section — Super Admin only */}
        {user?.isSuperAdmin && (
          <>
            <div className="mx-4 border-t" style={{ borderColor: "hsl(203 25% 12%)" }} />
            <div>
              <div className="px-4 mb-1">
                <span className="text-[10px] font-semibold tracking-widest uppercase text-[#00B6D6]/60">
                  System
                </span>
              </div>
              <nav className="space-y-0.5 pr-2">
                {systemNav.map((item) => (
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
      <div
        className="px-4 py-3 border-t"
        style={{ borderColor: "hsl(203 25% 10%)" }}
      >
        <p className="text-[11px] text-[#8A9AB0] truncate">{user?.fullName ?? "Admin"}</p>
        <p className="text-[10px] text-[#4E6070] truncate">{user?.username}</p>
        <button
          onClick={logout}
          className="mt-2 flex items-center gap-1.5 text-[10px] text-[#4E6070] hover:text-[#8A9AB0] transition-colors"
        >
          <LogOut className="h-3 w-3" />
          Sign out
        </button>
      </div>
    </div>
  );
}
