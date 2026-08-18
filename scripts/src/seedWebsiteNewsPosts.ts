/**
 * Website CMS Wave 2 — seed the 6 existing News posts into website_news_posts.
 *
 * SEPARATE, controlled step from migration 0110_website_news_posts (schema
 * only, no data) — per the locked Wave 2 seed strategy, schema creation and
 * content seeding are never mixed into one migration.
 *
 * Idempotent: uses `ON CONFLICT ("slug") DO NOTHING`, so re-running this
 * script never duplicates a row and never overwrites a row an administrator
 * has since edited through the Admin UI. There is no UPDATE anywhere in
 * this script.
 *
 * SOURCE OF TRUTH: every field below is copied byte-for-byte from the
 * website repo's lib/articlesData.ts (the Wave 0 canonical News source,
 * re-read fresh for this seed — not from memory/paraphrase). The 4
 * Performance entries in that file are NOT seeded here (Performance has no
 * CMS table in Wave 2) — they are referenced only to resolve each News
 * post's `relatedArticleIds` into a type-tagged { type, slug } pointer, per
 * the locked cross-type related-content representation.
 *
 * `excerpt` is left NULL for all 6 rows: in the current site,
 * app/news/page.tsx derives its listing "excerpt" as `a.subtitle` verbatim
 * (Wave 0 finding) — there is no distinct excerpt value to preserve, so the
 * presentation-layer subtitle fallback (see websiteNewsPosts.ts) reproduces
 * today's exact output without inventing a duplicate value here.
 *
 * `published_at` is a hand-verified sortable timestamp for each post's exact
 * `published_date` display string — never derived by parsing that string in
 * code (see the schema doc comment for why).
 *
 * Usage:
 *   DATABASE_URL=postgres://... pnpm --filter @workspace/scripts run seed-website-news
 *   DATABASE_URL=postgres://... pnpm --filter @workspace/scripts run seed-website-news -- --dry-run
 */
import { db, pool, websiteNewsPostsTable } from "@workspace/db";

const DRY_RUN = process.argv.includes("--dry-run");

type RelatedRef = { type: "news" | "performance"; slug: string };

// The 4 Performance ids from lib/articlesData.ts — used only to classify
// each relatedArticleIds entry as 'news' or 'performance'. Not seeded as
// rows anywhere (Performance has no CMS table in Wave 2).
const PERFORMANCE_SLUGS = new Set([
  "nutcracker-repertoire",
  "spring-showcase",
  "yagp-2027",
  "summer-showcase",
]);

function toRelatedRefs(ids: string[]): RelatedRef[] {
  return ids.map((id) => ({
    type: PERFORMANCE_SLUGS.has(id) ? "performance" : "news",
    slug: id,
  }));
}

interface SeedPost {
  slug: string;
  category: string;
  categoryLabel: string;
  title: string;
  subtitle: string;
  heroImageUrl: string;
  listingImageUrl: string | null;
  publishedDate: string;
  publishedAt: string;
  readTime: string | null;
  isFeatured: boolean;
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
  relatedRefs: RelatedRef[];
}

