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

/** AsyncStorage keys for the personalization onboarding sequence. */
export const STORAGE_KEYS = {
  danceStyles: "cs_dance_styles",
  phoneVerified: "cs_phone_verified",
  /**
   * TEMPORARY — stored locally until the backend adds these columns to the
   * students table:  date_of_birth (text/date), city (text), nationality (text).
   * Once the columns and PATCH /api/auth/profile support them, migrate these
   * values to the server and remove these keys.
   */
  profileDob: "cs_profile_dob",
  profileCity: "cs_profile_city",
  profileNationality: "cs_profile_nationality",
} as const;
