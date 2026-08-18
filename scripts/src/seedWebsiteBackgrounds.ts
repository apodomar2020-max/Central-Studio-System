/**
 * Website CMS Wave 1 — seed the 8 approved website_background_settings rows.
 *
 * SEPARATE, controlled step from migration 0109_website_background_settings
 * (schema only, no data) — per the locked Wave 1 seed strategy, schema
 * creation and content seeding are never mixed into one migration.
 *
 * Idempotent: uses `ON CONFLICT ("section_key") DO NOTHING`, so re-running
 * this script never duplicates a row and never overwrites a row that
 * already exists — including one an administrator has since edited through
 * the Admin UI. There is no UPDATE anywhere in this script.
 *
 * Seed values:
 *   - 7 sections that already have live media today are seeded with that
 *     EXACT current URL (verified against the live component source in the
 *     Wave 1 report) as the initial media_url and its allowed media_kind.
 *   - ballet.section2 is seeded with media_url = NULL, media_kind = NULL —
 *     it has no existing background media today (flat #0E0E0E); Admin can
 *     configure one later, but there is nothing to seed.
 * These are the ADMIN-VISIBLE/EDITABLE starting values only. The website
 * itself never depends on this table being seeded — every one of the 8
 * components keeps its own current asset as a local hardcoded fallback
 * (DEFAULT_BACKGROUND_URL), so a not-yet-seeded or even entirely missing
 * table causes zero visual change on the public site.
 *
 * Usage:
 *   DATABASE_URL=postgres://... pnpm --filter @workspace/scripts run seed-website-backgrounds
 *   DATABASE_URL=postgres://... pnpm --filter @workspace/scripts run seed-website-backgrounds -- --dry-run
 *
 * --dry-run prints what would be inserted without writing anything.
 */
import { sql } from "drizzle-orm";
import { db, pool, WEBSITE_BACKGROUND_SECTIONS } from "@workspace/db";

const DRY_RUN = process.argv.includes("--dry-run");

/**
 * Current verified media URL per section — copied verbatim from the live
 * component source (see the Wave 1 report's re-verified component reads).
 * `null` for ballet.section2, which has no existing media today.
 */
const CURRENT_MEDIA_URL: Record<string, string | null> = {
  "home.section1": "https://res.cloudinary.com/wwwgoc5d/video/upload/v1785199775/videoplayback_z77pde.mp4",
  "home.section3": "https://res.cloudinary.com/wwwgoc5d/image/upload/v1785833502/ChatGPT_Image_Jul_15_2026_02_53_20_AM_1_nfh3nc.png",
  "about-studio.section1": "https://res.cloudinary.com/wwwgoc5d/video/upload/v1784993871/Logo_animation_theater_light_glow_202607251827_gwr_video_mvp_sbp8pd.mp4",
  "about-studio.section4": "https://res.cloudinary.com/wwwgoc5d/image/upload/v1785648102/Nadine_1_x6bht3.png",
  "about-studio.section7": "https://res.cloudinary.com/wwwgoc5d/video/upload/v1785067459/Home_an4fqz.mp4",
  "ballet.section1": "https://res.cloudinary.com/wwwgoc5d/video/upload/v1785159623/Dancer_points_to_content_202607271636_gwr_video_mvp_vev3ec.mp4",
  "ballet.section2": null,
  "classes.section1": "https://res.cloudinary.com/wwwgoc5d/image/upload/v1786903909/Allcentralstudioinstructors.webp",
};

async function main() {
  console.log(`Website Backgrounds seed — ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE"}\n`);

  for (const section of WEBSITE_BACKGROUND_SECTIONS) {
    const mediaUrl = CURRENT_MEDIA_URL[section.sectionKey] ?? null;
    const mediaKind = mediaUrl ? section.allowedMediaKind : null;

    if (DRY_RUN) {
      console.log(
        `  ${section.sectionKey}: would insert-if-absent (page=${section.page}, mediaUrl=${mediaUrl ?? "NULL"}, mediaKind=${mediaKind ?? "NULL"})`,
      );
      continue;
    }

    const result = await db.execute(sql`
      INSERT INTO "website_background_settings"
        ("section_key", "page", "section_label", "media_url", "media_kind", "version")
      VALUES
        (${section.sectionKey}, ${section.page}, ${section.sectionLabel}, ${mediaUrl}, ${mediaKind}, 1)
      ON CONFLICT ("section_key") DO NOTHING
      RETURNING "id"
    `);

    if (result.rows.length > 0) {
      console.log(`  ${section.sectionKey}: inserted`);
    } else {
      console.log(`  ${section.sectionKey}: already exists — left untouched`);
    }
  }

  console.log(`\n${DRY_RUN ? "Dry run complete." : "Seed complete."}`);
}

main()
  .catch((err) => {
    console.error("Website Backgrounds seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
