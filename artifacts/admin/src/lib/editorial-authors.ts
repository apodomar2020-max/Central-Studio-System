/**
 * editorial-authors — presentation logic for Website → Editorial → Authors
 * (Wave 2.1C).
 *
 * Everything in this module is pure: no React, no imports, no
 * `import.meta.env`, mirroring `lib/editorial-topics.ts` and Wave 2.1B's
 * `lib/editorial-languages.ts`. The Admin test convention runs `node --test`
 * against real modules where it can and falls back to source inspection only
 * for `.tsx` screens, so validation, payload mapping, the byline-readiness
 * derivation and every piece of operator-facing copy live here where they can
 * be exercised for real.
 *
 * The backend remains authoritative. In particular the avatar URL is validated
 * SERVER-side (HTTPS only, a host allowlist, redirect following, DNS
 * private-range rejection and an image/* content-type check). The shape check
 * here is a cheap courtesy that catches an obvious typo before a ~4s round
 * trip; it never blocks on the host list, and the server's 400 is rendered
 * verbatim beside the field.
 */

export type EditorialChannelValue = "news" | "experience";
export type EditorialAuthorStatusValue = "active" | "archived";

export const AUTHOR_PUBLIC_NAME_MAX = 200;
export const AUTHOR_ROLE_MAX = 200;

export const CHANNEL_OPTIONS: ReadonlyArray<{ value: EditorialChannelValue; label: string }> = [
  { value: "news", label: "News" },
  { value: "experience", label: "Experience" },
];

export function channelLabel(channel: EditorialChannelValue): string {
  return channel === "news" ? "News" : "Experience";
}

/**
 * Shown beside the disabled channel field on the edit form. `channel` is
 * absent from `UpdateEditorialAuthorBody`, AND the database refuses the change
 * through `guard_editorial_author_channel_immutable` whenever any post already
 * carries the byline. Two real layers, unlike topics.
 */
export const AUTHOR_CHANNEL_IMMUTABLE_EXPLANATION =
  "An author's channel cannot be changed — every post carrying this byline depends on it. Create a separate author profile for the other channel.";

/**
 * Persistent notice inside the EDIT dialog only. Real behaviour: publishing a
 * translation freezes `{name, role, avatarUrl, biography}` into that
 * translation's `author_snapshot`, and the author PATCH route never rewrites
 * it — its own activity-log summary says "frozen bylines on published
 * translations are unchanged".
 */
export const AUTHOR_FROZEN_BYLINE_NOTICE =
  "Changes here update this profile and every draft that uses it. Posts already published keep the byline they were published with — to change those, reassign the author on the post itself.";

/**
 * Helper under the biography field. Biography is OPTIONAL to save (the API
 * types it `nullish` with no max) but is required by the publish gate, which
 * raises: Author "X" has no biography — add one before publishing a post under
 * this byline.
 */
export const AUTHOR_BIOGRAPHY_HELP =
  "Required before posts using this byline can be published.";

/**
 * Display-only restatement of `EDITORIAL_ALLOWED_MEDIA_HOSTS` in
 * artifacts/api-server/src/lib/editorialMediaUrl.ts, which carries its own
 * "Keep in sync BY HAND" warning. KEEP IN SYNC BY HAND. This list is shown as
 * guidance so an operator is not guessing; it is never used to block a save —
 * the server is the trust boundary.
 */
export const AUTHOR_AVATAR_ALLOWED_HOSTS_HINT =
  "Must be an https link on an approved image host: picsum.photos, images.unsplash.com, res.cloudinary.com, static.wixstatic.com, lh3.googleusercontent.com. The link is checked when you save.";

// ─── Byline readiness (D3) ───────────────────────────────────────────────────

export interface AuthorBylineInputs {
  status: EditorialAuthorStatusValue;
  biography: string | null;
}

/**
 * The two author-side inputs to the publish gate, both present on every list
 * row, so this is computable with zero extra requests:
 *
 *   author.status !== "active"                      → blocked
 *   !author.biography || biography.trim() === ""    → blocked
 *
 * This describes the BYLINE only. A post has several further rules of its own
 * (feature image, alt text, title, body blocks, an active language) that this
 * screen cannot see — so nothing here may be labelled "publish-ready".
 */
export function isBylineReady(author: AuthorBylineInputs): boolean {
  return author.status === "active" && (author.biography ?? "").trim().length > 0;
}

export type BylineState = "ready" | "needs-biography" | "archived";

