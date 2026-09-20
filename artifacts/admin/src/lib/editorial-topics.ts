/**
 * editorial-topics — presentation logic for Website → Editorial → Topics
 * (Wave 2.1C).
 *
 * Everything in this module is pure: no React, no imports, no
 * `import.meta.env`. That is deliberate and mirrors `lib/editorial-languages.ts`
 * (Wave 2.1B): the Admin test convention runs `node --test` against real
 * modules where it can, and falls back to source inspection only for `.tsx`
 * screens. Keeping validation, the slug suggestion and every piece of
 * operator-facing copy here means the parts a reviewer most needs pinned are
 * covered by real behaviour tests rather than regexes.
 *
 * The backend remains authoritative for every rule. Nothing here predicts a
 * 409: slug uniqueness is per-channel and decided server-side, and its message
 * is rendered verbatim through `lib/editorial-errors.ts`.
 *
 * NOTE for future waves: unlike `editorial_authors`, there is NO database
 * trigger guarding topic channel immutability. Migration 0126 defines only
 * `guard_editorial_post_integrity`, `sync_editorial_translation_channel` and
 * `guard_editorial_author_channel_immutable`. A topic's channel is immutable
 * purely because `UpdateEditorialTopicBody` omits the field and the route's
 * update loop only copies ["name", "slug", "status"]. Do not assume a DB
 * backstop exists.
 */

export type EditorialChannelValue = "news" | "experience";
export type EditorialTopicStatusValue = "active" | "archived";

/**
 * Mirror of `TOPIC_SLUG_RE` in
 * `artifacts/api-server/src/routes/adminEditorial.ts`. The rule lives in the
 * route, NOT in the generated zod schema (which only carries min/max length),
 * so the Admin cannot derive it from the generated client and must restate it.
 * `lib/editorialTopics.test.ts` pins this copy against the real route source
 * so the two cannot drift.
 */
export const TOPIC_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The backend's own wording for a slug that fails the regex, restated verbatim. */
export const TOPIC_SLUG_FORMAT_MESSAGE =
  "Slug must be lowercase letters, numbers, and hyphens only.";

export const TOPIC_NAME_MAX = 120;
export const TOPIC_SLUG_MAX = 120;

export const CHANNEL_OPTIONS: ReadonlyArray<{ value: EditorialChannelValue; label: string }> = [
  { value: "news", label: "News" },
  { value: "experience", label: "Experience" },
];

export function channelLabel(channel: EditorialChannelValue): string {
  return channel === "news" ? "News" : "Experience";
}

/** Shown beside the disabled channel field on the edit form. */
export const TOPIC_CHANNEL_IMMUTABLE_EXPLANATION =
  "A topic's channel cannot be changed — it decides which posts may be tagged with it. Create a separate topic for the other channel.";

/** Shown beside the slug field on the edit form. */
export const TOPIC_SLUG_EDIT_EXPLANATION =
  "Changing a slug does not affect posts already tagged with this topic.";

export function isValidTopicSlug(slug: string): boolean {
  return TOPIC_SLUG_RE.test(slug);
}

// ─── Slug suggestion (D5) ────────────────────────────────────────────────────

/**
 * Derive a slug candidate from a topic name: lowercase, hyphen-separated,
 * unsupported punctuation stripped, repeated hyphens collapsed, leading and
 * trailing hyphens trimmed.
 *
 * Convenience only. The result either passes `isValidTopicSlug` or is the
 * empty string — it can never produce a value the backend would reject with
 * `TOPIC_SLUG_FORMAT_MESSAGE`, because the same regex governs both.
 */
export function suggestSlugFromName(name: string): string {
  const candidate = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return isValidTopicSlug(candidate) ? candidate : "";
}

/**
 * The create-dialog slug state machine (D5).
 *
 * `slugTouched` records that the operator has typed into the slug field
 * themselves. Once true, a Name change must never overwrite the slug again.
 * On edit the caller passes `mode: "edit"`, which disables suggestion
 * entirely — an existing slug is never auto-rewritten from the name.
 */
export function nextSlugForNameChange(
  current: { name: string; slug: string; slugTouched: boolean },
  nextName: string,
  mode: "create" | "edit",
): string {
  if (mode === "edit") return current.slug;
  if (current.slugTouched) return current.slug;
  return suggestSlugFromName(nextName);
}

