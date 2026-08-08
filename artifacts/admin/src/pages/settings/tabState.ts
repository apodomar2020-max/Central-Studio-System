import { Tag, Users, Bell, Music2, Sparkles } from "lucide-react";

export const SETTINGS_TABS = [
  { value: "pricing", label: "Class Pricing", icon: Tag },
  { value: "capacity", label: "Class Capacity", icon: Users },
  { value: "reminders", label: "Class Reminders", icon: Bell },
  { value: "music", label: "Background Music", icon: Music2 },
  { value: "dance-types", label: "Dance Types", icon: Sparkles },
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number]["value"];

const VALID_TAB_SET = new Set<string>(SETTINGS_TABS.map((t) => t.value));

export function parseSettingsTab(search: string): SettingsTab {
  const normalized = search.startsWith("?") ? search.slice(1) : search;
  const tabValue = new URLSearchParams(normalized).get("tab");
  if (tabValue && VALID_TAB_SET.has(tabValue)) {
    return tabValue as SettingsTab;
  }
  return "pricing";
}

export function buildSettingsTabUrl(tab: SettingsTab): string {
  if (tab === "pricing") {
    return "/settings";
  }
  return `/settings?tab=${tab}`;
}
