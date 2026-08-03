export interface CalendarCategoryToken {
  bg: string;
  border: string;
  text: string;
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
  label: string;
  dotColor: string;
}

export const CALENDAR_TOKENS = {
  class: {
    bg: "bg-emerald-500/10 dark:bg-emerald-950/30",
    border: "border-emerald-500/30 dark:border-emerald-500/40 border-l-4 border-l-emerald-500",
    text: "text-emerald-950 dark:text-emerald-100",
    badgeBg: "bg-emerald-500/15",
    badgeText: "text-emerald-700 dark:text-emerald-300",
    badgeBorder: "border-emerald-500/30",
    label: "Studio class",
    dotColor: "bg-emerald-500",
  },
  ballet: {
    bg: "bg-purple-500/10 dark:bg-purple-950/30",
    border: "border-purple-500/30 dark:border-purple-500/40 border-l-4 border-l-purple-500",
    text: "text-purple-950 dark:text-purple-100",
    badgeBg: "bg-purple-500/15",
    badgeText: "text-purple-700 dark:text-purple-300",
    badgeBorder: "border-purple-500/30",
    label: "Ballet",
    dotColor: "bg-purple-500",
  },
  reservation: {
    bg: "bg-amber-500/10 dark:bg-amber-950/30",
    border: "border-amber-500/30 dark:border-amber-500/40 border-l-4 border-l-amber-500",
    text: "text-amber-950 dark:text-amber-100",
    badgeBg: "bg-amber-500/15",
    badgeText: "text-amber-700 dark:text-amber-300",
    badgeBorder: "border-amber-500/30",
    label: "Private event",
    dotColor: "bg-amber-500",
  },
  conflict: {
    border: "border-2 border-destructive border-l-4 border-l-destructive",
    badgeBg: "bg-destructive",
    badgeText: "text-destructive-foreground",
    label: "Conflict",
    dotColor: "bg-destructive",
  },
} as const;

export type CalendarSourceType = "class" | "ballet" | "reservation";

export function getCalendarCategoryTokens(source: CalendarSourceType) {
  return CALENDAR_TOKENS[source] || CALENDAR_TOKENS.class;
}
