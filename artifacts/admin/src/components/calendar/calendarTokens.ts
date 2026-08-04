/**
 * Category colors for Calendar cards/badges. `night:` (not `dark:`) gates the
 * light-mode override — this app is dark by default and toggles a `.night`
 * class for light mode (see AdminThemeContext); Tailwind's built-in `dark:`
 * variant only matches a `.dark` ancestor, which this app never sets, so
 * `dark:`-prefixed classes here would silently never apply. Unprefixed
 * classes below are therefore the dark-mode values.
 *
 * Card titles do NOT use these category colors for text — see
 * CalendarOccurrenceCard, which uses the theme-safe `text-foreground` token
 * instead. Category identity is carried by `bg` (tinted background) and
 * `border` (colored left border) only.
 */
export interface CalendarCategoryToken {
  bg: string;
  border: string;
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
  label: string;
  dotColor: string;
}

export const CALENDAR_TOKENS = {
  class: {
    bg: "bg-emerald-950/50 night:bg-emerald-50",
    border: "border-emerald-500/40 night:border-emerald-300 border-l-4 border-l-emerald-500",
    badgeBg: "bg-emerald-500/15",
    badgeText: "text-emerald-300 night:text-emerald-700",
    badgeBorder: "border-emerald-500/30",
    label: "Studio class",
    dotColor: "bg-emerald-500",
  },
  ballet: {
    bg: "bg-purple-950/50 night:bg-purple-50",
    border: "border-purple-500/40 night:border-purple-300 border-l-4 border-l-purple-500",
    badgeBg: "bg-purple-500/15",
    badgeText: "text-purple-300 night:text-purple-700",
    badgeBorder: "border-purple-500/30",
    label: "Ballet",
    dotColor: "bg-purple-500",
  },
  reservation: {
    bg: "bg-amber-950/50 night:bg-amber-50",
    border: "border-amber-500/40 night:border-amber-300 border-l-4 border-l-amber-500",
    badgeBg: "bg-amber-500/15",
    badgeText: "text-amber-300 night:text-amber-700",
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
