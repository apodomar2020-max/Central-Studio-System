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
  ImagePlay,
} from "lucide-react";
import { cn } from "@/lib/utils";

const studioNav = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Instructors", href: "/instructors", icon: Users },
  { name: "Classes", href: "/classes", icon: CalendarDays },
  { name: "Schedules", href: "/schedules", icon: CalendarRange },
  { name: "Packages", href: "/packages", icon: CreditCard },
  { name: "Bookings", href: "/bookings", icon: Ticket },
  { name: "Students", href: "/students", icon: UserSquare2 },
  { name: "Offers", href: "/offers", icon: Tag },
  { name: "Hero Slides", href: "/hero-items", icon: ImagePlay },
];

const generalNav = [
  { name: "Notifications", href: "/notifications", icon: Bell },
  { name: "Marketing", href: "/marketing", icon: Megaphone },
  { name: "Package Orders", href: "/package-orders", icon: ShoppingBag },
  { name: "Attendance", href: "/attendance", icon: ScanLine },
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
      ? "text-[#8A5CFF]"
      : "text-[#9CA3AF]";

  const activeBg =
    accent === "studio"
      ? "bg-[#00B6D7]/10 border-l-2 border-[#00B6D7]"
      : accent === "stage"
      ? "bg-[#8A5CFF]/10 border-l-2 border-[#8A5CFF]"
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
            {studioNav.map((item) => (
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
      </div>

      {/* Footer */}
      <div
        className="px-4 py-3 border-t"
        style={{ borderColor: "hsl(203 25% 10%)" }}
      >
        <p className="text-[11px] text-[#4E6070]">Central Studio</p>
        <p className="text-[10px] text-[#344A5A]">Admin Operations</p>
      </div>
    </div>
  );
}
