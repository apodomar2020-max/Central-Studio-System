import { useEffect, useState } from "react";
import type { ListStudentsParams } from "@workspace/api-client-react";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { TableToolbar } from "./table-toolbar";
import { WorkspaceRouteNav } from "./workspace-route-nav";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type DirectorySection = "student" | "parent" | "inactive";
export const DIRECTORY_PAGE_SIZES = [25, 50, 100] as const;

/** Own only directory query controls, not fetching or account mutations. */
export function useUsersDirectory(section: DirectorySection) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const [filters, setFilters] = useState<
    Pick<
      ListStudentsParams,
      | "accountStatus"
      | "accountType"
      | "authProvider"
      | "joinedFrom"
      | "joinedTo"
    >
  >({});
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [search]);
  const changeFilter = (key: keyof typeof filters, value: string) => {
    setFilters((previous) => ({ ...previous, [key]: value || undefined }));
    setPage(1);
  };
  const invalidDateRange = Boolean(
    filters.joinedFrom &&
    filters.joinedTo &&
    filters.joinedFrom > filters.joinedTo,
  );
  const params: ListStudentsParams = {
    ...filters,
    accountStatus:
      section === "inactive" ? (filters.accountStatus ?? "inactive") : "active",
    accountType: section === "inactive" ? filters.accountType : section,
    page,
    pageSize,
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
  };
  return {
    section,
    search,
    page,
    pageSize,
    filters,
    params,
    invalidDateRange,
    setPage,
    changeSearch: (value: string) => {
      setSearch(value);
      setPage(1);
    },
    changePageSize: (value: string) => {
      setPageSize(Number(value));
      setPage(1);
    },
    changeFilter,
    clear: () => {
      setSearch("");
      setDebouncedSearch("");
      setFilters({});
      setPage(1);
    },
  };
}

type Controls = ReturnType<typeof useUsersDirectory>;
export function UsersDirectoryControls({ controls }: { controls: Controls }) {
  const { can } = useAdminAuth();
  const canStudents = can("students", "view") || can("users", "view");
  const canParents = can("parents", "view") || can("users", "view");
  const inactive = controls.section === "inactive";
  const filterCount = Object.values(controls.filters).filter(Boolean).length;
  const choose = (
    key: keyof Controls["filters"],
    label: string,
    options: [string, string][],
  ) => (
    <div className="admin2-table-toolbar-panel-group">
      <span id={`users-filter-${key}`}>{label}</span>
      <Select
        value={controls.filters[key] || "all"}
        onValueChange={(value) =>
          controls.changeFilter(key, value === "all" ? "" : value)
        }
      >
        <SelectTrigger aria-labelledby={`users-filter-${key}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([value, text]) => (
            <SelectItem key={value} value={value}>
              {text}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
  return (
    <TableToolbar
      className="admin2-users-command"
      leadingContent={
        <WorkspaceRouteNav
          ariaLabel="Users workspace"
          items={[
            ...(can("students", "view")
              ? [{ label: "Students", href: "/students" }]
              : []),
            ...(can("parents", "view")
              ? [{ label: "Parents", href: "/parents" }]
              : []),
            ...(canStudents || canParents
              ? [{ label: "Inactive Accounts", href: "/inactive-accounts" }]
              : []),
          ]}
        />
      }
      searchValue={controls.search}
      onSearchChange={controls.changeSearch}
      searchPlaceholder={`Search ${inactive ? "inactive accounts" : controls.section === "parent" ? "parents" : "students"} by name, email, or phone`}
      searchTestId={`input-${controls.section}-search`}
      activeFilterCount={filterCount}
      onClear={controls.clear}
      filtersContent={
        <>
          {inactive &&
            choose("accountStatus", "Account Status", [
              ["all", "All inactive"],
              ["deactivated", "Deactivated"],
              ["deleted", "Deleted"],
            ])}
          {inactive &&
            choose("accountType", "Account Type", [
              ["all", "All permitted types"],
              ...(canStudents
                ? [["student", "Students"] as [string, string]]
                : []),
              ...(canParents
                ? [["parent", "Parents"] as [string, string]]
                : []),
            ])}
          {choose("authProvider", "Authentication Provider", [
            ["all", "All providers"],
            ["local", "Local"],
            ["google", "Google"],
            ["apple", "Apple"],
            ["facebook", "Facebook"],
            ["notRecorded", "Not Recorded"],
          ])}
          <p className="text-xs text-muted-foreground">
            Last recorded authentication provider, not signup source. Deleted
            records have no recorded provider.
          </p>
          <div className="admin2-table-toolbar-panel-group">
            <label htmlFor="users-joined-from">Joined from (UTC)</label>
            <Input
              id="users-joined-from"
              type="date"
              value={controls.filters.joinedFrom ?? ""}
              max={controls.filters.joinedTo}
              onChange={(event) =>
                controls.changeFilter("joinedFrom", event.target.value)
              }
            />
            <label htmlFor="users-joined-to">Joined through (UTC)</label>
            <Input
              id="users-joined-to"
              type="date"
              value={controls.filters.joinedTo ?? ""}
              min={controls.filters.joinedFrom}
              onChange={(event) =>
                controls.changeFilter("joinedTo", event.target.value)
              }
            />
            {controls.invalidDateRange && (
              <p role="alert" className="text-sm text-destructive">
                End date must not precede start date.
              </p>
            )}
          </div>
        </>
      }
    >
      <div className="admin2-users-rows">
        <span id="users-page-size" className="text-sm text-muted-foreground">
          Rows
        </span>
        <Select
          value={String(controls.pageSize)}
          onValueChange={controls.changePageSize}
        >
          <SelectTrigger className="w-24" aria-labelledby="users-page-size" data-testid={`select-${controls.section}-page-size`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DIRECTORY_PAGE_SIZES.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </TableToolbar>
  );
}
