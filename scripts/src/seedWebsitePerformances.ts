/**
 * Website CMS Wave 3 — seed the 4 existing Performance entries into
 * website_performances.
 *
 * SEPARATE, controlled step from migration 0111_website_performances
 * (schema only, no data) — per the locked Wave 3 seed strategy, schema
 * creation and content seeding are never mixed into one migration.
 *
 * Uses the schema-aware `db.insert(...).values(...).onConflictDoNothing()`
 * builder (never a raw `sql` template) — Wave 2's News seed discovered that
 * drizzle's `sql` tag spreads JS array values into comma-separated params
 * (IN-clause-style expansion) instead of binding a single Postgres array
 * parameter, corrupting `text[]` columns. The insert builder serializes
 * array- and jsonb-typed columns correctly.
 *
 * SOURCE OF TRUTH: every field below is copied byte-for-byte from the
 * website repo's lib/articlesData.ts (re-read fresh for this seed, not
 * from memory or the Wave 3 investigation report's paraphrased tables).
 *
 * LOCKED: this is a CMS/data-source migration, NOT a content-correction
 * project. Existing card/detail differences are preserved exactly,
 * including YAGP's — its card dates ("March 12 – 15, 2027"), card badge
 * ("SOLOIST TRACK"), card venue ("Regional & NY Finals"), and detail values
 * (dates "February & March 2027", badge "SOLOIST COMPETITION", venue
 * "Regional Semifinals & NYC International Finals") are NOT reconciled to
 * agree with each other. The content owner can correct either value later
 * through the CMS — this seed script must not guess which is "correct."
 *
 * sortOrder is seeded 1-4 in the exact order lib/articlesData.ts's 4
 * Performance entries currently appear (nutcracker/spring/yagp/summer) —
 * this is the order the current public repertoire cards render in, and no
 * eventStartDate exists to derive an order from (locked decision — see the
 * Wave 3 investigation report's Date Model section).
 *
 * badgeVariant is a closed enum (cyan/purple/gold). Gold's two source hex
 * shades (card `amber-500` = #F59E0B, detail `#FFB81C`) are NOT normalized
 * to one value here — both are preserved via context-specific class-string
 * mapping in the website's rendering layer (lib/performanceBadgeVariants.ts),
 * keyed off this same `badgeVariant` value.
 *
 * featuredHeroImageUrl / featuredHeroDateBadge are populated ONLY for
 * nutcracker-repertoire (the currently-featured entry, whose landingHero
 * data these fields preserve verbatim — including the exact historical
 * 1920w image URL, never derived from heroImageUrl's 1200w URL at runtime).
 * Both are null for the other 3 entries.
 *
 * Usage:
 *   DATABASE_URL=postgres://... pnpm --filter @workspace/scripts run seed-website-performances
 *   DATABASE_URL=postgres://... pnpm --filter @workspace/scripts run seed-website-performances -- --dry-run
 */
import { db, pool, websitePerformancesTable } from "@workspace/db";

const DRY_RUN = process.argv.includes("--dry-run");

type RelatedRef = { type: "news" | "performance"; slug: string };

interface SeedPerformance {
  slug: string;
  sortOrder: number;
  category: string;
  categoryLabel: string;
  title: string;
  subtitle: string;
  heroImageUrl: string;
  eventDateDisplay: string;
  season: string;
  featuredHeroImageUrl: string | null;
  featuredHeroDateBadge: string | null;
  isFeatured: boolean;
  cardTitle: string;
  cardDescription: string;
  cardImageUrl: string;
  cardVenue: string;
  cardDatesDisplay: string;
  cardTime: string;
  dateDay: string;
  dateMonth: string;
  cardBadgeLabel: string;
  venue: string;
  times: string[];
  orchestra: string | null;
  runtime: string;
  ticketLink: string | null;
  ticketPriceRange: string | null;
  detailBadgeLabel: string;
  badgeVariant: "cyan" | "purple" | "gold";
  authorName: string;
  authorRole: string;
  authorAvatarUrl: string | null;
  tags: string[];
  galleryImages: string[];
  content: {
    leadParagraph: string;
    sections: Array<{
      heading?: string;
      paragraphs: string[];
      quote?: { text: string; author: string; role: string };
      bulletPoints?: string[];
      image?: string;
      imageCaption?: string;
    }>;
  };
  keyHighlights: string[];
  scheduleOverview: Array<{ time: string; event: string }>;
  castAndFaculty: Array<{ name: string; role: string; imageUrl: string }>;
  relatedRefs: RelatedRef[];
}

