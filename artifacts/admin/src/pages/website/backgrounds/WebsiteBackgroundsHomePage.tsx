/**
 * Website → Backgrounds → Home (/website/backgrounds/home)
 *
 * Website CMS Wave 1 — Backgrounds only. The WorkspaceRouteNav row below is
 * an Admin 2.0 navigation-discoverability addition (not part of Wave 1) —
 * see components/admin/workspace-route-nav.tsx's doc comment for why it's
 * needed: Backgrounds is a group nested inside the Website group, and the
 * global contextual TopBar only renders one navigation level, so Home/About
 * Studio/Ballet/Classes aren't otherwise reachable from any visible desktop
 * control once you're on one of these 4 pages.
 */
import { PageHeader } from "@/components/layout/page-header";
import { BackgroundSectionsList } from "./BackgroundSectionsList";
import { WorkspaceRouteNav } from "@/components/admin/workspace-route-nav";
import { useAdminAuth } from "@/contexts/AdminAuthContext";

export default function WebsiteBackgroundsHomePage() {
  const { can } = useAdminAuth();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Home Backgrounds"
        description="Approved background media for the public Home page — Section 1 (Hero) and Section 3 (Academy Feature)."
      />
      <WorkspaceRouteNav
        ariaLabel="Backgrounds workspace"
        items={[
          ...(can("website.backgrounds", "view") ? [{ label: "Home", href: "/website/backgrounds/home" }] : []),
          ...(can("website.backgrounds", "view") ? [{ label: "About Studio", href: "/website/backgrounds/about-studio" }] : []),
          ...(can("website.backgrounds", "view") ? [{ label: "Ballet", href: "/website/backgrounds/ballet" }] : []),
          ...(can("website.backgrounds", "view") ? [{ label: "Classes", href: "/website/backgrounds/classes" }] : []),
        ]}
      />
      <BackgroundSectionsList page="home" />
    </div>
  );
}
import "../../admin2-final.css";
import "../../admin2-operations.css";
