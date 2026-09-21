/**
 * route-entrance — the identity the Admin 2.0 page-entrance animation
 * remounts on.
 *
 * ─── WHY THIS EXISTS ─────────────────────────────────────────────────────
 *
 * The Motion System Foundation keys one wrapper inside `Layout` by the
 * wouter location so the `.admin2-route-enter` CSS animation replays on
 * every navigation. Keying by the raw location means React unmounts and
 * remounts the ENTIRE route subtree whenever ANY character of the path
 * changes — including a path PARAMETER that merely selects a sub-view of
 * the page that is already open.
 *
 * That is a real data-loss bug in the Editorial Post editor, whose route is
 * `/editorial/posts/:id/:languageCode`. Switching language changes only the
 * last segment, but the raw-location key remounted
 * `EditorialPostTranslationPage` from scratch — discarding its `shared`
 * (author + feature image) and `topics` form state along with the
 * translation state, even though shared fields and topics are POST-level,
 * are saved through post-level endpoints, and have nothing to do with which
 * language is open. The editor's own language-switch guard only warns about
 * the translation scope, so unsaved shared and topics edits were destroyed
 * with no confirmation at all.
 *
 * ─── THE RULE ────────────────────────────────────────────────────────────
 *
 * The animation key is the PAGE identity, not the URL. For routes that use a
 * trailing path parameter as an in-page selector, that trailing segment is
 * collapsed out, so moving between sub-views of one open page is not a page
 * navigation and does not remount it. Every other route is unaffected: the
 * key is the location verbatim, and any change to it still replays the
 * entrance animation exactly as before.
 *
 * Only genuinely in-page selectors belong in IN_PAGE_SUB_VIEW_ROUTES.
 * Navigating to a different post (`/editorial/posts/7/en` ->
 * `/editorial/posts/8/en`) still changes the key, because the collapsed
 * prefix still contains the post id.
 */

/**
 * Prefixes whose route is `<prefix>/:resourceId/:subView`, where `:subView`
 * selects a sub-view WITHIN the already-mounted page.
 */
export const IN_PAGE_SUB_VIEW_ROUTES: readonly string[] = ["/editorial/posts"];

/**
 * The key for the page-entrance wrapper. Identical to `location` for every
 * route except the in-page-sub-view ones, where the trailing selector
 * segment is dropped.
 */
export function routeEntranceKey(location: string): string {
  for (const prefix of IN_PAGE_SUB_VIEW_ROUTES) {
    if (!location.startsWith(`${prefix}/`)) continue;
    const rest = location.slice(prefix.length + 1).split("/");
    // Exactly `<resourceId>/<subView>` — not the list, not the create screen,
    // not the bare detail route, and not anything deeper.
    if (rest.length !== 2) continue;
    const [resourceId, subView] = rest;
    if (!resourceId || !subView) continue;
    // The resource id is numeric on these routes; "new" and other word
    // segments must never be collapsed.
    if (!/^\d+$/.test(resourceId)) continue;
    return `${prefix}/${resourceId}`;
  }
  return location;
}
