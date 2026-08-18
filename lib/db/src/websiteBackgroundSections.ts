/**
 * website_background_settings — fixed section registry (Website CMS Wave 1).
 *
 * This is the single, authoritative list of the 8 approved public-website
 * background sections. It is imported by:
 *   - artifacts/api-server/src/routes/websiteBackgrounds.ts (validates that
 *     an incoming :sectionKey is one of these, and looks up each section's
 *     allowedMediaKind for the media-kind validation step)
 *   - scripts/src/seedWebsiteBackgrounds.ts (the idempotent seed step)
 *
 * The set is closed by application logic: there is no create/delete route
 * for this table, so this array — not admin input, not the database on its
 * own — is what makes "exactly 8 keys, nothing else" true. The database
 * additionally enforces the same fixed set via a CHECK constraint on
 * section_key (see migration 0109_website_background_settings.sql) as
 * defense-in-depth; that SQL list must be kept in sync with this one by
 * hand, since a CHECK constraint can't import a TS module.
 *
 * `allowedMediaKind` is the server-side authority referenced in the Wave 1
 * brief ("the server-side registry is authoritative... do not accept
 * mediaType from Admin input") — it is never sent by the client and never
 * trusted from the client; every PATCH re-derives the actual media kind
 * from a live Content-Type check and rejects if it doesn't match the value
 * here for that section.
 */

export type WebsiteBackgroundPage = "home" | "about-studio" | "ballet" | "classes";
export type WebsiteBackgroundMediaKind = "image" | "video";

export interface WebsiteBackgroundSectionDef {
  sectionKey: string;
  page: WebsiteBackgroundPage;
  sectionLabel: string;
  /** What the CURRENT website implementation renders today, for reference only. */
  currentMechanism: string;
  /** The only media kind Admin may save for this section — server-enforced. */
  allowedMediaKind: WebsiteBackgroundMediaKind;
}

export const WEBSITE_BACKGROUND_SECTIONS: readonly WebsiteBackgroundSectionDef[] = [
  {
    sectionKey: "home.section1",
    page: "home",
    sectionLabel: "Home — Hero (Section 1)",
    currentMechanism: "raw <video> — components/HeroViewport.tsx",
    allowedMediaKind: "video",
  },
  {
    sectionKey: "home.section3",
    page: "home",
    sectionLabel: "Home — Academy Feature (Section 3)",
    currentMechanism: "CSS background-image — components/SecondSection.tsx",
    allowedMediaKind: "image",
  },
  {
    sectionKey: "about-studio.section1",
    page: "about-studio",
    sectionLabel: "About Studio — Hero (Section 1)",
    currentMechanism: "raw <video> — components/AboutHeroSection.tsx",
    allowedMediaKind: "video",
  },
  {
    sectionKey: "about-studio.section4",
    page: "about-studio",
    sectionLabel: "About Studio — Co-Founder (Section 4)",
    currentMechanism: "Next/Image (unoptimized) — components/CoFounderSection.tsx",
    allowedMediaKind: "image",
  },
  {
    sectionKey: "about-studio.section7",
    page: "about-studio",
    sectionLabel: "About Studio — App Download (Section 7)",
    currentMechanism: "raw <video> — components/AppDownloadSection.tsx",
    allowedMediaKind: "video",
  },
  {
    sectionKey: "ballet.section1",
    page: "ballet",
    sectionLabel: "Ballet — Hero (Section 1)",
    currentMechanism: "raw <video> — components/BalletHeroSection.tsx",
    allowedMediaKind: "video",
  },
  {
    sectionKey: "ballet.section2",
    page: "ballet",
    sectionLabel: "Ballet — Metrics (Section 2)",
    currentMechanism: "none today (flat #0E0E0E) — components/ScrollMetricsSection.tsx",
    allowedMediaKind: "image",
  },
  {
    sectionKey: "classes.section1",
    page: "classes",
    sectionLabel: "Classes — Hero (Section 1)",
    currentMechanism: "Next/Image — components/ClassesHeroSection.tsx",
    allowedMediaKind: "image",
  },
] as const;

export const WEBSITE_BACKGROUND_SECTION_KEYS: readonly string[] =
  WEBSITE_BACKGROUND_SECTIONS.map((s) => s.sectionKey);

export function getWebsiteBackgroundSection(sectionKey: string): WebsiteBackgroundSectionDef | undefined {
  return WEBSITE_BACKGROUND_SECTIONS.find((s) => s.sectionKey === sectionKey);
}
