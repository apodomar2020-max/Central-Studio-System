/**
 * Website → Backgrounds → About Studio (/website/backgrounds/about-studio)
 *
 * Website CMS Wave 1 — Backgrounds only.
 */
import { PageHeader } from "@/components/layout/page-header";
import { BackgroundSectionsList } from "./BackgroundSectionsList";

export default function WebsiteBackgroundsAboutStudioPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="About Studio Backgrounds"
        description="Approved background media for the public About Studio page — Section 1 (Hero), Section 4 (Co-Founder), and Section 7 (App Download)."
      />
      <BackgroundSectionsList page="about-studio" />
    </div>
  );
}
import "../../admin2-final.css";
