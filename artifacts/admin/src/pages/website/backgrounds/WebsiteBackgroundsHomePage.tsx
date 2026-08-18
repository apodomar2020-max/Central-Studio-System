/**
 * Website → Backgrounds → Home (/website/backgrounds/home)
 *
 * Website CMS Wave 1 — Backgrounds only.
 */
import { PageHeader } from "@/components/layout/page-header";
import { BackgroundSectionsList } from "./BackgroundSectionsList";

export default function WebsiteBackgroundsHomePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Home Backgrounds"
        description="Approved background media for the public Home page — Section 1 (Hero) and Section 3 (Academy Feature)."
      />
      <BackgroundSectionsList page="home" />
    </div>
  );
}
import "../../admin2-final.css";
