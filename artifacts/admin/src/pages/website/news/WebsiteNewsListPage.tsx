/**
 * Website → News (/website/news) — Website CMS Wave 2.
 *
 * List-only screen built on the existing Admin 2.0 TableToolbar + Table
 * pattern (mirrors classes.tsx's search/filter/sort/Add shape). Create and
 * Edit are NOT a Dialog here — News' full editorial content model (flat
 * fields + repeatable structured sections + related content) is too large
 * for the project's established Dialog UX, so both routes navigate to the
 * dedicated WebsiteNewsEditorPage (/website/news/new,
 * /website/news/:slug/edit) — the same "dedicated page for a complex
 * entity" precedent as ApplicationDetailPage /
 * BalletRequirementsSectionPage.
 */
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAdminWebsiteNews,
  useUpdateWebsiteNewsPost,
  useDeactivateWebsiteNewsPost,
  getListAdminWebsiteNewsQueryKey,
} from "@workspace/api-client-react";
import type { WebsiteNewsPost } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableToolbar } from "@/components/admin/table-toolbar";
import { useAdminConfirm } from "@/components/admin/admin-confirm";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, EyeOff, RotateCcw, Star } from "lucide-react";

type StatusFilter = "all" | "active" | "inactive";
type SortOption = "newest" | "oldest" | "title";
const SORT_LABELS: Record<SortOption, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  title: "Title A–Z",
};

