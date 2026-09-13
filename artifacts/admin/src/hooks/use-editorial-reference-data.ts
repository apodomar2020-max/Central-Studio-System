/**
 * useEditorialReferenceData — the small, slow-moving lookup lists every
 * Editorial screen needs (Wave 2.1A foundation).
 *
 * Languages, authors and topics change rarely but are read by nearly every
 * Editorial screen (post filters, the translation switcher, author/topic
 * pickers). Fetching them through one hook with a shared 5-minute
 * `staleTime` keeps them out of the per-navigation refetch path.
 *
 * The staleTime is applied through each generated hook's own React Query
 * options parameter — the global QueryClient in App.tsx is intentionally left
 * untouched, so no other admin screen's caching behaviour changes. The
 * explicit `queryKey` matches the established convention in this codebase
 * (see components/admin/campaign-composer-dialog.tsx): the generated options
 * object spreads the caller's `query` last, so the key must be supplied
 * whenever any query option is passed.
 *
 * Reference data only — post bodies, translations, revisions and placements
 * are per-screen concerns and are deliberately not fetched here.
 */
import {
  useListEditorialAuthors,
  useListEditorialLanguages,
  useListEditorialTopics,
  getListEditorialAuthorsQueryKey,
  getListEditorialLanguagesQueryKey,
  getListEditorialTopicsQueryKey,
} from "@workspace/api-client-react";
import type {
  ListEditorialAuthorsParams,
  ListEditorialLanguagesParams,
  ListEditorialTopicsParams,
} from "@workspace/api-client-react";

/** Shared freshness window for Editorial reference lists (5 minutes). */
export const EDITORIAL_REFERENCE_STALE_TIME = 5 * 60 * 1000;

export interface EditorialReferenceDataParams {
  languages?: ListEditorialLanguagesParams;
  authors?: ListEditorialAuthorsParams;
  topics?: ListEditorialTopicsParams;
}

export function useEditorialReferenceData(params: EditorialReferenceDataParams = {}) {
  const languages = useListEditorialLanguages(params.languages, {
    query: {
      queryKey: getListEditorialLanguagesQueryKey(params.languages),
      staleTime: EDITORIAL_REFERENCE_STALE_TIME,
    },
  });

  const authors = useListEditorialAuthors(params.authors, {
    query: {
      queryKey: getListEditorialAuthorsQueryKey(params.authors),
      staleTime: EDITORIAL_REFERENCE_STALE_TIME,
    },
  });

  const topics = useListEditorialTopics(params.topics, {
    query: {
      queryKey: getListEditorialTopicsQueryKey(params.topics),
      staleTime: EDITORIAL_REFERENCE_STALE_TIME,
    },
  });

  return {
    // Each underlying query is returned whole, so a consuming screen can
    // react to loading/error per list rather than only in aggregate.
    languages,
    authors,
    topics,
    /** Any reference list still loading. */
    isLoading: languages.isLoading || authors.isLoading || topics.isLoading,
    /** Any reference list failed. */
    isError: languages.isError || authors.isError || topics.isError,
    /** The first failure, for a single aggregate error message. */
    error: languages.error ?? authors.error ?? topics.error ?? null,
  };
}
