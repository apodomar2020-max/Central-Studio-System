import { Link } from "wouter";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAdminAuth } from "@/contexts/AdminAuthContext";

const SAFE_DESTINATIONS = [
  { href: "/", label: "Dashboard", permission: ["dashboard", "view"] },
  { href: "/bookings", label: "Bookings", permission: ["bookings", "view"] },
  { href: "/attendance", label: "Attendance", permission: ["attendance", "view"] },
  { href: "/students", label: "Students", permission: ["students", "view"] },
  { href: "/parents", label: "Parents", permission: ["parents", "view"] },
  { href: "/classes", label: "Classes", permission: ["classes", "view"] },
  { href: "/schedules", label: "Schedules", permission: ["schedules", "view"] },
  { href: "/packages", label: "Packages", permission: ["packages", "view"] },
  { href: "/reports", label: "Reports", permission: ["reports", "view"] },
] as const;

/**
 * Access Denied — shown when an authenticated admin opens a page (or area) their
 * role has no permission for. This screen is UI-only presentation: the backend
 * independently enforces the same permission on every route/endpoint via
 * requireAdminPermission (see routes/adminAuth.ts) — hiding a page here never
 * substitutes for that guard, it only avoids rendering it. Authenticated users
 * are never redirected to login from here.
 */
export function AccessDenied({ message }: { message?: string }) {
  const { can } = useAdminAuth();
  const destination = SAFE_DESTINATIONS.find(({ permission }) =>
    can(permission[0], permission[1]),
  );

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-destructive/10">
        <ShieldAlert className="h-8 w-8 text-destructive" />
      </div>
      <h1 className="mt-6 text-2xl font-bold tracking-tight text-foreground">Access Denied</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        {message ?? "You do not have permission to access this area."}
      </p>
      <p className="mt-1 max-w-md text-xs text-muted-foreground/70">
        Contact your administrator if you believe this is a mistake.
      </p>
      {destination ? (
        <Link href={destination.href}>
          <Button className="mt-6" variant="outline">
            Go to {destination.label}
          </Button>
        </Link>
      ) : (
        <Button className="mt-6 gap-2" variant="outline" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4" /> Go Back
        </Button>
      )}
    </div>
  );
}

export default AccessDenied;