const SEED_POSTS: SeedPost[] = [
  {
    slug: "news-1",
    category: "awards",
    categoryLabel: "Competition & Awards",
    title: "Central Studio Dancers Sweep Top Honors at Youth America Grand Prix (YAGP) Finals",
    subtitle:
      "Three senior conservatory students received full classical ballet scholarships to Paris Opera Ballet School and Royal Ballet Academy following outstanding solo performances.",
    heroImageUrl: "https://images.unsplash.com/photo-1547153760-18fc86324498?auto=format&fit=crop&q=80&w=1200",
    listingImageUrl: "https://images.unsplash.com/photo-1547153760-18fc86324498?auto=format&fit=crop&q=80&w=1200",
    publishedDate: "July 18, 2026",
    publishedAt: "2026-07-18T00:00:00.000Z",
    readTime: "4 min read",
    isFeatured: true,
    authorName: "Victoria Vance",
    authorRole: "Artistic Director & Master Teacher",
    authorAvatarUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=300",
    tags: ["YAGP", "Classical Ballet", "Scholarships", "Conservatory", "Gala"],
    galleryImages: [
      "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?auto=format&fit=crop&q=80&w=800",
      "https://images.unsplash.com/photo-1516475429286-465d815a0df7?auto=format&fit=crop&q=80&w=800",
      "https://images.unsplash.com/photo-1508807526345-15e9b5f4eaff?auto=format&fit=crop&q=80&w=800",
    ],
    content: {
      leadParagraph:
        "In an unforgettable display of precision, technical stamina, and expressive depth, Central Studio Pre-Professional division dancers triumphed at the 2026 Youth America Grand Prix (YAGP) International Finals held at Lincoln Center in New York City.",
      sections: [
        {
          heading: "Historical Triumph on the International Stage",
          paragraphs: [
            "Over 12,000 dancers worldwide competed in regional qualifiers throughout the year, with fewer than 300 reaching the prestigious final rounds. Central Studio sent four senior soloists, each delivering compelling classical variations and contemporary solos.",
            "Seventeen-year-old Clara Dupont secured the Grand Prix Award in the Senior Classical Division, performing her breathtaking variation from Raymonda Act III, followed by an emotionally resonant contemporary work choreographed by resident faculty member Jean-Luc Moreau.",
          ],
          quote: {
            text:
              "Seeing our dancers command the stage with such artistic poise and effortless physical control validates every hour spent in the studio. They didn't just dance steps—they communicated true soul.",
            author: "Victoria Vance",
            role: "Artistic Director, Central Studio",
          },
        },
        {
          heading: "Prestigious Scholarships & Company Offers",
          paragraphs: [
            "Following the final awards ceremony, representatives from leading global institutions extended full merit scholarships and apprentice offers to Central Studio dancers:",
          ],
          bulletPoints: [
            "Clara Dupont: Full Year Scholarship to Paris Opera Ballet School & Direct Company Trainee invitation.",
            "Julian Thorne: Full Scholarship to Royal Ballet Upper School, London.",
            "Aria Chen: Junior Division Silver Medal & Summer Intensive Grant to San Francisco Ballet School.",
            "Marcus Vance: Contemporary Soloist Special Jury Commendation.",
          ],
          image: "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?auto=format&fit=crop&q=80&w=1000",
          imageCaption: "Clara Dupont during her winning classical solo performance at Lincoln Center.",
        },
        {
          heading: "The Preparation Behind the Victory",
          paragraphs: [
            "Preparation for YAGP began ten months prior under the meticulous guidance of Central Studio’s elite faculty. Dancers underwent rigorous daily pointe work, custom biomechanical strength conditioning, and video playback analysis to refine line alignment and musical cadence.",
            "Central Studio continues its commitment to training versatile, healthy, and expressive classical artists prepared for top-tier professional careers worldwide.",
          ],
        },
      ],
    },
    relatedRefs: toRelatedRefs(["news-6", "nutcracker-repertoire", "news-3"]),
  },
  {
    slug: "news-2",
    category: "auditions",
    categoryLabel: "Auditions & Masterclasses",
    title: "Announcing 2026/2027 Season Conservatory Audition Dates & Criteria",
    subtitle:
      "Registration is now open for prospective students seeking entry into Primary, Junior, Senior, and Pre-Professional intensive training divisions.",
    heroImageUrl: "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?auto=format&fit=crop&q=80&w=1200",
    listingImageUrl: "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?auto=format&fit=crop&q=80&w=800",
    publishedDate: "July 05, 2026",
    publishedAt: "2026-07-05T00:00:00.000Z",
    readTime: "3 min read",
    isFeatured: false,
    authorName: "Central Studio Admissions",
    authorRole: "Conservatory Administration",
    authorAvatarUrl: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&q=80&w=300",
    tags: ["Auditions", "Conservatory", "Admissions", "Ballet Training", "Youth Division"],
    galleryImages: [],
    content: {
      leadParagraph:
        "Central Studio announces national audition dates for the upcoming 2026/2027 academic conservatory year. Applications are now live for dancers aged 7 through 20 seeking placement in our acclaimed classical ballet and contemporary tracks.",
      sections: [
        {
          heading: "Audition Schedule & Locations",
          paragraphs: [
            "Auditions will be conducted both in-person at Central Studio Main Campus and virtually via video submission for international applicants unable to travel.",
            "Candidates will participate in a structured 90-minute ballet class including barre work, center combinations, allegro, pointe (for qualified levels), and a brief physical flexibility assessment.",
          ],
          bulletPoints: [
            "In-Person Main Campus Audition 1: Saturday, August 15, 2026 (Ages 7–12: 10:00 AM | Ages 13–20: 1:00 PM)",
            "In-Person Main Campus Audition 2: Sunday, September 06, 2026 (Ages 7–12: 10:00 AM | Ages 13–20: 1:00 PM)",
            "Video Submission Deadline: Midnight EST, September 10, 2026",
          ],
        },
        {
          heading: "Evaluation Criteria",
          paragraphs: [
            "Our faculty evaluates applicants holistically. Key parameters evaluated include musicality, physical turn-out and posture, coordination, dedication, and artistic presence rather than prior technical perfection alone.",
          ],
          quote: {
            text: "We look for potential, passion, and teachability. Our curriculum is designed to transform raw talent into world-class technique.",
            author: "Elena Rostova",
            role: "Guest Principal Instructor",
          },
        },
      ],
    },
    relatedRefs: toRelatedRefs(["news-3", "news-1", "summer-showcase"]),
  },
  {
    slug: "news-3",
    category: "events",
    categoryLabel: "Studio Events",
    title: "Guest Masterclass Series: Principal Dancer Elena Rostova Joins Faculty",
    subtitle:
      "World-renowned ballerina Elena Rostova conducts an exclusive 3-day pointe variation and partnerwork workshop at our Grand Stage Studio.",
    heroImageUrl: "https://images.unsplash.com/photo-1516475429286-465d815a0df7?auto=format&fit=crop&q=80&w=1200",
    listingImageUrl: "https://images.unsplash.com/photo-1516475429286-465d815a0df7?auto=format&fit=crop&q=80&w=800",
    publishedDate: "June 22, 2026",
    publishedAt: "2026-06-22T00:00:00.000Z",
    readTime: "5 min read",
    isFeatured: false,
    authorName: "Editorial Team",
    authorRole: "Central Studio Journal",
    authorAvatarUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=300",
    tags: ["Masterclass", "Elena Rostova", "Pointe Work", "Partnerwork", "Faculty"],
    galleryImages: [],
    content: {
      leadParagraph:
        "Central Studio is thrilled to welcome former Mariinsky and Royal Ballet Guest Principal Elena Rostova for an intensive 3-day masterclass workshop dedicated to advanced classical repertoire, delicate pointe control, and partnerwork dynamics.",
      sections: [
        {
          heading: "An Unrivaled Educational Opportunity",
          paragraphs: [
            "Elena Rostova, celebrated globally for her iconic portrayals of Odette/Odile and Giselle, brings four decades of onstage experience to our conservatory students.",
            "During the intensive session, students in Levels 03, 04, and Pre-Professional divisions will dissect classical variations from Swan Lake, Don Quixote, and La Bayadère.",
          ],
        },
      ],
    },
    relatedRefs: toRelatedRefs(["spring-showcase", "news-1", "news-2"]),
  },
  {
    slug: "news-4",
    category: "press",
    categoryLabel: "Press & Media",
    title: "Dance International Magazine Features Central Studio Sprung Floor Technology",
    subtitle:
      "An in-depth look at how climate-controlled studios and acoustic resonance floors prevent injury and prolong professional dancer careers.",
    heroImageUrl: "https://images.unsplash.com/photo-1508807526345-15e9b5f4eaff?auto=format&fit=crop&q=80&w=1200",
    listingImageUrl: "https://images.unsplash.com/photo-1508807526345-15e9b5f4eaff?auto=format&fit=crop&q=80&w=800",
    publishedDate: "June 10, 2026",
    publishedAt: "2026-06-10T00:00:00.000Z",
    readTime: "6 min read",
    isFeatured: false,
    authorName: "Dance International Press",
    authorRole: "Feature Article",
    authorAvatarUrl: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&q=80&w=300",
    tags: ["Press", "Injury Prevention", "Studio Tech", "Sprung Floor", "Dance Science"],
    galleryImages: [],
    content: {
      leadParagraph:
        "In its June 2026 edition, Dance International Magazine published an extensive spotlight on Central Studio’s state-of-the-art facility engineering, highlighting how custom pneumatic sprung flooring and micro-climate airflow reduce joint fatigue by up to 42%.",
      sections: [
        {
          heading: "Redefining Safety in Ballet Infrastructure",
          paragraphs: [
            "High-impact jumps and repetitive pointe work exert forces up to four times a dancer’s body weight onto studio floors. Central Studio’s 7-layer hardwood sprung floor system absorbs kinetic shock while returning natural rebound resilience.",
          ],
        },
      ],
    },
    relatedRefs: toRelatedRefs(["news-1", "news-5", "news-2"]),
  },
  {
    slug: "news-5",
    category: "events",
    categoryLabel: "Studio Events",
    title: "Annual Winter Nutcracker Production Ticket Sales Open to Public",
    subtitle:
      "Reserve priority seating for our hallmark December production at Central Opera House featuring over 80 conservatory dancers and live orchestral score.",
    heroImageUrl: "https://images.unsplash.com/photo-1460723237483-7a6dc9d0b212?auto=format&fit=crop&q=80&w=1200",
    listingImageUrl: "https://images.unsplash.com/photo-1460723237483-7a6dc9d0b212?auto=format&fit=crop&q=80&w=800",
    publishedDate: "May 28, 2026",
    publishedAt: "2026-05-28T00:00:00.000Z",
    readTime: "2 min read",
    isFeatured: false,
    authorName: "Box Office Central",
    authorRole: "Production Team",
    authorAvatarUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=300",
    tags: ["Nutcracker", "Tickets", "Central Opera House", "Stage Production", "Winter Gala"],
    galleryImages: [],
    content: {
      leadParagraph:
        "Tickets for Central Studio’s highly anticipated December 2026 production of Tchaikovsky’s The Nutcracker are now officially on sale. Featuring live orchestral accompaniment and over 80 student artists across six studio levels.",
      sections: [
        {
          heading: "Showtimes & Box Office Information",
          paragraphs: [
            "Performances run from December 18 to December 22, 2026 at the historic Central Opera House. Early bird ticket discounts are available for conservatory families and alumni through August 31.",
          ],
        },
      ],
    },
    relatedRefs: toRelatedRefs(["nutcracker-repertoire", "news-1", "spring-showcase"]),
  },
  {
    slug: "news-6",
    category: "awards",
    categoryLabel: "Competition & Awards",
    title: "Pre-Pro Soloist Wins Gold Medal at Lausanne International Ballet Competition",
    subtitle:
      "Celebrating Marcus Vance for his gold-medal winning variation in contemporary and classical divisions in Lausanne, Switzerland.",
    heroImageUrl: "https://images.unsplash.com/photo-1516475429286-465d815a0df7?auto=format&fit=crop&q=80&w=1200",
    listingImageUrl: "https://images.unsplash.com/photo-1516475429286-465d815a0df7?auto=format&fit=crop&q=80&w=800",
    publishedDate: "May 14, 2026",
    publishedAt: "2026-05-14T00:00:00.000Z",
    readTime: "4 min read",
    isFeatured: false,
    authorName: "Victoria Vance",
    authorRole: "Artistic Director",
    authorAvatarUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=300",
    tags: ["Prix de Lausanne", "Gold Medal", "Marcus Vance", "Soloist", "Ballet Award"],
    galleryImages: [],
    content: {
      leadParagraph:
        "Eighteen-year-old Marcus Vance has been awarded the prestigious Gold Medal at the 2026 Prix de Lausanne in Switzerland, earning international accolades and praise from premier company directors across Europe and North America.",
      sections: [
        {
          heading: "A Masterclass in Virtuosity and Grace",
          paragraphs: [
            "Performing the Prince Desire variation from Sleeping Beauty and an edgy modern solo choreographed specifically for his artistic temperament, Vance captured highest scores across all technical and artistic rubrics.",
          ],
        },
      ],
    },
    relatedRefs: toRelatedRefs(["news-1", "yagp-2027", "news-3"]),
  },
];

