/**
 * EditorialPageShell — shared chrome for every Website → Editorial page
 * (Website CMS workspace foundation).
 *
 * Responsibilities, deliberately minimal and business-logic free:
 *  - the standard Admin 2.0 page wrapper (.admin2-final-page + the shared
 *    .admin2-cms-workspace spacing the existing News/Performance CMS pages
 *    already use), so Editorial pages sit in the same grid as the rest of
 *    the Website CMS;
 *  - an optional heading/description slot. Page identity (title + description
 *    in the TopBar) is still authoritatively owned by nav-config, exactly as
 *    on every other admin page — this slot is for in-page sub-headings only.
 *
 * It performs no data fetching, holds no entity knowledge, and is not used by
 * the Website → Settings pages: Languages and Links are shared configuration
 * surfaces rather than Editorial content.
 */
import { type ReactNode } from "react";
import "@/pages/admin2-final.css";

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
  return (
    <div className="admin2-final-page admin2-cms-workspace admin2-editorial space-y-6">
      {(heading || description || actions) && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          {(heading || description) && <div className="space-y-1">
            {heading && <h2 className="text-base font-semibold text-foreground">{heading}</h2>}
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>}
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}

      {children}
    </div>
  );
}
