import { lazy, Suspense, useState } from "react";
import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setBaseUrl, setAuthTokenGetter, setAdminTokenGetter } from "@workspace/api-client-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Loader2 } from "lucide-react";
import NotFound from "@/pages/not-found";
import { MobileSidebarDrawer, Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { ADMIN_TOKEN_STORAGE_KEY, AdminAuthProvider, useAdminAuth } from "@/contexts/AdminAuthContext";
import { AdminThemeProvider } from "@/contexts/AdminThemeContext";
import { RouteGuard, type PermRequirement, type PermRequirementMode } from "@/lib/permissions";
import { ErrorBoundary } from "@/components/error-boundary";
import { AdminConfirmProvider } from "@/components/admin/admin-confirm";

import LoginPage from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import CalendarPage from "@/pages/calendar";
import Branches from "@/pages/branches";
import Instructors from "@/pages/instructors";
import Classes from "@/pages/classes";
import Schedules from "@/pages/schedules";
import Packages from "@/pages/packages";
import Bookings from "@/pages/bookings";
import Students from "@/pages/students";
import ParentsPage from "@/pages/parents";
import StudentDetailPage from "@/pages/student-detail";
import ChildDetailPage from "@/pages/child-detail";
import PromotionsPage from "@/pages/promotions";
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
import WebsiteBackgroundsHomePage from "@/pages/website/backgrounds/WebsiteBackgroundsHomePage";
import WebsiteBackgroundsAboutStudioPage from "@/pages/website/backgrounds/WebsiteBackgroundsAboutStudioPage";
import WebsiteBackgroundsBalletPage from "@/pages/website/backgrounds/WebsiteBackgroundsBalletPage";
import WebsiteBackgroundsClassesPage from "@/pages/website/backgrounds/WebsiteBackgroundsClassesPage";
import WebsiteNewsListPage from "@/pages/website/news/WebsiteNewsListPage";
import WebsiteNewsEditorPage from "@/pages/website/news/WebsiteNewsEditorPage";
import WebsitePerformanceListPage from "@/pages/website/performances/WebsitePerformanceListPage";
import WebsitePerformanceEditorPage from "@/pages/website/performances/WebsitePerformanceEditorPage";
import ApplicationsPage from "@/pages/ballet/ApplicationsPage";
import ApplicationDetailPage from "@/pages/ballet/ApplicationDetailPage";
import BalletStudentsPage from "@/pages/ballet/BalletStudentsPage";
import BalletStudentDetailPage from "@/pages/ballet/BalletStudentDetailPage";
import BalletSettingsOverviewPage from "@/pages/ballet/settings/BalletSettingsOverviewPage";
import BalletHomeCardPage from "@/pages/ballet/settings/BalletHomeCardPage";
import BalletContactPage from "@/pages/ballet/settings/BalletContactPage";
import BalletRequirementsPage from "@/pages/ballet/settings/BalletRequirementsPage";
import BalletRequirementsSectionPage from "@/pages/ballet/settings/BalletRequirementsSectionPage";
import BalletFaqSettingsPage from "@/pages/ballet/settings/BalletFaqPage";
import BalletFaqCategoriesPage from "@/pages/ballet/settings/BalletFaqCategoriesPage";
import BalletLevelsPage from "@/pages/ballet/BalletLevelsPage";
import BalletInstructorsPage from "@/pages/ballet/BalletInstructorsPage";
import BalletClassesPage from "@/pages/ballet/BalletClassesPage";
import BalletSchedulesPage from "@/pages/ballet/BalletSchedulesPage";
import BalletGroupsPage from "@/pages/ballet/BalletGroupsPage";
import BalletPackagesPage from "@/pages/ballet/BalletPackagesPage";
import BalletPerformancesPage from "@/pages/ballet/BalletPerformancesPage";
import BalletPaymentsPage from "@/pages/ballet/BalletPaymentsPage";
import BalletCancellationRequestsPage from "@/pages/ballet/BalletCancellationRequestsPage";
import BalletRefundsPage from "@/pages/ballet/BalletRefundsPage";
import SettingsPage from "@/pages/settings";
import LogsPage from "@/pages/logs";
// Finance Department (Phase 1) — read-only visibility layer. Every page here
// reads and deep-links; no financial mutation was moved out of its existing
// operational page.
import FinanceOverviewPage from "@/pages/finance/FinanceOverviewPage";
import FinanceTransactionsPage from "@/pages/finance/FinanceTransactionsPage";
import FinanceExportsPage from "@/pages/finance/FinanceExportsPage";
import {
  FinanceBalletPage,
  FinanceClassPaymentsPage,
  FinanceDiscountsPage,
  FinancePackagesPage,
  FinanceRefundsPage,
} from "@/pages/finance/FinanceSourcePages";
import "@/components/admin/admin2-system.css";

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
  // Phase 5A: mobile nav drawer state. Below lg the desktop sidebar is hidden
  // and the TopBar hamburger opens the same navigation inside a Sheet.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Motion System Foundation (page entrance, §10): the shell — sidebar,
  // top-bar — must stay put across navigation; only the route content
  // re-animates. Keying this inner wrapper by location remounts just the
  // content on every navigation, replaying the .admin2-route-enter CSS
  // animation without ever unmounting Layout/Sidebar/TopBar themselves.
  const [location] = useLocation();

  return (
    <AdminConfirmProvider>
    <div className="admin-shell flex h-screen w-full overflow-hidden bg-background text-foreground transition-colors duration-200">
      {/* Desktop sidebar — unchanged at lg+; hidden on mobile/tablet */}
      <Sidebar className="hidden lg:flex" />
      {/* Mobile drawer — same SidebarNav, closes on navigate */}
      <MobileSidebarDrawer open={mobileNavOpen} onOpenChange={setMobileNavOpen} />
      {/* Right column: shrink-0 TopBar above the scrollable main — the header
          is part of the flex flow (not fixed), so it can never overlap content. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onOpenMobileNav={() => setMobileNavOpen(true)} />
        <main className="admin2-main relative flex-1 overflow-y-auto overflow-x-hidden">
          <div className="admin2-page-content relative max-w-none">
            <div key={location} className="admin2-route-enter">
              {children}
            </div>
          </div>
        </main>
      </div>
    </div>
    </AdminConfirmProvider>
  );
}

/**
 * ProtectedRouter — only rendered when the user is authenticated.
 * The auth check (loading spinner / redirect to login) happens in AppShell.
 */
/** Route → permission requirement (any one of the pairs grants access). */
const ROUTE_PERMS = {
  dashboard: [["dashboard", "view"]],
  calendar: [["schedules", "view"], ["ballet.schedules", "view"]],
  branches: [["branches", "view"]],
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
  // Phase 6C: the admin /offers route was removed (backend Offers API and the
  // offers permission module remain until Phases 6D/6E).
  promotions: [["promotions", "view"]],
  notifications: [["notifications", "view"]],
  marketing: [["marketing", "view"]],
  packageOrders: [["packageOrders", "view"]],
  attendance: [["attendance", "view"]],
  feedback: [["feedback", "view"]],
  reports: [["reports", "view"]],
  heroSlides: [["heroSlides", "view"]],
  appContent: [["appContent", "view"]],
  // Website CMS Wave 1/2/3 — Backgrounds + News + Performance.
  websiteBackgrounds: [["website.backgrounds", "view"]],
  // Route guard is view-only, mirroring balletApplications below — the
  // create/edit pages internally check "website.news":"create"/"edit"
  // (via can()) before allowing a save, the same finer-grained-inside-the-
  // page pattern ApplicationDetailPage uses for review/approve/reject.
  websiteNews: [["website.news", "view"]],
  // Same view-only-route-guard pattern as websiteNews above.
  websitePerformance: [["website.performance", "view"]],
  systemUsers: [["adminUsers", "view"], ["roles", "view"]],
  balletApplications: [["ballet.applications", "view"]],
  balletStudents: [["ballet.applications", "view"]],
  balletSettings: [["ballet.settings", "view"]],
  balletLevels: [["ballet.levels", "view"]],
  balletInstructors: [["ballet.instructors", "view"]],
  balletClasses: [["ballet.classes", "view"]],
  balletSchedules: [["ballet.schedules", "view"]],
  balletGroups: [["ballet.groups", "view"]],
  balletPackages: [["ballet.packages", "view"]],
  balletPerformances: [["ballet.performances", "view"]],
  balletPayments: [["finance", "view"]],
  balletCancellationRequests: [["ballet.applications", "view"]],
  balletRefunds: [["finance", "view"]],
  settings: [["settings", "view"]],
  logs: [["auditLogs", "view"]],
  // Finance reuses the read permissions that already gate each underlying
  // Finance Roles & Permissions integration: every Finance page is gated on
  // the single finance.view permission. The backend enforces the identical
  // permission independently on every read endpoint (routes/finance.ts),
  // so this guard is defense-in-depth for the UI only, not the real
  // authorization boundary.
  financeOverview: [["finance", "view"]],
  financeTransactions: [["finance", "view"]],
  financePackages: [["finance", "view"]],
  financeClassPayments: [["finance", "view"]],
  financeBallet: [["finance", "view"]],
  financeRefunds: [["finance", "view"]],
  financeDiscounts: [["finance", "view"]],
  financeExports: [["finance", "view"]],
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
        <Route path="/calendar">{guarded(ROUTE_PERMS.calendar, <CalendarPage />)}</Route>
        <Route path="/branches">{guarded(ROUTE_PERMS.branches, <Branches />)}</Route>
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
        <Route path="/promotions">{guarded(ROUTE_PERMS.promotions, <PromotionsPage />)}</Route>
        <Route path="/notifications">{guarded(ROUTE_PERMS.notifications, <Notifications />)}</Route>
        <Route path="/marketing">{guarded(ROUTE_PERMS.marketing, <Marketing />)}</Route>
        <Route path="/package-orders">{guarded(ROUTE_PERMS.packageOrders, <PackageOrders />)}</Route>
        <Route path="/attendance">{guarded(ROUTE_PERMS.attendance, <AttendancePage />)}</Route>
        <Route path="/feedback/:id">{guarded(ROUTE_PERMS.feedback, <FeedbackDetailPage />)}</Route>
        <Route path="/feedback">{guarded(ROUTE_PERMS.feedback, <FeedbackPage />)}</Route>
        <Route path="/reports">{guarded(ROUTE_PERMS.reports, <ReportsPage />)}</Route>
        <Route path="/hero-items">{guarded(ROUTE_PERMS.heroSlides, <HeroItems />)}</Route>
        <Route path="/app-content">{guarded(ROUTE_PERMS.appContent, <AppContentPage />)}</Route>
        <Route path="/website/backgrounds/home">{guarded(ROUTE_PERMS.websiteBackgrounds, <WebsiteBackgroundsHomePage />)}</Route>
        <Route path="/website/backgrounds/about-studio">{guarded(ROUTE_PERMS.websiteBackgrounds, <WebsiteBackgroundsAboutStudioPage />)}</Route>
        <Route path="/website/backgrounds/ballet">{guarded(ROUTE_PERMS.websiteBackgrounds, <WebsiteBackgroundsBalletPage />)}</Route>
        <Route path="/website/backgrounds/classes">{guarded(ROUTE_PERMS.websiteBackgrounds, <WebsiteBackgroundsClassesPage />)}</Route>
        <Route path="/website/news/new">{guarded(ROUTE_PERMS.websiteNews, <WebsiteNewsEditorPage />)}</Route>
        <Route path="/website/news/:slug/edit">{guarded(ROUTE_PERMS.websiteNews, <WebsiteNewsEditorPage />)}</Route>
        <Route path="/website/news">{guarded(ROUTE_PERMS.websiteNews, <WebsiteNewsListPage />)}</Route>
        <Route path="/website/performances/new">{guarded(ROUTE_PERMS.websitePerformance, <WebsitePerformanceEditorPage />)}</Route>
        <Route path="/website/performances/:slug/edit">{guarded(ROUTE_PERMS.websitePerformance, <WebsitePerformanceEditorPage />)}</Route>
        <Route path="/website/performances">{guarded(ROUTE_PERMS.websitePerformance, <WebsitePerformanceListPage />)}</Route>
        <Route path="/system-users">{guarded(ROUTE_PERMS.systemUsers, <SystemUsers />)}</Route>
        <Route path="/ballet/applications/:id">{guarded(ROUTE_PERMS.balletApplications, <ApplicationDetailPage />)}</Route>
        <Route path="/ballet/applications">{guarded(ROUTE_PERMS.balletApplications, <ApplicationsPage />)}</Route>
        <Route path="/ballet/students/:assignmentId">{guarded(ROUTE_PERMS.balletStudents, <BalletStudentDetailPage />)}</Route>
        <Route path="/ballet/students">{guarded(ROUTE_PERMS.balletStudents, <BalletStudentsPage />)}</Route>
        <Route path="/ballet/settings/requirements/:sectionId">{guarded(ROUTE_PERMS.balletSettings, <BalletRequirementsSectionPage />)}</Route>
        <Route path="/ballet/settings/requirements">{guarded(ROUTE_PERMS.balletSettings, <BalletRequirementsPage />)}</Route>
        <Route path="/ballet/settings/home-card">{guarded(ROUTE_PERMS.balletSettings, <BalletHomeCardPage />)}</Route>
        <Route path="/ballet/settings/contact">{guarded(ROUTE_PERMS.balletSettings, <BalletContactPage />)}</Route>
        <Route path="/ballet/settings/faq/categories">{guarded(ROUTE_PERMS.balletSettings, <BalletFaqCategoriesPage />)}</Route>
        <Route path="/ballet/settings/faq">{guarded(ROUTE_PERMS.balletSettings, <BalletFaqSettingsPage />)}</Route>
        <Route path="/ballet/settings">{guarded(ROUTE_PERMS.balletSettings, <BalletSettingsOverviewPage />)}</Route>
        <Route path="/ballet/levels">{guarded(ROUTE_PERMS.balletLevels, <BalletLevelsPage />)}</Route>
        <Route path="/ballet/instructors">{guarded(ROUTE_PERMS.balletInstructors, <BalletInstructorsPage />)}</Route>
        <Route path="/ballet/classes">{guarded(ROUTE_PERMS.balletClasses, <BalletClassesPage />)}</Route>
        <Route path="/ballet/schedules">{guarded(ROUTE_PERMS.balletSchedules, <BalletSchedulesPage />)}</Route>
        <Route path="/ballet/groups">{guarded(ROUTE_PERMS.balletGroups, <BalletGroupsPage />)}</Route>
        <Route path="/ballet/packages">{guarded(ROUTE_PERMS.balletPackages, <BalletPackagesPage />)}</Route>
        <Route path="/ballet/performances">{guarded(ROUTE_PERMS.balletPerformances, <BalletPerformancesPage />)}</Route>
        <Route path="/ballet/payments">{guarded(ROUTE_PERMS.balletPayments, <BalletPaymentsPage />)}</Route>
        <Route path="/ballet/cancellation-requests">{guarded(ROUTE_PERMS.balletCancellationRequests, <BalletCancellationRequestsPage />)}</Route>
        <Route path="/ballet/refunds">{guarded(ROUTE_PERMS.balletRefunds, <BalletRefundsPage />)}</Route>
        <Route path="/settings">{guarded(ROUTE_PERMS.settings, <SettingsPage />)}</Route>
        <Route path="/logs">{guarded(ROUTE_PERMS.logs, <LogsPage />)}</Route>
        <Route path="/finance/transactions">{guarded(ROUTE_PERMS.financeTransactions, <FinanceTransactionsPage />)}</Route>
        <Route path="/finance/packages">{guarded(ROUTE_PERMS.financePackages, <FinancePackagesPage />)}</Route>
        <Route path="/finance/class-payments">{guarded(ROUTE_PERMS.financeClassPayments, <FinanceClassPaymentsPage />)}</Route>
        <Route path="/finance/ballet">{guarded(ROUTE_PERMS.financeBallet, <FinanceBalletPage />)}</Route>
        <Route path="/finance/refunds">{guarded(ROUTE_PERMS.financeRefunds, <FinanceRefundsPage />)}</Route>
        <Route path="/finance/discounts">{guarded(ROUTE_PERMS.financeDiscounts, <FinanceDiscountsPage />)}</Route>
        <Route path="/finance/exports">{guarded(ROUTE_PERMS.financeExports, <FinanceExportsPage />)}</Route>
        <Route path="/finance">{guarded(ROUTE_PERMS.financeOverview, <FinanceOverviewPage />)}</Route>
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

const DesignLabPage = import.meta.env.DEV
  ? lazy(() => import("@/pages/DesignLabPage"))
  : null;

const ReferencePrototypePage = import.meta.env.DEV
  ? lazy(() => import("@/pages/ReferencePrototypePage"))
  : null;

const SystemPrototypePage = import.meta.env.DEV
  ? lazy(() => import("@/pages/SystemPrototypePage"))
  : null;

function ProductionApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AdminThemeProvider>
          <AdminAuthProvider>
            <AppShell />
          </AdminAuthProvider>
        </AdminThemeProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <WouterRouter base={import.meta.env.BASE_URL?.replace(/\/$/, "")}>
        {import.meta.env.DEV && DesignLabPage && ReferencePrototypePage && SystemPrototypePage ? (
          <Switch>
            <Route path="/design-lab/system-hybrid">
              <TooltipProvider>
                <Suspense
                  fallback={
                    <div className="flex h-screen w-full items-center justify-center bg-[#05090c] text-white">
                      <Loader2 className="h-7 w-7 animate-spin text-[#00B6D7]" aria-label="Loading hybrid system prototype" />
                    </div>
                  }
                >
                  <SystemPrototypePage navigationMode="hybrid" />
                </Suspense>
              </TooltipProvider>
            </Route>
            <Route path="/design-lab/system">
              <TooltipProvider>
                <Suspense
                  fallback={
                    <div className="flex h-screen w-full items-center justify-center bg-[#05090c] text-white">
                      <Loader2 className="h-7 w-7 animate-spin text-[#00B6D7]" aria-label="Loading system prototype" />
                    </div>
                  }
                >
                  <SystemPrototypePage />
                </Suspense>
              </TooltipProvider>
            </Route>
            <Route path="/design-lab/reference">
              <TooltipProvider>
                <Suspense
                  fallback={
                    <div className="flex h-screen w-full items-center justify-center bg-[#05090c] text-white">
                      <Loader2 className="h-7 w-7 animate-spin text-[#00B6D7]" aria-label="Loading reference prototype" />
                    </div>
                  }
                >
                  <ReferencePrototypePage />
                </Suspense>
              </TooltipProvider>
            </Route>
            <Route path="/design-lab">
              <TooltipProvider>
                <Suspense
                  fallback={
                    <div className="flex h-screen w-full items-center justify-center bg-[#05090c] text-white">
                      <Loader2 className="h-7 w-7 animate-spin text-[#00B6D7]" aria-label="Loading Design Lab" />
                    </div>
                  }
                >
                  <DesignLabPage />
                </Suspense>
              </TooltipProvider>
            </Route>
            <Route>
              <ProductionApp />
            </Route>
          </Switch>
        ) : (
          <ProductionApp />
        )}
      </WouterRouter>
    </ErrorBoundary>
  );
}

export default App;
