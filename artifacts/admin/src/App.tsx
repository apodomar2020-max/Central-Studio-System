import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setBaseUrl, setAuthTokenGetter, setAdminTokenGetter } from "@workspace/api-client-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Loader2 } from "lucide-react";
import NotFound from "@/pages/not-found";
import { Sidebar } from "@/components/layout/sidebar";
import { ADMIN_TOKEN_STORAGE_KEY, AdminAuthProvider, useAdminAuth } from "@/contexts/AdminAuthContext";
import { AdminThemeProvider } from "@/contexts/AdminThemeContext";
import { RouteGuard, type PermRequirement, type PermRequirementMode } from "@/lib/permissions";

import LoginPage from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import Instructors from "@/pages/instructors";
import Classes from "@/pages/classes";
import Schedules from "@/pages/schedules";
import Packages from "@/pages/packages";
import Bookings from "@/pages/bookings";
import Students from "@/pages/students";
import ParentsPage from "@/pages/parents";
import StudentDetailPage from "@/pages/student-detail";
import ChildDetailPage from "@/pages/child-detail";
import Offers from "@/pages/offers";
import Notifications from "@/pages/notifications";
import Marketing from "@/pages/marketing";
import PackageOrders from "@/pages/package-orders";
import AttendancePage from "@/pages/attendance";
import FeedbackPage from "@/pages/feedback";
import FeedbackDetailPage from "@/pages/feedback-detail";
import ReportsPage from "@/pages/reports";
import HeroItems from "@/pages/hero-items";
import SystemUsers from "@/pages/system-users";
import AppContentPage from "@/pages/app-content";
import ApplicationsPage from "@/pages/ballet/ApplicationsPage";
import ApplicationDetailPage from "@/pages/ballet/ApplicationDetailPage";
import AssessmentSlotsPage from "@/pages/ballet/AssessmentSlotsPage";
import BalletSettingsPage from "@/pages/ballet/BalletSettingsPage";
import BalletLevelsPage from "@/pages/ballet/BalletLevelsPage";
import DesignLabPage from "@/pages/DesignLabPage";
import SettingsPage from "@/pages/settings";

// Wire the API client to the backend.
if (import.meta.env.VITE_API_URL) {
  setBaseUrl(import.meta.env.VITE_API_URL as string);
}
// Admin dashboard uses X-Api-Key header via the Bearer token path
const adminApiKey = import.meta.env.VITE_API_KEY as string | undefined;
if (adminApiKey) {
  setAuthTokenGetter(() => adminApiKey);
}
setAdminTokenGetter(() => localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY));

const queryClient = new QueryClient();

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="admin-shell flex h-screen w-full overflow-hidden bg-background text-foreground transition-colors duration-200">
      <Sidebar />
      <main className="relative flex-1 overflow-y-auto bg-[radial-gradient(circle_at_24%_0%,rgba(0,182,215,.08),transparent_44%),radial-gradient(circle_at_82%_10%,rgba(138,92,255,.06),transparent_38%)] bg-no-repeat">
        <div className="relative mx-auto max-w-[1540px] p-5 sm:p-8 lg:p-10">
          {children}
        </div>
      </main>
    </div>
  );
}

/**
 * ProtectedRouter — only rendered when the user is authenticated.
 * The auth check (loading spinner / redirect to login) happens in AppShell.
 */
/** Route → permission requirement (any one of the pairs grants access). */
const ROUTE_PERMS = {
  dashboard: [["dashboard", "view"]],
  instructors: [["instructors", "view"]],
  classes: [["classes", "view"]],
  schedules: [["schedules", "view"]],
  packages: [["packages", "view"]],
  bookings: [["bookings", "view"]],
  students: [["students", "view"]],
  parents: [["parents", "view"]],
  // Shared guard for the 360 profile page — reachable from either the
  // Students or Parents list, so any one of these permissions is enough
  // (the backend overview endpoint enforces the same users/students/parents
  // "any of" check per-record).
  studentDetail: [["students", "view"], ["parents", "view"], ["users", "view"]],
  childDetails: [["children", "view"], ["parents", "view"]],
  offers: [["offers", "view"]],
  notifications: [["notifications", "view"]],
  marketing: [["marketing", "view"]],
  packageOrders: [["packageOrders", "view"]],
  attendance: [["attendance", "view"]],
  feedback: [["feedback", "view"]],
  reports: [["reports", "view"]],
  heroSlides: [["heroSlides", "view"]],
  appContent: [["appContent", "view"]],
  systemUsers: [["adminUsers", "view"], ["roles", "view"]],
  balletApplications: [["ballet.applications", "view"]],
  balletSlots: [["ballet.assessmentDates", "view"]],
  balletSettings: [["ballet.pricing", "view"]],
  balletLevels: [["ballet.levels", "view"]],
  settings: [["settings", "view"]],
} satisfies Record<string, PermRequirement>;

