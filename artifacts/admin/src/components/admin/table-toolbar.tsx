import { Filter, SlidersHorizontal, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * TableToolbar — Data Tables Enhancement shared control surface.
 *
 * Presentation only: search input (always visible), one Filters trigger
 * (opens a popover — the caller supplies its own filter controls as
 * children via `filtersContent`, built from the same Input/Select/pill
 * primitives every other Admin 2.0 page already uses), an optional Sort
 * trigger of the same shape, and a Clear action that only appears once
 * something is active. No fetching, no filter/sort semantics, no query
 * construction lives here — every page keeps owning which fields are
 * searchable, what a filter means, and how it's applied (client array
 * filter for Studio, query param for Ballet). This composes inside the
 * existing `.admin2-command-bar` card, it does not replace it.
 */
export function TableToolbar({
  searchValue,
  onSearchChange,
  searchPlaceholder = "Search…",
  searchTestId,
  filtersContent,
  activeFilterCount = 0,
  sortContent,
  activeSortLabel,
  onClear,
  className,
  children,
}: {
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  searchTestId?: string;
  /** Filter controls rendered inside the Filters popover. Omit to hide the trigger entirely. */
  filtersContent?: React.ReactNode;
  /** Drives the badge shown on the Filters trigger. */
  activeFilterCount?: number;
  /** Sort controls rendered inside the Sort popover. Omit to hide the trigger entirely. */
  sortContent?: React.ReactNode;
  /** Short label shown on the Sort trigger when a non-default sort is active, e.g. "Name". */
  activeSortLabel?: string;
  /** Shown only when search/filters/sort are active (caller decides what "active" means). */
  onClear?: () => void;
  className?: string;
  /** Extra controls (e.g. a page-size Select, an Add button) — rendered after Sort, matching each page's existing right-aligned toolbar items. */
  children?: React.ReactNode;
}) {
  const hasActiveFilters = activeFilterCount > 0;
  const hasActiveSort = Boolean(activeSortLabel);
  const showClear = Boolean(onClear) && (Boolean(searchValue) || hasActiveFilters || hasActiveSort);

  return (
    <div className={cn("admin2-command-bar admin2-table-toolbar", className)}>
      <div className="admin2-table-toolbar-search">
        <Search aria-hidden="true" />
        <Input
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          data-testid={searchTestId}
          aria-label={searchPlaceholder}
        />
      </div>

      {filtersContent && (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="compact"
              className="gap-1.5"
              aria-label={hasActiveFilters ? `Filters, ${activeFilterCount} active` : "Filters"}
            >
              <Filter />
              Filters
              {hasActiveFilters && (
                <Badge variant="secondary" className="ml-0.5 h-4 min-w-4 justify-center px-1 text-[10px] leading-none">
                  {activeFilterCount}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="admin2-table-toolbar-panel">
            {filtersContent}
          </PopoverContent>
        </Popover>
      )}

      {sortContent && (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="compact"
              className="gap-1.5"
              aria-label={hasActiveSort ? `Sort, currently ${activeSortLabel}` : "Sort"}
            >
              <SlidersHorizontal />
              {hasActiveSort ? `Sort: ${activeSortLabel}` : "Sort"}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="admin2-table-toolbar-panel">
            {sortContent}
          </PopoverContent>
        </Popover>
      )}

      {showClear && (
        <Button type="button" variant="ghost" size="compact" className="gap-1.5 text-muted-foreground" onClick={onClear}>
          <X />
          Clear
        </Button>
      )}

      {children}
    </div>
  );
}