async function main() {
  console.log(`Website News seed — ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE"}\n`);

  for (const post of SEED_POSTS) {
    if (DRY_RUN) {
      console.log(`  ${post.slug}: would insert-if-absent (title="${post.title}")`);
      continue;
    }

    // Uses the schema-aware insert builder (not a raw sql`` template) —
    // drizzle's sql`` tag spreads JS array VALUES into comma-separated
    // params (IN-clause-style expansion) rather than binding them as a
    // single Postgres array parameter, which corrupted the `tags` /
    // `galleryImages` text[] columns when this was first tried as a raw
    // INSERT. .values() serializes array- and jsonb-typed columns
    // correctly, matching the pattern used throughout websiteNews.ts.
    const result = await db
      .insert(websiteNewsPostsTable)
      .values({
        slug: post.slug,
        category: post.category,
        categoryLabel: post.categoryLabel,
        title: post.title,
        subtitle: post.subtitle,
        excerpt: null,
        heroImageUrl: post.heroImageUrl,
        listingImageUrl: post.listingImageUrl,
        publishedDate: post.publishedDate,
        publishedAt: post.publishedAt,
        readTime: post.readTime,
        isFeatured: post.isFeatured,
        authorName: post.authorName,
        authorRole: post.authorRole,
        authorAvatarUrl: post.authorAvatarUrl,
        tags: post.tags,
        galleryImages: post.galleryImages,
        content: post.content,
        relatedRefs: post.relatedRefs,
        isActive: true,
      })
      .onConflictDoNothing({ target: websiteNewsPostsTable.slug })
      .returning({ id: websiteNewsPostsTable.id });

    if (result.length > 0) {
      console.log(`  ${post.slug}: inserted`);
    } else {
      console.log(`  ${post.slug}: already exists — left untouched`);
    }
  }

  console.log(`\n${DRY_RUN ? "Dry run complete." : "Seed complete."}`);
}

main()
  .catch((err) => {
    console.error("Website News seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