export default function WebsiteNewsListPage() {
  const { toast } = useToast();
  const { can } = useAdminAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const confirmAction = useAdminConfirm();

  const canCreate = can("website.news", "create");
  const canEdit = can("website.news", "edit");
  const canDelete = can("website.news", "delete");

  const { data: rows, isLoading, isError } = useListAdminWebsiteNews();
  const updatePost = useUpdateWebsiteNewsPost();
  const deactivatePost = useDeactivateWebsiteNewsPost();

  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput, 250);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [sort, setSort] = useState<SortOption>("newest");

  const categoryOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of rows ?? []) seen.set(row.category, row.categoryLabel);
    return Array.from(seen.entries()).map(([value, label]) => ({ value, label }));
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows ?? [];
    if (statusFilter !== "all") {
      list = list.filter((r) => (statusFilter === "active" ? r.isActive : !r.isActive));
    }
    if (categoryFilter !== "all") {
      list = list.filter((r) => r.category === categoryFilter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((r) => r.title.toLowerCase().includes(q) || r.subtitle.toLowerCase().includes(q));
    }
    const sorted = [...list];
    if (sort === "newest") sorted.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    else if (sort === "oldest") sorted.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
    else sorted.sort((a, b) => a.title.localeCompare(b.title));
    return sorted;
  }, [rows, statusFilter, categoryFilter, search, sort]);

  const activeFilterCount = (statusFilter !== "all" ? 1 : 0) + (categoryFilter !== "all" ? 1 : 0);
  const hasActiveControls = activeFilterCount > 0 || sort !== "newest" || search.length > 0;
  const clearControls = () => {
    setSearchInput("");
    setStatusFilter("all");
    setCategoryFilter("all");
    setSort("newest");
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListAdminWebsiteNewsQueryKey() });
  };

  const handleDeactivate = async (post: WebsiteNewsPost) => {
    const confirmed = await confirmAction({
      title: "Deactivate this News post?",
      description: `"${post.title}" will be removed from the public News listing and its detail page immediately. It stays visible here and can be reactivated at any time.`,
      confirmLabel: "Deactivate",
    });
    if (!confirmed) return;
    deactivatePost.mutate(
      { slug: post.slug },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: `Deactivated "${post.title}"` });
        },
        onError: (err: unknown) => {
          toast({ title: "Could not deactivate post", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
        },
      },
    );
  };

  const handleReactivate = (post: WebsiteNewsPost) => {
    updatePost.mutate(
      { slug: post.slug, data: { isActive: true } },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: `Reactivated "${post.title}"` });
        },
        onError: (err: unknown) => {
          toast({ title: "Could not reactivate post", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
        },
      },
    );
  };

  return (
    <div className="admin2-final-page admin2-cms-workspace admin2-website-news space-y-6">
      <TableToolbar
        searchValue={searchInput}
        onSearchChange={setSearchInput}
        searchPlaceholder="Search News posts by title"
        searchTestId="input-news-search"
        activeFilterCount={activeFilterCount}
        onClear={hasActiveControls ? clearControls : undefined}
        activeSortLabel={sort !== "newest" ? SORT_LABELS[sort] : undefined}
        filtersContent={
          <>
            <div className="admin2-table-toolbar-panel-group">
              <span>Status</span>
              <div className="admin2-filter-pills">
                {(["all", "active", "inactive"] as const).map((value) => (
                  <Button key={value} type="button" variant="outline" size="compact" aria-pressed={statusFilter === value} className={statusFilter === value ? "is-selected" : undefined} onClick={() => setStatusFilter(value)}>
                    {value === "all" ? "All" : value === "active" ? "Active" : "Inactive"}
                  </Button>
                ))}
              </div>
            </div>
            {categoryOptions.length > 0 && (
              <div className="admin2-table-toolbar-panel-group">
                <span>Category</span>
                <div className="admin2-filter-pills">
                  <Button type="button" variant="outline" size="compact" aria-pressed={categoryFilter === "all"} className={categoryFilter === "all" ? "is-selected" : undefined} onClick={() => setCategoryFilter("all")}>All</Button>
                  {categoryOptions.map((c) => (
                    <Button key={c.value} type="button" variant="outline" size="compact" aria-pressed={categoryFilter === c.value} className={categoryFilter === c.value ? "is-selected" : undefined} onClick={() => setCategoryFilter(c.value)}>
                      {c.label}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </>
        }
        sortContent={
          <div className="admin2-table-toolbar-panel-group">
            <span>Sort by</span>
            <div className="admin2-filter-pills">
              {(Object.keys(SORT_LABELS) as SortOption[]).map((value) => (
                <Button key={value} type="button" variant="outline" size="compact" aria-pressed={sort === value} className={sort === value ? "is-selected" : undefined} onClick={() => setSort(value)}>
                  {SORT_LABELS[value]}
                </Button>
              ))}
            </div>
          </div>
        }
      >
        {canCreate && (
          <div className="admin2-table-toolbar-add">
            <Button data-testid="button-add-news" onClick={() => navigate("/website/news/new")} className="gap-2 shrink-0">
              <Plus className="h-4 w-4" />
              Add News
            </Button>
          </div>
        )}
      </TableToolbar>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Thumbnail</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Published</TableHead>
              <TableHead>Featured</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last Updated</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8">Loading...</TableCell>
              </TableRow>
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-destructive">News posts could not be loaded.</TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  {rows && rows.length > 0 ? "No News posts match your search or filters." : "No News posts yet."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((post) => (
                <TableRow key={post.slug} data-testid={`row-news-${post.slug}`}>
                  <TableCell>
                    <div className="relative h-14 w-24 rounded overflow-hidden bg-muted flex-shrink-0">
                      <img
                        src={post.listingImageUrl ?? post.heroImageUrl}
                        alt={post.title}
                        className="absolute inset-0 w-full h-full object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    </div>
                  </TableCell>
                  <TableCell className="font-medium max-w-[280px]">
                    <div className="truncate">{post.title}</div>
                    <div className="text-xs text-muted-foreground truncate">/{post.slug}</div>
                  </TableCell>
                  <TableCell>{post.categoryLabel}</TableCell>
                  <TableCell className="whitespace-nowrap">{post.publishedDate}</TableCell>
                  <TableCell>
                    {post.isFeatured && (
                      <Badge variant="outline" className="gap-1">
                        <Star className="h-3 w-3" /> Featured
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={post.isActive ? "default" : "outline"}>{post.isActive ? "Active" : "Inactive"}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {new Date(post.updatedAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {canEdit && (
                      <Button
                        variant="ghost" size="icon"
                        aria-label={`Edit ${post.title}`}
                        data-testid={`button-edit-news-${post.slug}`}
                        onClick={() => navigate(`/website/news/${post.slug}/edit`)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    {post.isActive
                      ? canDelete && (
                          <Button
                            variant="ghost" size="icon"
                            aria-label={`Deactivate ${post.title}`}
                            data-testid={`button-deactivate-news-${post.slug}`}
                            disabled={deactivatePost.isPending}
                            onClick={() => handleDeactivate(post)}
                          >
                            <EyeOff className="h-4 w-4" />
                          </Button>
                        )
                      : canEdit && (
                          <Button
                            variant="ghost" size="icon"
                            aria-label={`Reactivate ${post.title}`}
                            data-testid={`button-reactivate-news-${post.slug}`}
                            disabled={updatePost.isPending}
                            onClick={() => handleReactivate(post)}
                          >
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                        )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
import "../../admin2-final.css";