// ─── Form ────────────────────────────────────────────────────────────────────

export interface TopicFormValues {
  channel: EditorialChannelValue;
  name: string;
  slug: string;
}

export type TopicFormField = "channel" | "name" | "slug";
export type TopicFormErrors = Partial<Record<TopicFormField, string>>;

export const EMPTY_TOPIC_FORM: TopicFormValues = {
  channel: "news",
  name: "",
  slug: "",
};

/**
 * Client-side validation limited to what the backend actually enforces:
 * name 1–120, slug 1–120 plus the route's regex, channel required on create
 * (it is structurally absent from the update body, so it is not validated on
 * edit). Uniqueness is NOT checked here — only the database knows it, and its
 * 409 is rendered verbatim beside the slug field.
 */
export function validateTopicForm(
  values: TopicFormValues,
  options: { requireChannel: boolean },
): TopicFormErrors {
  const errors: TopicFormErrors = {};

  if (options.requireChannel && values.channel !== "news" && values.channel !== "experience") {
    errors.channel = "A channel is required.";
  }

  const name = values.name.trim();
  if (name.length === 0) errors.name = "A name is required.";
  else if (name.length > TOPIC_NAME_MAX) {
    errors.name = `A name can be at most ${TOPIC_NAME_MAX} characters.`;
  }

  const slug = values.slug.trim();
  if (slug.length === 0) errors.slug = "A slug is required.";
  else if (slug.length > TOPIC_SLUG_MAX) {
    errors.slug = `A slug can be at most ${TOPIC_SLUG_MAX} characters.`;
  } else if (!isValidTopicSlug(slug)) {
    errors.slug = TOPIC_SLUG_FORMAT_MESSAGE;
  }

  return errors;
}

export function hasTopicFormErrors(errors: TopicFormErrors): boolean {
  return Object.keys(errors).length > 0;
}

// ─── Filtering (client-side, over the complete unpaginated array) ────────────

export type ChannelFilter = "all" | EditorialChannelValue;
export type StatusFilter = "all" | EditorialTopicStatusValue;

export interface TopicFilters {
  search: string;
  channel: ChannelFilter;
  /** Defaults to "all": archived topics are retained content-bearing rows. */
  status: StatusFilter;
}

export const DEFAULT_TOPIC_FILTERS: TopicFilters = {
  search: "",
  channel: "all",
  status: "all",
};

export interface TopicRowLike {
  name: string;
  slug: string;
  channel: EditorialChannelValue;
  status: EditorialTopicStatusValue;
}

export function filterTopics<T extends TopicRowLike>(
  rows: readonly T[],
  filters: TopicFilters,
): T[] {
  const needle = filters.search.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.channel !== "all" && row.channel !== filters.channel) return false;
    if (filters.status !== "all" && row.status !== filters.status) return false;
    if (needle.length === 0) return true;
    return (
      row.name.toLowerCase().includes(needle) || row.slug.toLowerCase().includes(needle)
    );
  });
}

/** Drives the Filters trigger badge — search is counted by the toolbar itself. */
export function activeTopicFilterCount(filters: TopicFilters): number {
  return (filters.channel !== "all" ? 1 : 0) + (filters.status !== "all" ? 1 : 0);
}

// ─── Lifecycle copy ──────────────────────────────────────────────────────────

export interface TopicConfirmation {
  title: string;
  description: string;
  confirmLabel: string;
  destructive: boolean;
}

/**
 * Archiving is retention, not deletion: one UPDATE on `editorial_topics`,
 * nothing touches `editorial_post_topics`. The shared confirm defaults to
 * destructive/red styling, so it is explicitly opted out here — the same
 * audited decision Wave 2.1B made for language deactivation.
 */
export function archiveTopicConfirmation(topic: { name: string }): TopicConfirmation {
  return {
    title: `Archive ${topic.name}?`,
    description: `Nothing is deleted. ${topic.name} can no longer be added to posts. Posts already tagged with it keep the tag, and it stays tagged even after archiving. You can reactivate it at any time.`,
    confirmLabel: "Archive topic",
    destructive: false,
  };
}

export function reactivateTopicMessage(topic: { name: string }): string {
  return `${topic.name} can be added to posts again. No post's tags are changed.`;
}
