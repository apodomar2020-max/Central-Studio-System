import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setBaseUrl, setAuthTokenGetter } from "@workspace/api-client-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Loader2 } from "lucide-react";
import NotFound from "@/pages/not-found";
import { Sidebar } from "@/components/layout/sidebar";
import { AdminAuthProvider, useAdminAuth } from "@/contexts/AdminAuthContext";

import LoginPage from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import Instructors from "@/pages/instructors";
import Classes from "@/pages/classes";
import Schedules from "@/pages/schedules";
import Packages from "@/pages/packages";
import Bookings from "@/pages/bookings";
import Students from "@/pages/students";
import Offers from "@/pages/offers";
import Notifications from "@/pages/notifications";
import Marketing from "@/pages/marketing";
import PackageOrders from "@/pages/package-orders";
import AttendancePage from "@/pages/attendance";
import HeroItems from "@/pages/hero-items";
import SystemUsers from "@/pages/system-users";

// Wire the API client to the backend.
if (import.meta.env.VITE_API_URL) {
  setBaseUrl(import.meta.env.VITE_API_URL as string);
}
// Admin dashboard uses X-Api-Key header via the Bearer token path
const adminApiKey = import.meta.env.VITE_API_KEY as string | undefined;
if (adminApiKey) {
  setAuthTokenGetter(() => adminApiKey);
}

const queryClient = new QueryClient();

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="p-8 max-w-7xl mx-auto">
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
function ProtectedRouter() {
  return (
    <Layout>
      <Switch>
        {/* Authenticated user landing on /login → redirect to dashboard */}
        <Route path="/login">
          <Redirect to="/" />
        </Route>
        <Route path="/" component={Dashboard} />
        <Route path="/instructors" component={Instructors} />
        <Route path="/classes" component={Classes} />
        <Route path="/schedules" component={Schedules} />
        <Route path="/packages" component={Packages} />
        <Route path="/bookings" component={Bookings} />
        <Route path="/students" component={Students} />
        <Route path="/offers" component={Offers} />
        <Route path="/notifications" component={Notifications} />
        <Route path="/marketing" component={Marketing} />
        <Route path="/package-orders" component={PackageOrders} />
        <Route path="/attendance" component={AttendancePage} />
        <Route path="/hero-items" component={HeroItems} />
        <Route path="/system-users" component={SystemUsers} />
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
        <AdminAuthProvider>
          <WouterRouter base={import.meta.env.BASE_URL?.replace(/\/$/, "")}>
            <AppShell />
          </WouterRouter>
        </AdminAuthProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