/** Archived takes precedence: an archived author blocks publishing regardless of bio. */
export function bylineState(author: AuthorBylineInputs): BylineState {
  if (author.status !== "active") return "archived";
  return (author.biography ?? "").trim().length > 0 ? "ready" : "needs-biography";
}

export function bylineStatusLabel(author: AuthorBylineInputs): string {
  switch (bylineState(author)) {
    case "archived": return "Archived";
    case "ready": return "Ready";
    case "needs-biography": return "Needs biography";
  }
}

export const BYLINE_COLUMN_EXPLANATION =
  "A post cannot be published under a byline that is archived or has no biography.";

// ─── Form ────────────────────────────────────────────────────────────────────

export interface AuthorFormValues {
  channel: EditorialChannelValue;
  publicName: string;
  role: string;
  biography: string;
  avatarUrl: string;
}

export type AuthorFormField = "channel" | "publicName" | "role" | "biography" | "avatarUrl";
export type AuthorFormErrors = Partial<Record<AuthorFormField, string>>;

export const EMPTY_AUTHOR_FORM: AuthorFormValues = {
  channel: "news",
  publicName: "",
  role: "",
  biography: "",
  avatarUrl: "",
};

/**
 * Cheap static shape check only. It rejects a non-https scheme and an
 * unparseable URL — nothing else. The host allowlist is deliberately NOT
 * replicated as a hard client-side rejection: the server owns that list and
 * changing it must not require an Admin deploy.
 */
export function avatarUrlShapeError(raw: string): string | undefined {
  const value = raw.trim();
  if (value.length === 0) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "Enter a full link, starting with https://";
  }
  if (parsed.protocol !== "https:") return "The link must start with https://";
  return undefined;
}

/**
 * Is a 400 error message actually about the submitted avatar URL, rather
 * than some other field on the same request?
 *
 * The backend's media validator (`validateEditorialMediaUrls`, called with
 * `[body.avatarUrl]` and nothing else on both the author create and update
 * routes) has one stable, source-verified contract: on failure it always
 * returns `{ error: "<the offending url>: <reason>" }` — the exact URL is
 * the message's own prefix. That is the only thing on this page's 400 path
 * that reliably identifies "this failure is about the avatar", so this
 * checks the real submitted value against that exact prefix rather than
 * assuming any 400 must be about avatarUrl merely because the field is
 * non-empty (a publicName/role validation 400, or any other future 400,
 * would otherwise be misattributed here too).
 */
export function isAvatarMediaError(message: string, submittedAvatarUrl: string): boolean {
  const url = submittedAvatarUrl.trim();
  if (url.length === 0) return false;
  return message.startsWith(`${url}: `);
}

/**
 * Client-side validation limited to what the generated schema actually states:
 * publicName 1–200, role 1–200, biography optional with NO maximum, avatarUrl
 * optional. Channel is required on create and structurally absent from the
 * update body, so it is not validated on edit.
 */
export function validateAuthorForm(
  values: AuthorFormValues,
  options: { requireChannel: boolean },
): AuthorFormErrors {
  const errors: AuthorFormErrors = {};

  if (options.requireChannel && values.channel !== "news" && values.channel !== "experience") {
    errors.channel = "A channel is required.";
  }

  const publicName = values.publicName.trim();
  if (publicName.length === 0) errors.publicName = "A public name is required.";
  else if (publicName.length > AUTHOR_PUBLIC_NAME_MAX) {
    errors.publicName = `A public name can be at most ${AUTHOR_PUBLIC_NAME_MAX} characters.`;
  }

  const role = values.role.trim();
  if (role.length === 0) errors.role = "A role is required.";
  else if (role.length > AUTHOR_ROLE_MAX) {
    errors.role = `A role can be at most ${AUTHOR_ROLE_MAX} characters.`;
  }

  // Biography is intentionally unvalidated: optional to save (D3), no max.

  const avatarError = avatarUrlShapeError(values.avatarUrl);
  if (avatarError) errors.avatarUrl = avatarError;

  return errors;
}

export function hasAuthorFormErrors(errors: AuthorFormErrors): boolean {
  return Object.keys(errors).length > 0;
}

// ─── Payload mapping ─────────────────────────────────────────────────────────

/**
 * The API's `nullish` semantics are load-bearing: the route copies a key only
 * when `body[key] !== undefined`, so `undefined` means "leave alone" and
 * `null` means "clear it". An empty textarea must therefore send `null`, never
 * `""` — an empty string would store junk that still fails the publish gate
 * but with a misleading data state.
 *
 * `systemUserId` is deliberately never sent: nothing in the Admin reads it, no
 * investigated publish rule consumes it, and exposing it would require the
 * admin-user directory and a second permission family (D1).
 */
