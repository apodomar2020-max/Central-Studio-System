import { type ReactNode } from "react";

/**
 * CmsEditorLayout — the Website CMS editor frame: a writing canvas plus a
 * sticky settings sidebar (Unified Website CMS, slice 3).
 *
 * The same structure the News Edit page already uses, lifted out so the Add
 * News page and (later) the Performance editor share one frame:
 *  - lg and up: two columns, canvas left, a fixed 20rem sticky sidebar right;
 *  - below lg: one column, sidebar FIRST (it is first in DOM order) so the
 *    Save/Publish actions lead on a phone.
 *
 * Layout only — no data, no entity knowledge, design tokens only.
 */
export function CmsEditorLayout({
  sidebar,
  sidebarLabel,
  children,
}: {
  sidebar: ReactNode;
  /** Accessible name for the sidebar landmark, e.g. "Article settings". */
  sidebarLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
      <aside className="space-y-4 min-w-0 lg:order-2 lg:sticky lg:top-4" aria-label={sidebarLabel}>
        {sidebar}
      </aside>
      <div className="space-y-4 min-w-0 lg:order-1">{children}</div>
    </div>
  );
}
