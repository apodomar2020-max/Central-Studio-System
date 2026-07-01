/**
 * Dance styles offered for signup personalization.
 * Mirrors the redesign's DANCE_STYLES list (signup-screens.jsx).
 * `icon` maps each style to an Ionicons glyph (the web prototype used a
 * custom SVG sprite; Ionicons are the closest built-in stand-ins).
 */
export interface DanceStyle {
  id: string;
  name: string;
  icon: string;
}

export const DANCE_STYLES: DanceStyle[] = [
  { id: "hiphop", name: "Hip Hop", icon: "musical-notes" },
  { id: "afro", name: "Afro", icon: "pulse" },
  { id: "salsa", name: "Salsa", icon: "flame" },
  { id: "bachata", name: "Bachata", icon: "heart" },
  { id: "breaking", name: "Breaking", icon: "sync" },
  { id: "locking", name: "Locking", icon: "lock-closed" },
  { id: "popping", name: "Popping", icon: "flash" },
  { id: "contemporary", name: "Contemporary", icon: "leaf" },
  { id: "ballet", name: "Ballet", icon: "flower" },
  { id: "jazz", name: "Jazz", icon: "musical-note" },
  { id: "zumba", name: "Zumba", icon: "fitness" },
  { id: "house", name: "House Dance", icon: "home" },
];

/**
 * AsyncStorage keys for the onboarding sequence. `danceStyles` is a local
 * cache only (backend student_dance_interests is the real persistence — see
 * app/onboarding/styles.tsx). gender/dateOfBirth/city/nationality/
 * howDidYouHearAboutUs/policiesAccepted are all backend-persisted now
 * (Profile Completion Engine, Phase 4) — no AsyncStorage equivalents.
 */
export const STORAGE_KEYS = {
  danceStyles: "cs_dance_styles",
} as const;
