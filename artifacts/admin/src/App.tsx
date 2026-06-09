import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setBaseUrl, setAuthTokenGetter } from "@workspace/api-client-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Sidebar } from "@/components/layout/sidebar";

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

// Wire the API client to the backend.
// In development, Vite proxies /api to the api-server so no base URL is needed.
// In production (or when VITE_API_URL is set), point directly at the server.
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

function Router() {
  return (
    <Switch>
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
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL?.replace(/\/$/, "")}>
          <Layout>
            <Router />
          </Layout>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
