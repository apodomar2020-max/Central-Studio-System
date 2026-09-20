/**
 * Editorial placeholder pages — Wave 2.1A foundation.
 *
 * These components exist to prove navigation, routing and RBAC work
 * end-to-end for the unified Editorial CMS before any real screen is built.
 * They render no table, no form and no CRUD logic on purpose: each real
 * screen arrives in its own later Wave 2.1 sub-wave.
 *
 * TWO PLACEHOLDERS REMAIN: Website → Editorial → Placements (Wave 2.1F) and
 * Website → Settings → Links (Wave 2.1G). Everything else has shipped for
 * real and has left this file — Configuration → Languages in Wave 2.1B,
 * Topics and Authors in Wave 2.1C, and Posts, the post create flow and the
 * post editor in Wave 2.1D.
 *
 * The Editorial placeholder renders inside <EditorialPageShell> so it carries
 * the approved legacy-coexistence banner. The Website → Settings placeholder
 * (Links) uses plain Admin page chrome: the approved IA scopes that
 * banner to the Editorial group, and that screen configures shared
 * website settings rather than publishing Editorial content.
 */
import { EditorialPageShell } from "@/components/editorial/editorial-page-shell";
import "@/pages/admin2-final.css";

function ComingInLaterSubWave({ children }: { children: string }) {
  return (
    <div
      className="rounded-md border border-dashed border-border bg-card px-4 py-6 text-sm text-muted-foreground"
      data-testid="editorial-placeholder-body"
    >
      {children}
    </div>
  );
}

function EditorialPlaceholder({
  heading,
  description,
  body,
}: {
  heading: string;
  description: string;
  body: string;
}) {
  return (
    <EditorialPageShell heading={heading} description={description}>
      <ComingInLaterSubWave>{body}</ComingInLaterSubWave>
    </EditorialPageShell>
  );
}

function SettingsPlaceholder({
  heading,
  description,
  body,
}: {
  heading: string;
  description: string;
  body: string;
}) {
  return (
    <div className="admin2-final-page admin2-cms-workspace space-y-6">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-foreground">{heading}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <ComingInLaterSubWave>{body}</ComingInLaterSubWave>
    </div>
  );
}

// ─── Editorial ───────────────────────────────────────────────────────────────

// Website → Editorial → Posts is no longer a placeholder: the real list,
// create flow and post editor shipped in Wave 2.1D and live in
// pages/editorial/EditorialPostsListPage.tsx,
// pages/editorial/EditorialPostCreatePage.tsx,
// pages/editorial/EditorialPostDetailPage.tsx and
// pages/editorial/EditorialPostTranslationPage.tsx.

// Website → Editorial → Authors and Website → Editorial → Topics are no
// longer placeholders: both real screens shipped in Wave 2.1C and live in
// pages/editorial/EditorialAuthorsPage.tsx and
// pages/editorial/EditorialTopicsPage.tsx.

export function EditorialPlacementsPage() {
  return (
    <EditorialPlaceholder
      heading="Placements"
      description="Curated slots that order featured unified Editorial posts."
      body="The placements editor is delivered in a later Wave 2.1 sub-wave. This page currently exists only to confirm navigation, routing and permissions."
    />
  );
}

// ─── Website → Settings ──────────────────────────────────────────────────────

// Website → Configuration → Languages is no longer a placeholder: the real
// screen shipped in Wave 2.1B and lives in
// pages/website/settings/WebsiteSettingsLanguagesPage.tsx.

export function WebsiteSettingsLinksPage() {
  return (
    <SettingsPlaceholder
      heading="Links"
      description="Global public-website links referenced by Editorial content."
      body="The website links form is delivered in a later Wave 2.1 sub-wave. This page currently exists only to confirm navigation, routing and permissions."
    />
  );
}