/** Wrap a page element in a permission guard for use as Route children. */
function guarded(req: PermRequirement, element: React.ReactNode, mode: PermRequirementMode = "any") {
  return <RouteGuard req={req} mode={mode}>{element}</RouteGuard>;
}

function ProtectedRouter() {
  return (
    <Layout>
      <Switch>
        {/* Authenticated user landing on /login → redirect to dashboard */}
        <Route path="/login">
          <Redirect to="/" />
        </Route>
        <Route path="/">{guarded(ROUTE_PERMS.dashboard, <Dashboard />)}</Route>
        <Route path="/instructors">{guarded(ROUTE_PERMS.instructors, <Instructors />)}</Route>
        <Route path="/classes">{guarded(ROUTE_PERMS.classes, <Classes />)}</Route>
        <Route path="/schedules">{guarded(ROUTE_PERMS.schedules, <Schedules />)}</Route>
        <Route path="/packages">{guarded(ROUTE_PERMS.packages, <Packages />)}</Route>
        <Route path="/bookings">{guarded(ROUTE_PERMS.bookings, <Bookings />)}</Route>
        <Route path="/students">{guarded(ROUTE_PERMS.students, <Students />)}</Route>
        <Route path="/students/:id">{guarded(ROUTE_PERMS.studentDetail, <StudentDetailPage />)}</Route>
        <Route path="/parents">{guarded(ROUTE_PERMS.parents, <ParentsPage />)}</Route>
        <Route path="/parents/:id">{guarded(ROUTE_PERMS.studentDetail, <StudentDetailPage />)}</Route>
        <Route path="/parents/:parentId/children/:childId">{guarded(ROUTE_PERMS.childDetails, <ChildDetailPage />, "all")}</Route>
        <Route path="/offers">{guarded(ROUTE_PERMS.offers, <Offers />)}</Route>
        <Route path="/notifications">{guarded(ROUTE_PERMS.notifications, <Notifications />)}</Route>
        <Route path="/marketing">{guarded(ROUTE_PERMS.marketing, <Marketing />)}</Route>
        <Route path="/package-orders">{guarded(ROUTE_PERMS.packageOrders, <PackageOrders />)}</Route>
        <Route path="/attendance">{guarded(ROUTE_PERMS.attendance, <AttendancePage />)}</Route>
        <Route path="/feedback/:id">{guarded(ROUTE_PERMS.feedback, <FeedbackDetailPage />)}</Route>
        <Route path="/feedback">{guarded(ROUTE_PERMS.feedback, <FeedbackPage />)}</Route>
        <Route path="/reports">{guarded(ROUTE_PERMS.reports, <ReportsPage />)}</Route>
        <Route path="/hero-items">{guarded(ROUTE_PERMS.heroSlides, <HeroItems />)}</Route>
        <Route path="/app-content">{guarded(ROUTE_PERMS.appContent, <AppContentPage />)}</Route>
        <Route path="/system-users">{guarded(ROUTE_PERMS.systemUsers, <SystemUsers />)}</Route>
        <Route path="/ballet/applications/:id">{guarded(ROUTE_PERMS.balletApplications, <ApplicationDetailPage />)}</Route>
        <Route path="/ballet/applications">{guarded(ROUTE_PERMS.balletApplications, <ApplicationsPage />)}</Route>
        <Route path="/ballet/slots">{guarded(ROUTE_PERMS.balletSlots, <AssessmentSlotsPage />)}</Route>
        <Route path="/ballet/settings">{guarded(ROUTE_PERMS.balletSettings, <BalletSettingsPage />)}</Route>
        <Route path="/ballet/levels">{guarded(ROUTE_PERMS.balletLevels, <BalletLevelsPage />)}</Route>
        <Route path="/settings">{guarded(ROUTE_PERMS.settings, <SettingsPage />)}</Route>
        {/* DEV-ONLY: component preview — not in sidebar */}
        <Route path="/design-lab" component={DesignLabPage} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

/**
 * AppShell — handles the auth gate:
 *  - While checking stored token: show loading spinner
 *  - Not authenticated: show login page
 *  - Authenticated: show the full admin dashboard
 */
function AppShell() {
  const { user, isLoading } = useAdminAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return (
      <Switch>
        <Route path="/login" component={LoginPage} />
        <Route>
          {/* Any other path → redirect to /login */}
          <Redirect to="/login" />
        </Route>
      </Switch>
    );
  }

  return <ProtectedRouter />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AdminThemeProvider>
          <AdminAuthProvider>
            <WouterRouter base={import.meta.env.BASE_URL?.replace(/\/$/, "")}>
              <AppShell />
            </WouterRouter>
          </AdminAuthProvider>
        </AdminThemeProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