export interface AuthorCreatePayload {
  channel: EditorialChannelValue;
  publicName: string;
  role: string;
  biography: string | null;
  avatarUrl: string | null;
}

export function toAuthorCreatePayload(values: AuthorFormValues): AuthorCreatePayload {
  return {
    channel: values.channel,
    publicName: values.publicName.trim(),
    role: values.role.trim(),
    biography: values.biography.trim().length > 0 ? values.biography.trim() : null,
    avatarUrl: values.avatarUrl.trim().length > 0 ? values.avatarUrl.trim() : null,
  };
}

export interface AuthorUpdatePayload {
  publicName?: string;
  role?: string;
  biography?: string | null;
  avatarUrl?: string | null;
}

/**
 * Only fields the operator actually changed are sent. An untouched optional
 * field is omitted (`undefined`), NOT cleared (`null`) — and `channel` and
 * `status` are never present at all.
 */
export function toAuthorUpdatePayload(
  values: AuthorFormValues,
  original: { publicName: string; role: string; biography: string | null; avatarUrl: string | null },
): AuthorUpdatePayload {
  const payload: AuthorUpdatePayload = {};

  const publicName = values.publicName.trim();
  if (publicName !== original.publicName) payload.publicName = publicName;

  const role = values.role.trim();
  if (role !== original.role) payload.role = role;

  const biography = values.biography.trim().length > 0 ? values.biography.trim() : null;
  if (biography !== (original.biography ?? null)) payload.biography = biography;

  const avatarUrl = values.avatarUrl.trim().length > 0 ? values.avatarUrl.trim() : null;
  if (avatarUrl !== (original.avatarUrl ?? null)) payload.avatarUrl = avatarUrl;

  return payload;
}

// ─── Filtering (client-side, over the complete unpaginated array) ────────────

export type ChannelFilter = "all" | EditorialChannelValue;
export type StatusFilter = "all" | EditorialAuthorStatusValue;

export interface AuthorFilters {
  search: string;
  channel: ChannelFilter;
  /** Defaults to "all": archived authors are retained content-bearing rows. */
  status: StatusFilter;
}

export const DEFAULT_AUTHOR_FILTERS: AuthorFilters = {
  search: "",
  channel: "all",
  status: "all",
};

export interface AuthorRowLike {
  publicName: string;
  role: string;
  channel: EditorialChannelValue;
  status: EditorialAuthorStatusValue;
}

export function filterAuthors<T extends AuthorRowLike>(
  rows: readonly T[],
  filters: AuthorFilters,
): T[] {
  const needle = filters.search.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.channel !== "all" && row.channel !== filters.channel) return false;
    if (filters.status !== "all" && row.status !== filters.status) return false;
    if (needle.length === 0) return true;
    return (
      row.publicName.toLowerCase().includes(needle) || row.role.toLowerCase().includes(needle)
    );
  });
}

export function activeAuthorFilterCount(filters: AuthorFilters): number {
  return (filters.channel !== "all" ? 1 : 0) + (filters.status !== "all" ? 1 : 0);
}

// ─── Lifecycle copy ──────────────────────────────────────────────────────────

export interface AuthorConfirmation {
  title: string;
  description: string;
  confirmLabel: string;
  destructive: boolean;
}

/**
 * Archiving is retention, not deletion: one UPDATE on `editorial_authors`.
 * What actually changes, from the real service rules:
 *  · loadAssignableAuthorOrThrow refuses a new assignment;
 *  · assertTranslationPublishReady refuses to publish a post whose author is
 *    archived;
 *  · already-published translations keep their frozen snapshot untouched.
 * The shared confirm defaults to destructive/red styling, so it is explicitly
 * opted out here — the same audited decision Wave 2.1B made for deactivation.
 */
export function archiveAuthorConfirmation(author: { publicName: string }): AuthorConfirmation {
  return {
    title: `Archive ${author.publicName}?`,
    description: `Nothing is deleted. ${author.publicName} can no longer be assigned to new posts, and any post still carrying this byline cannot be published until an active author is chosen. Posts already published are unaffected. You can reactivate them at any time.`,
    confirmLabel: "Archive author",
    destructive: false,
  };
}

export function reactivateAuthorMessage(author: { publicName: string }): string {
  return `${author.publicName} can be assigned to posts again. No post's byline is changed.`;
}
