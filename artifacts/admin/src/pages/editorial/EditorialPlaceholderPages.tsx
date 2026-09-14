/**
 * Editorial placeholder pages — Wave 2.1A foundation.
 *
 * These components exist to prove navigation, routing and RBAC work
 * end-to-end for the unified Editorial CMS before any real screen is built.
 * They render no table, no form and no CRUD logic on purpose: each real
 * screen arrives in its own later Wave 2.1 sub-wave. (Website → Configuration
 * → Languages has since been delivered for real in Wave 2.1B and is no longer
 * in this file.)
 *
 * The Editorial pages render inside <EditorialPageShell> so they carry
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

export function EditorialPostsListPage() {
  return (
    <EditorialPlaceholder
      heading="Posts"
      description="Every unified Editorial post, across channels and languages."
      body="The Posts list — search, channel and status filters, pagination and row actions — is delivered in a later Wave 2.1 sub-wave. This page currently exists only to confirm navigation, routing and permissions."
    />
  );
}

export function EditorialPostCreatePage() {
  return (
    <EditorialPlaceholder
      heading="New post"
      description="Create a unified Editorial post."
      body="The post creation form is delivered in a later Wave 2.1 sub-wave. This page currently exists only to confirm navigation, routing and permissions."
    />
  );
}

export function EditorialPostDetailPage() {
  return (
    <EditorialPlaceholder
      heading="Post"
      description="Shared post fields, translations, topics, recommendations and revisions."
      body="The post detail screen is delivered in a later Wave 2.1 sub-wave. This page currently exists only to confirm navigation, routing and permissions."
    />
  );
}

export function EditorialPostTranslationPage() {
  return (
    <EditorialPlaceholder
      heading="Translation"
      description="One language of a unified Editorial post."
      body="The translation editor — block body, publishing and revisions — is delivered in a later Wave 2.1 sub-wave. This page currently exists only to confirm navigation, routing and permissions."
    />
  );
}

export function EditorialAuthorsPage() {
  return (
    <EditorialPlaceholder
      heading="Authors"
      description="Author profiles credited on unified Editorial posts."
      body="Author management is delivered in a later Wave 2.1 sub-wave. This page currently exists only to confirm navigation, routing and permissions."
    />
  );
}

export function EditorialTopicsPage() {
  return (
    <EditorialPlaceholder
      heading="Topics"
      description="The topic taxonomy used to classify unified Editorial posts."
      body="Topic management is delivered in a later Wave 2.1 sub-wave. This page currently exists only to confirm navigation, routing and permissions."
    />
  );
}

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