const SEED_PERFORMANCES: SeedPerformance[] = [
  {
    slug: "nutcracker-repertoire",
    sortOrder: 1,
    category: "performance",
    categoryLabel: "Stage Repertoire",
    title: "The Nutcracker Repertoire at Central Opera House",
    subtitle:
      "A beloved annual hallmark tradition involving all student levels from Primary Angels to Senior Sugar Plum Fairy solos, performed with a live 40-piece symphony orchestra.",
    heroImageUrl: "https://images.unsplash.com/photo-1516475429286-465d815a0df7?auto=format&fit=crop&q=80&w=1200",
    eventDateDisplay: "December 18 – 22, 2026",
    season: "WINTER STAGE PRODUCTION",
    // landingHero — preserved verbatim, the exact historical 1920w URL and date-badge text.
    featuredHeroImageUrl: "https://images.unsplash.com/photo-1516475429286-465d815a0df7?auto=format&fit=crop&q=80&w=1920",
    featuredHeroDateBadge: "DEC 18 – 22, 2026",
    isFeatured: true,
    cardTitle: "The Nutcracker Repertoire",
    cardDescription:
      "A beloved annual tradition involving all student levels from Primary Angels to Senior solos with a live symphony orchestra.",
    cardImageUrl: "https://images.unsplash.com/photo-1547153760-18fc86324498?auto=format&fit=crop&w=800&q=80",
    cardVenue: "Central Opera House",
    cardDatesDisplay: "December 18 – 22, 2026",
    cardTime: "7:00 PM - 9:30 PM",
    dateDay: "18",
    dateMonth: "DEC",
    cardBadgeLabel: "ALL LEVELS",
    venue: "Central Opera House & Grand Stage",
    times: ["Matinee: 2:00 PM", "Evening: 7:30 PM"],
    orchestra: "Central Philharmonic Orchestra (40-Piece Live Score)",
    runtime: "2 Hours (Includes 20-minute Intermission)",
    ticketLink: "/contact",
    ticketPriceRange: "$35 – $120",
    detailBadgeLabel: "ALL LEVELS PARTICIPATE",
    badgeVariant: "cyan",
    authorName: "Jean-Luc Moreau",
    authorRole: "Resident Choreographer & Stage Director",
    authorAvatarUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=300",
    tags: ["Nutcracker", "Live Orchestra", "Stage Production", "Winter Gala", "Opera House"],
    galleryImages: [
      "https://images.unsplash.com/photo-1460723237483-7a6dc9d0b212?auto=format&fit=crop&q=80&w=800",
      "https://images.unsplash.com/photo-1547153760-18fc86324498?auto=format&fit=crop&q=80&w=800",
      "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?auto=format&fit=crop&q=80&w=800",
      "https://images.unsplash.com/photo-1508807526345-15e9b5f4eaff?auto=format&fit=crop&q=80&w=800",
    ],
    content: {
      leadParagraph:
        "Central Studio’s annual production of The Nutcracker is the cornerstone of our stage performance curriculum. Uniting all divisions from our 7-year-old Primary Angels to our Pre-Professional corps de ballet, the production offers students immersive theatrical experience under professional stage conditions.",
      sections: [
        {
          heading: "Synopsis & Production Overview",
          paragraphs: [
            "Set on Christmas Eve in 19th-century Vienna, young Clara receives a enchanted wooden nutcracker from her mysterious godfather, Herr Drosselmeyer. As night falls, the parlor transforms into a grand battleground between the Mouse King and the valiant Nutcracker Prince.",
            "In Act II, Clara journeys through the Enchanted Forest of Snow to the Land of Sweets, where the Sugar Plum Fairy celebrates Clara’s bravery with dances from around the world—Spanish Chocolate, Arabian Coffee, Chinese Tea, Russian Trepak, and the iconic Waltz of the Flowers.",
          ],
          quote: {
            text: "Performing with a live symphony orchestra at Central Opera House elevates student technique into pure magic. The discipline gained during Nutcracker rehearsals shapes their artistry forever.",
            author: "Jean-Luc Moreau",
            role: "Stage Director",
          },
        },
        {
          heading: "Costume & Scenic Design Excellence",
          paragraphs: [
            "Every costume in our Nutcracker repertoire is hand-crafted in our resident costume atelier using silk tulles, hand-sewn Swarovski crystals, and period velvet doublets.",
            "The production features an expansive 30-foot growing Christmas tree, mechanical theatrical rigging, and state-of-the-art atmospheric lighting designed by Broadway lighting veteran Robert Sterling.",
          ],
        },
      ],
    },
    keyHighlights: [
      "Live 40-piece symphony orchestra conducting Tchaikovsky’s original score",
      "Over 80 handmade period costumes styled in Paris",
      "Custom scenic projections and magical snow fall effect",
      "Principal guest artists dancing Cavalier and Sugar Plum solos",
    ],
    scheduleOverview: [
      { time: "Dec 18 - 7:30 PM", event: "Opening Night Gala & Red Carpet Reception" },
      { time: "Dec 19 - 2:00 PM", event: "Family Matinee Performance" },
      { time: "Dec 19 - 7:30 PM", event: "Evening Performance" },
      { time: "Dec 20 - 2:00 PM", event: "Sunday Afternoon Special Matinee" },
      { time: "Dec 22 - 7:30 PM", event: "Closing Night Feature" },
    ],
    castAndFaculty: [
      { name: "Elena Rostova", role: "Guest Principal (Sugar Plum Fairy)", imageUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=300" },
      { name: "Marcus Vance", role: "Cavalier Prince", imageUrl: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=300" },
      { name: "Clara Dupont", role: "Clara Stahlbaum", imageUrl: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=300" },
      { name: "Jean-Luc Moreau", role: "Stage Director & Herr Drosselmeyer", imageUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=300" },
    ],
    relatedRefs: [
      { type: "performance", slug: "spring-showcase" },
      { type: "news", slug: "news-5" },
      { type: "news", slug: "news-1" },
    ],
  },
  {
    slug: "spring-showcase",
    sortOrder: 2,
    category: "performance",
    categoryLabel: "Stage Repertoire",
    title: "Spring Choreographic Showcase & Gala",
    subtitle:
      "Highlighting classical variations from Swan Lake, Don Quixote, and Sleeping Beauty alongside brand-new contemporary works commissioned by resident choreographers.",
    heroImageUrl: "https://images.unsplash.com/photo-1547153760-18fc86324498?auto=format&fit=crop&q=80&w=1200",
    eventDateDisplay: "April 24 – 26, 2027",
    season: "CONTEMPORARY & CLASSICAL GALA",
    featuredHeroImageUrl: null,
    featuredHeroDateBadge: null,
    isFeatured: false,
    cardTitle: "Spring Choreographic Showcase",
    cardDescription: "Highlighting classical variations from Swan Lake and Don Quixote alongside brand-new contemporary works.",
    cardImageUrl: "https://images.unsplash.com/photo-1518834107812-67b0b7c58434?auto=format&fit=crop&w=800&q=80",
    cardVenue: "Metropolitan Arts Center",
    cardDatesDisplay: "April 24 – 26, 2027",
    cardTime: "6:30 PM - 9:00 PM",
    dateDay: "24",
    dateMonth: "APR",
    cardBadgeLabel: "LEVELS 02 – PRE-PRO",
    venue: "Metropolitan Arts Center",
    times: ["Friday Evening: 8:00 PM", "Saturday Evening: 7:30 PM", "Sunday Matinee: 2:30 PM"],
    orchestra: "Recorded Classical & Original Electronic Ambient Scores",
    runtime: "1 Hour 45 Minutes",
    ticketLink: "/contact",
    ticketPriceRange: "$25 – $85",
    detailBadgeLabel: "LEVELS 02 – PRE-PRO",
    badgeVariant: "purple",
    authorName: "Victoria Vance",
    authorRole: "Artistic Director",
    authorAvatarUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=300",
    tags: ["Spring Gala", "Swan Lake", "Contemporary", "Choreography", "Metropolitan Arts"],
    galleryImages: [
      "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?auto=format&fit=crop&q=80&w=800",
      "https://images.unsplash.com/photo-1516475429286-465d815a0df7?auto=format&fit=crop&q=80&w=800",
    ],
    content: {
      leadParagraph:
        "The Spring Choreographic Showcase bridges timeless classical heritage with cutting-edge 21st-century movement. Designed to challenge senior conservatory dancers in both pristine classical technique and fluid contemporary expression.",
      sections: [
        {
          heading: "Program Architecture",
          paragraphs: [
            "Act I presents beloved classical repertoire including the Black Swan Pas de Deux, Grand Pas de Deux from Don Quixote, and the Garland Waltz from Sleeping Beauty.",
            "Act II premieres original neoclassical and contemporary works commissioned specifically for Central Studio dancers, exploring themes of resilience, architectural space, and acoustic rhythm.",
          ],
        },
      ],
    },
    keyHighlights: [
      "Petipa Act III classical excerpts from Swan Lake & Don Quixote",
      "World premiere contemporary piece \"Resonance\" by Jean-Luc Moreau",
      "Live piano accompaniment for classical variation solos",
    ],
    scheduleOverview: [],
    castAndFaculty: [],
    relatedRefs: [
      { type: "performance", slug: "nutcracker-repertoire" },
      { type: "news", slug: "news-3" },
      { type: "performance", slug: "yagp-2027" },
    ],
  },
  {
    // LOCKED: preserve YAGP's card/detail drift exactly. Do NOT reconcile
    // dates, badge, or venue between card and detail — see module doc
    // comment and the Wave 3 investigation report's YAGP section.
    slug: "yagp-2027",
    sortOrder: 3,
    category: "performance",
    categoryLabel: "Stage Repertoire",
    title: "Youth America Grand Prix (YAGP) Competition Track",
    subtitle:
      "Targeted coaching for qualifying Senior and Pre-Pro dancers competing for international conservatory scholarships and ballet company apprenticeships.",
    heroImageUrl: "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?auto=format&fit=crop&q=80&w=1200",
    eventDateDisplay: "February & March 2027",
    season: "INTERNATIONAL COMPETITION TRACK",
    featuredHeroImageUrl: null,
    featuredHeroDateBadge: null,
    isFeatured: false,
    cardTitle: "Youth America Grand Prix (YAGP)",
    cardDescription: "Targeted coaching for Senior and Pre-Pro dancers competing for international conservatory scholarships.",
    cardImageUrl: "https://images.unsplash.com/photo-1508807526345-15e9b5f4eaff?auto=format&fit=crop&w=800&q=80",
    cardVenue: "Regional & NY Finals",
    cardDatesDisplay: "March 12 – 15, 2027",
    cardTime: "9:00 AM - 6:00 PM",
    dateDay: "12",
    dateMonth: "MAR",
    cardBadgeLabel: "SOLOIST TRACK",
    venue: "Regional Semifinals & NYC International Finals",
    times: [],
    orchestra: null,
    runtime: "Multi-Day Semi-Finals & Gala",
    ticketLink: null,
    ticketPriceRange: null,
    detailBadgeLabel: "SOLOIST COMPETITION",
    badgeVariant: "gold",
    authorName: "Central Studio Coaching Staff",
    authorRole: "Competition Division",
    authorAvatarUrl: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=300",
    tags: ["YAGP", "Competition", "Soloists", "Scholarships", "Coaching"],
    galleryImages: [],
    content: {
      leadParagraph:
        "Central Studio’s YAGP Competition Track provides elite soloists with individualized technical refinement, costume customization, and psychological performance conditioning for international stage success.",
      sections: [
        {
          heading: "Intensive Private Coaching Curriculum",
          paragraphs: [
            "Dancers selected for YAGP receive weekly dedicated solo coaching outside standard group classes. Focus areas include artistic phrasing, pointe stability, pirouette accuracy, and stage projection.",
          ],
        },
      ],
    },
    keyHighlights: [
      "One-on-one private variation coaching with former principal dancers",
      "Custom variation staging matched to individual dancer physical strengths",
      "Mock jury dress rehearsals with guest international adjudicators",
    ],
    scheduleOverview: [],
    castAndFaculty: [],
    relatedRefs: [
      { type: "news", slug: "news-1" },
      { type: "news", slug: "news-6" },
      { type: "performance", slug: "spring-showcase" },
    ],
  },
  {
    slug: "summer-showcase",
    sortOrder: 4,
    category: "performance",
    categoryLabel: "Stage Repertoire",
    title: "Summer Conservatory Showcase & Finale",
    subtitle:
      "An intimate studio performance presenting the culmination of our 4-week summer intensive featuring guest international faculty repertoire.",
    heroImageUrl: "https://images.unsplash.com/photo-1508807526345-15e9b5f4eaff?auto=format&fit=crop&q=80&w=1200",
    eventDateDisplay: "August 08, 2027",
    season: "INTENSIVE FINALE PERFORMANCE",
    featuredHeroImageUrl: null,
    featuredHeroDateBadge: null,
    isFeatured: false,
    cardTitle: "Summer Conservatory Showcase",
    cardDescription: "An intimate studio performance presenting the culmination of our 4-week summer intensive featuring international guest faculty.",
    cardImageUrl: "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?auto=format&fit=crop&w=800&q=80",
    cardVenue: "Central Studio Grand Hall",
    cardDatesDisplay: "August 08, 2027",
    cardTime: "5:00 PM - 7:30 PM",
    dateDay: "08",
    dateMonth: "AUG",
    cardBadgeLabel: "SUMMER INTENSIVE",
    venue: "Central Studio Grand Hall",
    times: ["1:00 PM & 5:00 PM"],
    orchestra: null,
    runtime: "1 Hour 15 Minutes",
    ticketLink: null,
    ticketPriceRange: null,
    detailBadgeLabel: "SUMMER INTENSIVE PARTICIPANTS",
    badgeVariant: "cyan",
    authorName: "Conservatory Faculty",
    authorRole: "Summer Intensive Directors",
    authorAvatarUrl: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&q=80&w=300",
    tags: ["Summer Intensive", "Showcase", "Studio Performance", "Guest Faculty"],
    galleryImages: [],
    content: {
      leadParagraph:
        "The Summer Conservatory Showcase marks the energetic finale of our summer intensive program. Families and patrons are invited into our flagship studio hall to witness rapid technical acceleration and artistic growth.",
      sections: [
        {
          heading: "Celebration of Growth",
          paragraphs: [
            "Featuring pieces created by guest choreographers over four intensive weeks of training, this intimate showcase highlights the stamina, versatility, and passion of rising young artists.",
          ],
        },
      ],
    },
    keyHighlights: [
      "Presentation of works staged during 4-week summer intensive",
      "Demonstrations of character dance, partnerwork, and contemporary improv",
      "Diploma presentation ceremony for completing conservatory students",
    ],
    scheduleOverview: [],
    castAndFaculty: [],
    relatedRefs: [
      { type: "news", slug: "news-2" },
      { type: "performance", slug: "nutcracker-repertoire" },
      { type: "news", slug: "news-3" },
    ],
  },
];

async function main() {
  console.log(`Website Performances seed — ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE"}\n`);

  for (const perf of SEED_PERFORMANCES) {
    if (DRY_RUN) {
      console.log(`  ${perf.slug}: would insert-if-absent (sortOrder=${perf.sortOrder}, title="${perf.title}")`);
      continue;
    }

    const result = await db
      .insert(websitePerformancesTable)
      .values({
        slug: perf.slug,
        sortOrder: perf.sortOrder,
        category: perf.category,
        categoryLabel: perf.categoryLabel,
        title: perf.title,
        subtitle: perf.subtitle,
        heroImageUrl: perf.heroImageUrl,
        eventDateDisplay: perf.eventDateDisplay,
        season: perf.season,
        featuredHeroImageUrl: perf.featuredHeroImageUrl,
        featuredHeroDateBadge: perf.featuredHeroDateBadge,
        isFeatured: perf.isFeatured,
        cardTitle: perf.cardTitle,
        cardDescription: perf.cardDescription,
        cardImageUrl: perf.cardImageUrl,
        cardVenue: perf.cardVenue,
        cardDatesDisplay: perf.cardDatesDisplay,
        cardTime: perf.cardTime,
        dateDay: perf.dateDay,
        dateMonth: perf.dateMonth,
        cardBadgeLabel: perf.cardBadgeLabel,
        venue: perf.venue,
        times: perf.times,
        orchestra: perf.orchestra,
        runtime: perf.runtime,
        ticketLink: perf.ticketLink,
        ticketPriceRange: perf.ticketPriceRange,
        detailBadgeLabel: perf.detailBadgeLabel,
        badgeVariant: perf.badgeVariant,
        authorName: perf.authorName,
        authorRole: perf.authorRole,
        authorAvatarUrl: perf.authorAvatarUrl,
        tags: perf.tags,
        galleryImages: perf.galleryImages,
        content: perf.content,
        keyHighlights: perf.keyHighlights,
        scheduleOverview: perf.scheduleOverview,
        castAndFaculty: perf.castAndFaculty,
        relatedRefs: perf.relatedRefs,
        isActive: true,
      })
      .onConflictDoNothing({ target: websitePerformancesTable.slug })
      .returning({ id: websitePerformancesTable.id });

    if (result.length > 0) {
      console.log(`  ${perf.slug}: inserted`);
    } else {
      console.log(`  ${perf.slug}: already exists — left untouched`);
    }
  }

  console.log(`\n${DRY_RUN ? "Dry run complete." : "Seed complete."}`);
}

main()
  .catch((err) => {
    console.error("Website Performances seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
