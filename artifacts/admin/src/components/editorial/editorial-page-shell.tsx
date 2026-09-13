/**
 * EditorialPageShell — shared chrome for every Website → Editorial page
 * (Wave 2.1A foundation).
 *
 * Responsibilities, deliberately minimal and business-logic free:
 *  - the standard Admin 2.0 page wrapper (.admin2-final-page + the shared
 *    .admin2-cms-workspace spacing the existing News/Performance CMS pages
 *    already use), so Editorial pages sit in the same grid as the rest of
 *    the Website CMS;
 *  - the persistent legacy-coexistence banner, dismissible for the current
 *    visit only (component state — deliberately not persisted, so the notice
 *    reappears on the next navigation/reload while Editorial is still
 *    disconnected from the public website);
 *  - an optional heading/description slot. Page identity (title + description
 *    in the TopBar) is still authoritatively owned by nav-config, exactly as
 *    on every other admin page — this slot is for in-page sub-headings only.
 *
 * It performs no data fetching, holds no entity knowledge, and is not used by
 * the Website → Settings pages: Languages and Links are shared configuration
 * surfaces rather than Editorial content, and the approved IA scopes the
 * coexistence banner to the Editorial group only.
 */
import { useState, type ReactNode } from "react";
import { Info, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import "@/pages/admin2-final.css";

/**
 * The exact approved coexistence wording. Exported so tests (and any later
 * sub-wave that needs to echo it) share a single source of truth.
 */
export const EDITORIAL_COEXISTENCE_NOTICE =
  "The public website still reads the existing News and Performance sections. Content published here is not live yet.";

export function EditorialPageShell({
  heading,
  description,
  actions,
  children,
}: {
  /** Optional in-page sub-heading (the TopBar already renders page identity). */
  heading?: string;
  description?: string;
  /** Optional right-aligned action slot rendered beside the heading. */
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const [noticeDismissed, setNoticeDismissed] = useState(false);

  return (
    <div className="admin2-final-page admin2-cms-workspace admin2-editorial space-y-6">
      {!noticeDismissed && (
        <div
          role="status"
          data-testid="editorial-coexistence-banner"
          className="flex items-start gap-3 rounded-md border border-border bg-muted/40 px-4 py-3"
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="flex-1 text-sm text-muted-foreground">{EDITORIAL_COEXISTENCE_NOTICE}</p>
          <Button
            type="button"
            variant="ghost"
            size="iconSm"
            className="shrink-0"
            aria-label="Dismiss the Editorial coexistence notice"
            data-testid="editorial-coexistence-banner-dismiss"
            onClick={() => setNoticeDismissed(true)}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      )}

      {(heading || description || actions) && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            {heading && <h2 className="text-base font-semibold text-foreground">{heading}</h2>}
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}

      {children}
    </div>
  );
}
