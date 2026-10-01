/**
 * Website → Editorial → Posts (/editorial/posts) — Wave 2.1D.
 *
 * Replaces the Wave 2.1A placeholder for this one route.
 *
 * ─── WHY EVERY FILTER IS SERVER-SIDE ─────────────────────────────────────
 *
 * Unlike Authors and Topics (small, unpaginated lists filtered in the
 * browser), `GET /admin/editorial/posts` is SERVER-PAGINATED and accepts
 * exactly: channel, translationStatus, languageCode, authorId, topicId,
 * search, page, limit. A client-side filter over one page would silently
 * hide matches on every other page, so all of them go to the server and the
 * page resets to 1 whenever a filter changes.
 *
 * ─── NO SORTING (D9) ─────────────────────────────────────────────────────
 *
 * The endpoint's ORDER BY is fixed (`updated_at DESC, id DESC`) and it
 * exposes no sort parameter. A clickable column header would either lie or
 * reorder one page out of many, so there are none — the ordering is stated
 * in prose instead.
 *
 * ─── NO N+1 ──────────────────────────────────────────────────────────────
 *
 * The list response carries the post spine plus a translation SUMMARY per
 * post (the route fetches all of them in one extra query). It does NOT carry
 * an author name or topic names — only `authorId`. The Author column is
 * therefore resolved against the already-cached `useEditorialReferenceData()`
 * author list rather than one request per row, and there is deliberately no
 * Topics column: it would need a per-row fetch the endpoint cannot serve.
 *
 * ─── NO DELETE ───────────────────────────────────────────────────────────
 *
 * `website.posts:delete` exists in the permission catalog but NO delete
 * route exists for a post or a translation. Rendering a Delete control would
 * promise an operation the API cannot perform, so there is none. Retiring
 * content is Archive, which is per-translation and lives in the editor
 * beside that translation's own lifecycle.
 */
import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useListEditorialPosts } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { TableToolbar } from "@/components/admin/table-toolbar";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useEditorialReferenceData } from "@/hooks/use-editorial-reference-data";
import { EditorialPageShell } from "@/components/editorial/editorial-page-shell";
import { WorkspaceRouteNav } from "@/components/admin/workspace-route-nav";
import {
  DEFAULT_POST_LIST_FILTERS,
  POST_LIST_PAGE_SIZE,
  activePostFilterCount,
  channelLabel,
  formatDate,
  languageCodesLabel,
  listRowTitle,
  pageRangeLabel,
  postCapabilities,
  statusBadgeLabel,
  toPostListQuery,
  totalPages,
  translationSummaryLabel,
  type PostListFilters,
} from "@/lib/editorial-posts";
import { Info, Plus, ChevronLeft, ChevronRight, PenLine } from "lucide-react";
import "../admin2-final.css";
import "../admin2-operations.css";

const CHANNEL_FILTERS = [
  { value: "all", label: "All" },
  { value: "news", label: "News" },
  { value: "experience", label: "Experience" },
] as const;

const STATUS_FILTERS = [
  { value: "all", label: "Any" },
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
  { value: "archived", label: "Archived" },
] as const;

