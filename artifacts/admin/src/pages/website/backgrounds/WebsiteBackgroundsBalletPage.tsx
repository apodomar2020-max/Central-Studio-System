/**
 * Website → Backgrounds → Ballet (/website/backgrounds/ballet)
 *
 * Website CMS Wave 1 — Backgrounds only. See WebsiteBackgroundsHomePage.tsx
 * for the WorkspaceRouteNav rationale.
 *
 * Section 2 (ballet.section2) has no existing background media today — see
 * the Wave 1 report for how ScrollMetricsSection.tsx handles an unset value
 * (flat #0E0E0E, pixel-identical to before) vs. a configured one.
 */
import { PageHeader } from "@/components/layout/page-header";
import { BackgroundSectionsList } from "./BackgroundSectionsList";
import { WorkspaceRouteNav } from "@/components/admin/workspace-route-nav";
import { useAdminAuth } from "@/contexts/AdminAuthContext";

export default function WebsiteBackgroundsBalletPage() {
  const { can } = useAdminAuth();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Ballet Backgrounds"
        description="Approved background media for the public Ballet page — Section 1 (Hero) and Section 2 (Metrics). Section 2 has no background today; leave it unset to keep the current flat color."
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
      <BackgroundSectionsList page="ballet" />
    </div>
  );
}
import "../../admin2-final.css";
import "../../admin2-operations.css";
