export const APPLICATION_DETAIL_TABS = [
  { value: "overview", label: "Overview" },
  { value: "application", label: "Application" },
  { value: "enrollment", label: "Enrollment" },
  { value: "payments", label: "Payments & Subscription" },
  { value: "cancellation", label: "Cancellation & Refunds" },
  { value: "activity", label: "Activity" },
] as const;

export type ApplicationDetailTab = (typeof APPLICATION_DETAIL_TABS)[number]["value"];

const APPLICATION_DETAIL_TAB_VALUES = new Set<string>(
  APPLICATION_DETAIL_TABS.map((tab) => tab.value),
);

export function parseApplicationTab(search: string): ApplicationDetailTab {
  const normalizedSearch = search.startsWith("?") ? search.slice(1) : search;
  const value = new URLSearchParams(normalizedSearch).get("tab");
  return value && APPLICATION_DETAIL_TAB_VALUES.has(value)
    ? (value as ApplicationDetailTab)
    : "overview";
}

export function buildApplicationDetailTabUrl({
  pathname,
  search,
  hash,
  tab,
}: {
  pathname: string;
  search: string;
  hash: string;
  tab: string;
}): string {
  const nextTab = APPLICATION_DETAIL_TAB_VALUES.has(tab)
    ? (tab as ApplicationDetailTab)
    : "overview";
  const normalizedSearch = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(normalizedSearch);

  if (nextTab === "overview") {
    params.delete("tab");
  } else {
    params.set("tab", nextTab);
  }

  const nextSearch = params.toString();
  const nextHash = hash && !hash.startsWith("#") ? `#${hash}` : hash;
  return `${pathname}${nextSearch ? `?${nextSearch}` : ""}${nextHash}`;
}