export default function EditorialPostsListPage() {
  const { can } = useAdminAuth();
  const capabilities = postCapabilities(can);
  const [, navigate] = useLocation();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);
  const [filters, setFilters] = useState<Omit<PostListFilters, "search">>(DEFAULT_POST_LIST_FILTERS);
  const [page, setPage] = useState(1);

  // Reference data is shared (5-minute staleTime) — the same cache entry
  // every other Editorial screen reads, never a per-component re-fetch.
  const reference = useEditorialReferenceData();
  const authorsById = useMemo(
    () => new Map((reference.authors.data ?? []).map((author) => [author.id, author])),
    [reference.authors.data],
  );

  const query = useMemo(
    () => toPostListQuery({ ...filters, search: debouncedSearch }, page, POST_LIST_PAGE_SIZE),
    [filters, debouncedSearch, page],
  );

  const { data, isLoading, isError } = useListEditorialPosts(query);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const lastPage = totalPages(total, POST_LIST_PAGE_SIZE);
  const filterCount = activePostFilterCount({ ...filters, search: debouncedSearch });

  /** Any filter change invalidates the current page number. */
  const patchFilters = (patch: Partial<Omit<PostListFilters, "search">>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  const clearAll = () => {
    setSearch("");
    setFilters(DEFAULT_POST_LIST_FILTERS);
    setPage(1);
  };

  return (
    <EditorialPageShell
      heading="Posts"
      description="Every unified Editorial post, across channels and languages. A post has no status of its own — each language's translation is published, drafted or archived independently."
      actions={
        capabilities.canCreate ? (
          <Button asChild className="gap-2 shrink-0" data-testid="button-new-post">
            <Link href="/editorial/posts/new">
              <Plus className="h-4 w-4" aria-hidden="true" />
              New post
            </Link>
          </Button>
        ) : undefined
      }
    >
      <WorkspaceRouteNav
        ariaLabel="Editorial workspace"
        items={[
          ...(can("website.posts", "view") ? [{ label: "Posts", href: "/editorial/posts" }] : []),
          ...(can("website.posts", "view") ? [{ label: "Authors", href: "/editorial/authors" }] : []),
          ...(can("website.posts", "view") ? [{ label: "Topics", href: "/editorial/topics" }] : []),
          ...(can("website.posts", "view") ? [{ label: "Placements", href: "/editorial/placements" }] : []),
        ]}
      />
      {filters.channel === "news" && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2"
          data-testid="editorial-news-guidance"
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="text-xs text-muted-foreground">
            Migrated News posts are live on the public website. Public News still uses Legacy News compatibility
            metadata and provenance. Published is an Editorial translation state and does not automatically mean
            public eligibility.
          </p>
        </div>
      )}
      {filters.channel === "experience" && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2"
          data-testid="editorial-experience-guidance"
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="text-xs text-muted-foreground">
            Editorial Experience is not connected to the public website yet. Manage live Central Experience content
            from the <Link href="/website/performances" className="underline">Performance section</Link>.
          </p>
        </div>
      )}
      <TableToolbar
        searchValue={search}
        onSearchChange={(value) => { setSearch(value); setPage(1); }}
        searchPlaceholder="Search titles and addresses"
        searchTestId="input-search-posts"
        activeFilterCount={filterCount}
        onClear={clearAll}
        filtersContent={
          <div className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="text-xs font-medium text-muted-foreground">Channel</legend>
              <div className="flex flex-wrap gap-1.5">
                {CHANNEL_FILTERS.map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    size="compact"
                    variant={filters.channel === option.value ? "default" : "outline"}
                    aria-pressed={filters.channel === option.value}
                    data-testid={`filter-post-channel-${option.value}`}
                    onClick={() => patchFilters({ channel: option.value })}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-xs font-medium text-muted-foreground">Translation state</legend>
              <div className="flex flex-wrap gap-1.5">
                {STATUS_FILTERS.map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    size="compact"
                    variant={filters.translationStatus === option.value ? "default" : "outline"}
                    aria-pressed={filters.translationStatus === option.value}
                    data-testid={`filter-post-status-${option.value}`}
                    onClick={() => patchFilters({ translationStatus: option.value })}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Matches posts with ANY translation in that state. Combine it with a language to mean
                “posts whose translation in that language is in that state”.
              </p>
            </fieldset>

            <div className="grid gap-2">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="filter-post-language">
                Language
              </label>
              <Select
                value={String(filters.languageCode)}
                onValueChange={(value) => patchFilters({ languageCode: value })}
              >
                <SelectTrigger id="filter-post-language" data-testid="filter-post-language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any language</SelectItem>
                  {(reference.languages.data ?? []).map((language) => (
                    <SelectItem key={language.code} value={language.code}>
                      {language.name}
                      {language.isActive ? "" : " (retired)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="filter-post-author">
                Author
              </label>
              <Select
                value={String(filters.authorId)}
                onValueChange={(value) => patchFilters({ authorId: value === "all" ? "all" : Number(value) })}
              >
                <SelectTrigger id="filter-post-author" data-testid="filter-post-author">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any author</SelectItem>
                  {(reference.authors.data ?? []).map((author) => (
                    <SelectItem key={author.id} value={String(author.id)}>
                      {author.publicName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="filter-post-topic">
                Topic
              </label>
              <Select
                value={String(filters.topicId)}
                onValueChange={(value) => patchFilters({ topicId: value === "all" ? "all" : Number(value) })}
              >
                <SelectTrigger id="filter-post-topic" data-testid="filter-post-topic">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any topic</SelectItem>
                  {(reference.topics.data ?? []).map((topic) => (
                    <SelectItem key={topic.id} value={String(topic.id)}>
                      {topic.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        }
      />

      {/* D9: the ordering is server-owned and stated, not offered as a control. */}
      <p className="text-xs text-muted-foreground" data-testid="posts-ordering-note">
        Most recently updated first. Search and filters are applied across every page, not just this one.
      </p>

      <div className="border rounded-md overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Channel</TableHead>
              <TableHead>Author</TableHead>
              <TableHead>Languages</TableHead>
              <TableHead>Translations</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8">Loading…</TableCell>
              </TableRow>
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-destructive">
                  Posts could not be loaded.
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  {filterCount === 0 && debouncedSearch.trim().length === 0
                    ? "No posts yet."
                    : "No posts match the current search and filters."}
                </TableCell>
              </TableRow>
            ) : (
              items.map((item) => {
                const author = item.post.authorId == null ? null : authorsById.get(item.post.authorId);
                return (
                  <TableRow key={item.post.id} data-testid={`row-post-${item.post.id}`}>
                    <TableCell className="font-medium max-w-[26rem]">
                      <Link
                        href={`/editorial/posts/${item.post.id}`}
                        className="hover:underline break-words"
                        data-testid={`link-post-${item.post.id}`}
                      >
                        {listRowTitle(item)}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" data-testid={`badge-channel-post-${item.post.id}`}>
                        {channelLabel(item.post.channel)}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {/* Resolved from the SHARED reference cache — never a per-row request. */}
                      {author ? author.publicName : <span className="text-muted-foreground">No author</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums text-xs">
                      {languageCodesLabel(item.translations)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <div className="flex flex-wrap gap-1">
                        {item.translations.length === 0 ? (
                          <span className="text-muted-foreground text-xs">No translations</span>
                        ) : (
                          item.translations.map((translation) => (
                            <Badge
                              key={translation.languageCode}
                              variant={translation.status === "published" ? "default" : "outline"}
                              data-testid={`badge-translation-${item.post.id}-${translation.languageCode}`}
                            >
                              {translation.languageCode} · {statusBadgeLabel(translation.status)}
                            </Badge>
                          ))
                        )}
                      </div>
                      <span className="sr-only">{translationSummaryLabel(item.translations)}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {formatDate(item.post.updatedAt)}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Open ${listRowTitle(item)}`}
                        data-testid={`button-open-post-${item.post.id}`}
                        onClick={() => navigate(`/editorial/posts/${item.post.id}`)}
                      >
                        <PenLine className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground tabular-nums" data-testid="posts-page-range">
          {pageRangeLabel(page, POST_LIST_PAGE_SIZE, total)}
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="compact"
            className="gap-1"
            disabled={page <= 1 || isLoading}
            data-testid="button-posts-prev"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Previous
          </Button>
          <span className="text-xs text-muted-foreground tabular-nums" data-testid="posts-page-number">
            Page {page} of {lastPage}
          </span>
          <Button
            type="button"
            variant="outline"
            size="compact"
            className="gap-1"
            disabled={page >= lastPage || isLoading}
            data-testid="button-posts-next"
            onClick={() => setPage((current) => Math.min(lastPage, current + 1))}
          >
            Next
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </EditorialPageShell>
  );
}
