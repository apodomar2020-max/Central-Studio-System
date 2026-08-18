/**
 * Website → Backgrounds → Classes (/website/backgrounds/classes)
 *
 * Website CMS Wave 1 — Backgrounds only.
 */
import { PageHeader } from "@/components/layout/page-header";
import { BackgroundSectionsList } from "./BackgroundSectionsList";

export default function WebsiteBackgroundsClassesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Classes Backgrounds"
        description="Approved background media for the public Classes page — Section 1 (Hero)."
      />
      <BackgroundSectionsList page="classes" />
    </div>
  );
}
import "../../admin2-final.css";
