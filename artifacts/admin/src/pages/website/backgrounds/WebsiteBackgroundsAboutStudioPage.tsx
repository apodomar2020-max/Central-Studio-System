/**
 * Website → Backgrounds → About Studio (/website/backgrounds/about-studio)
 *
 * Website CMS Wave 1 — Backgrounds only. See WebsiteBackgroundsHomePage.tsx
 * for the WorkspaceRouteNav rationale.
 */
import { PageHeader } from "@/components/layout/page-header";
import { BackgroundSectionsList } from "./BackgroundSectionsList";
import { WorkspaceRouteNav } from "@/components/admin/workspace-route-nav";
import { useAdminAuth } from "@/contexts/AdminAuthContext";

export default function WebsiteBackgroundsAboutStudioPage() {
  const { can } = useAdminAuth();
  return (
    <div className="space-y-6">
      <PageHeader
        title="About Studio Backgrounds"
        description="Approved background media for the public About Studio page — Section 1 (Hero), Section 4 (Co-Founder), and Section 7 (App Download)."
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
      <BackgroundSectionsList page="about-studio" />
    </div>
  );
}
import "../../admin2-final.css";
import "../../admin2-operations.css";
