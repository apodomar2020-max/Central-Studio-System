/**
 * Website → Performance (/website/performances) — Website CMS Wave 3.
 *
 * List-only screen built on the existing Admin 2.0 TableToolbar + Table
 * pattern, mirroring WebsiteNewsListPage.tsx exactly. Create and Edit are
 * NOT a Dialog here — Performance's editorial content model is even larger
 * than News' (adds card fields, hero override, performanceDetails block,
 * highlights, schedule, cast/faculty, ticketing on top of everything News
 * has), so the "dedicated page for a complex entity" precedent applies
 * even more strongly — both routes navigate to the dedicated
 * WebsitePerformanceEditorPage (/website/performances/new,
 * /website/performances/:slug/edit).
 */
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAdminWebsitePerformances,
  useUpdateWebsitePerformance,
  useDeactivateWebsitePerformance,
  getListAdminWebsitePerformancesQueryKey,
} from "@workspace/api-client-react";
import type { WebsitePerformance } from "@workspace/api-client-react";
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
type FeaturedFilter = "all" | "featured";
type SortOption = "sortOrder" | "title";
const SORT_LABELS: Record<SortOption, string> = {
  sortOrder: "Repertoire order",
  title: "Title A–Z",
};

export default function WebsitePerformanceListPage() {
  const { toast } = useToast();
  const { can } = useAdminAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const confirmAction = useAdminConfirm();

  const canCreate = can("website.performance", "create");
  const canEdit = can("website.performance", "edit");
  const canDelete = can("website.performance", "delete");

  const { data: rows, isLoading, isError } = useListAdminWebsitePerformances();
  const updatePerformance = useUpdateWebsitePerformance();
  const deactivatePerformance = useDeactivateWebsitePerformance();

  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput, 250);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [featuredFilter, setFeaturedFilter] = useState<FeaturedFilter>("all");
  const [sort, setSort] = useState<SortOption>("sortOrder");

  const filtered = useMemo(() => {
    let list = rows ?? [];
    if (statusFilter !== "all") {
      list = list.filter((r) => (statusFilter === "active" ? r.isActive : !r.isActive));
    }
    if (featuredFilter === "featured") {
      list = list.filter((r) => r.isFeatured);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((r) => r.cardTitle.toLowerCase().includes(q) || r.title.toLowerCase().includes(q));
    }
    const sorted = [...list];
    if (sort === "sortOrder") sorted.sort((a, b) => a.sortOrder - b.sortOrder);
    else sorted.sort((a, b) => a.cardTitle.localeCompare(b.cardTitle));
    return sorted;
  }, [rows, statusFilter, featuredFilter, search, sort]);

  const activeFilterCount = (statusFilter !== "all" ? 1 : 0) + (featuredFilter !== "all" ? 1 : 0);
  const hasActiveControls = activeFilterCount > 0 || sort !== "sortOrder" || search.length > 0;
  const clearControls = () => {
    setSearchInput("");
    setStatusFilter("all");
    setFeaturedFilter("all");
    setSort("sortOrder");
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListAdminWebsitePerformancesQueryKey() });
  };

  const handleDeactivate = async (perf: WebsitePerformance) => {
    const confirmed = await confirmAction({
      title: "Deactivate this Performance?",
      description: `"${perf.cardTitle}" will be removed from the public repertoire listing and its detail page immediately. It stays visible here and can be reactivated at any time.`,
      confirmLabel: "Deactivate",
    });
    if (!confirmed) return;
    deactivatePerformance.mutate(
      { slug: perf.slug },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: `Deactivated "${perf.cardTitle}"` });
        },
        onError: (err: unknown) => {
          toast({ title: "Could not deactivate Performance", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
        },
      },
    );
  };

  const handleReactivate = (perf: WebsitePerformance) => {
    updatePerformance.mutate(
      { slug: perf.slug, data: { isActive: true } },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: `Reactivated "${perf.cardTitle}"` });
        },
        onError: (err: unknown) => {
          toast({ title: "Could not reactivate Performance", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
        },
      },
    );
  };

  return (
    <div className="admin2-final-page admin2-cms-workspace admin2-website-performances space-y-6">
      <TableToolbar
        searchValue={searchInput}
        onSearchChange={setSearchInput}
        searchPlaceholder="Search Performances by title"
        searchTestId="input-performance-search"
        activeFilterCount={activeFilterCount}
        onClear={hasActiveControls ? clearControls : undefined}
        activeSortLabel={sort !== "sortOrder" ? SORT_LABELS[sort] : undefined}
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
            <div className="admin2-table-toolbar-panel-group">
              <span>Featured</span>
              <div className="admin2-filter-pills">
                {(["all", "featured"] as const).map((value) => (
                  <Button key={value} type="button" variant="outline" size="compact" aria-pressed={featuredFilter === value} className={featuredFilter === value ? "is-selected" : undefined} onClick={() => setFeaturedFilter(value)}>
                    {value === "all" ? "All" : "Featured only"}
                  </Button>
                ))}
              </div>
            </div>
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
            <Button data-testid="button-add-performance" onClick={() => navigate("/website/performances/new")} className="gap-2 shrink-0">
              <Plus className="h-4 w-4" />
              Add Performance
            </Button>
          </div>
        )}
      </TableToolbar>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Thumbnail</TableHead>
              <TableHead>Card Title</TableHead>
              <TableHead>Venue</TableHead>
              <TableHead>Date</TableHead>
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
                <TableCell colSpan={8} className="text-center py-8 text-destructive">Performances could not be loaded.</TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  {rows && rows.length > 0 ? "No Performances match your search or filters." : "No Performances yet."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((perf) => (
                <TableRow key={perf.slug} data-testid={`row-performance-${perf.slug}`}>
                  <TableCell>
                    <div className="relative h-14 w-24 rounded overflow-hidden bg-muted flex-shrink-0">
                      <img
                        src={perf.cardImageUrl}
                        alt={perf.cardTitle}
                        className="absolute inset-0 w-full h-full object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    </div>
                  </TableCell>
                  <TableCell className="font-medium max-w-[280px]">
                    <div className="truncate">{perf.cardTitle}</div>
                    <div className="text-xs text-muted-foreground truncate">/{perf.slug}</div>
                  </TableCell>
                  <TableCell>{perf.cardVenue}</TableCell>
                  <TableCell className="whitespace-nowrap">{perf.cardDatesDisplay}</TableCell>
                  <TableCell>
                    {perf.isFeatured && (
                      <Badge variant="outline" className="gap-1">
                        <Star className="h-3 w-3" /> Featured
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={perf.isActive ? "default" : "outline"}>{perf.isActive ? "Active" : "Inactive"}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {new Date(perf.updatedAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {canEdit && (
                      <Button
                        variant="ghost" size="icon"
                        aria-label={`Edit ${perf.cardTitle}`}
                        data-testid={`button-edit-performance-${perf.slug}`}
                        onClick={() => navigate(`/website/performances/${perf.slug}/edit`)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    {perf.isActive
                      ? canDelete && (
                          <Button
                            variant="ghost" size="icon"
                            aria-label={`Deactivate ${perf.cardTitle}`}
                            data-testid={`button-deactivate-performance-${perf.slug}`}
                            disabled={deactivatePerformance.isPending}
                            onClick={() => handleDeactivate(perf)}
                          >
                            <EyeOff className="h-4 w-4" />
                          </Button>
                        )
                      : canEdit && (
                          <Button
                            variant="ghost" size="icon"
                            aria-label={`Reactivate ${perf.cardTitle}`}
                            data-testid={`button-reactivate-performance-${perf.slug}`}
                            disabled={updatePerformance.isPending}
                            onClick={() => handleReactivate(perf)}
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
