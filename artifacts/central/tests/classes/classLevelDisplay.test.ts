/**
 * R1 / F-07 correction: Mobile must display and filter class skill Level
 * using the canonical stored `classes.level` field (DanceClass["level"]),
 * never a value derived from Age Group / Audience — those are separate
 * business concepts (Age Eligibility, Display Audience, Walk-in Pricing
 * Category) and must not be conflated.
 *
 * app/(tabs)/classes.tsx and app/class/[id].tsx are Expo Router screens
 * (JSX, react-native imports) that cannot be imported into a plain Node
 * test process. No RN component test harness exists in this repo for
 * screen-level logic — the established pattern for exactly this situation
 * is a source-level assertion test (see
 * artifacts/api-server/src/routes/bookingPriceBinding.test.ts). This test
 * follows that same convention.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const CLASSES_SCREEN = "artifacts/central/app/(tabs)/classes.tsx";
const CLASS_DETAIL_SCREEN = "artifacts/central/app/class/[id].tsx";

for (const path of [CLASSES_SCREEN, CLASS_DETAIL_SCREEN]) {
  test(`${path}: the age-derived deriveDifficulty() helper is gone`, () => {
    const source = read(path);
    assert.equal(
      source.includes("deriveDifficulty"),
      false,
      `${path} must not derive a skill level from ageGroup — Level and Age Group are distinct business concepts`,
    );
  });

  test(`${path}: the AgeGroup type import was removed once it became unused`, () => {
    const source = read(path);
    assert.equal(
      /\bAgeGroup\b/.test(source),
      false,
      `${path} no longer references AgeGroup after removing the age-derived level helper`,
    );
  });
}

test(`${CLASSES_SCREEN}: the badge reads the class's own stored level`, () => {
  const source = read(CLASSES_SCREEN);
  assert.match(
    source,
    /const difficulty = item\.level;/,
    "the class-card badge must read item.level directly",
  );
});

test(`${CLASSES_SCREEN}: the Level filter compares against the class's own stored level`, () => {
  const source = read(CLASSES_SCREEN);
  assert.match(
    source,
    /if \(levelFilter !== "all" && c\.level\.toLowerCase\(\) !== levelFilter\) return false;/,
    "the Level filter must compare c.level, not an age-derived value",
  );
  // Age filtering must remain completely independent and untouched.
  assert.match(
    source,
    /if \(ageFilter !== "all" && c\.ageGroup\.toLowerCase\(\) !== ageFilter\) return false;/,
    "the Age filter must still compare c.ageGroup, unchanged",
  );
});

test(`${CLASS_DETAIL_SCREEN}: the detail badge reads the class's own stored level`, () => {
  const source = read(CLASS_DETAIL_SCREEN);
  assert.match(
    source,
    /const difficulty = cls\.level;/,
    "the class-detail badge must read cls.level directly",
  );
});

test("diffColor is unchanged — this correction only changes the INPUT to the color mapping, not the mapping itself", () => {
  for (const path of [CLASSES_SCREEN, CLASS_DETAIL_SCREEN]) {
    const source = read(path);
    assert.match(
      source,
      /function diffColor\([a-zA-Z]+: string\) \{\s*return [a-zA-Z]+ === "Beginner" \? CYAN : [a-zA-Z]+ === "Intermediate" \? AMBER : MAGENTA;\s*\}/,
      `${path}'s diffColor mapping must be unchanged`,
    );
  }
});

test("neither screen removed Age Group/Audience display — only decoupled it from the Level badge", () => {
  for (const path of [CLASSES_SCREEN, CLASS_DETAIL_SCREEN]) {
    const source = read(path);
    assert.ok(
      source.includes("ageGroup") || source.includes("ageRangeLabel"),
      `${path} must still display Age Group/Audience information independently of Level`,
    );
  }
});

// ─── Behavioral proof of "All Levels" filter semantics ─────────────────────
//
// Everything above is a source-level assertion: it proves the predicate
// TEXT exists, not what it DOES for a given selection. The tests below
// execute the real predicate, extracted byte-for-byte from source via the
// same regex the structural test above already pins — so this can never
// silently drift from the actual code: if the source predicate changes,
// the structural test fails first and this extraction fails loudly rather
// than testing stale logic.
//
// LEVEL_TABS = ["All Levels", "Beginner", "Intermediate", "Advanced"] —
// there is no "Professional" chip, and DanceClass["level"] has no such
// value, so a "Professional" selection is unreachable through the UI and
// is not exercised here (see the dedicated unreachability test below).

function extractLevelPredicateSource(): string {
  const source = read(CLASSES_SCREEN);
  const match = source.match(
    /if \(levelFilter !== "all" && c\.level\.toLowerCase\(\) !== levelFilter\) return false;/,
  );
  assert.ok(match, "expected the exact Level-filter predicate line in classes.tsx");
  return match![0];
}

/** Rebuilds the real predicate as a callable function from the exact
 *  source text extracted above — "does this class pass the Level
 *  filter?" — the inverse of the source's early-return-false form. */
function buildLevelFilterPredicate(): (level: string, levelFilter: string) => boolean {
  const predicateSource = extractLevelPredicateSource();
  const body = predicateSource
    .replace(/^if \(/, "return !(")
    .replace(/\) return false;$/, ");");
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function("c", "levelFilter", body) as (level: string, levelFilter: string) => boolean;
}

function extractLevelChipKeyMapping(): string {
  const source = read(CLASSES_SCREEN);
  const match = source.match(/const key = l === "All Levels" \? "all" : l\.toLowerCase\(\);/);
  assert.ok(match, "expected the exact chip-key mapping line in classes.tsx");
  return match![0];
}

function chipKeyFor(label: string): string {
  const mappingSource = extractLevelChipKeyMapping();
  const body = mappingSource.replace(/^const key = /, "return ").replace(/;$/, ";");
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function("l", body) as (l: string) => string;
  return fn(label);
}

test('the "All Levels" chip maps to the "all" bypass sentinel, never the literal string "all levels"', () => {
  assert.equal(chipKeyFor("All Levels"), "all");
  assert.notEqual(chipKeyFor("All Levels"), "all levels");
});

test('chip labels map to their lowercase key exactly, matching LEVEL_TABS = ["All Levels", "Beginner", "Intermediate", "Advanced"]', () => {
  assert.equal(chipKeyFor("Beginner"), "beginner");
  assert.equal(chipKeyFor("Intermediate"), "intermediate");
  assert.equal(chipKeyFor("Advanced"), "advanced");
});

test('selecting "All Levels" returns every class regardless of its own stored level — never a literal comparison against cls.level', () => {
  const passesLevelFilter = buildLevelFilterPredicate();
  const filterKey = chipKeyFor("All Levels"); // "all"

  for (const level of ["Beginner", "Intermediate", "Advanced", "All Levels"]) {
    assert.equal(
      passesLevelFilter({ level } as unknown as { level: string }, filterKey),
      true,
      `a class stored as "${level}" must still pass when "All Levels" is selected`,
    );
  }
});

test('selecting "Beginner" matches only classes stored as level "Beginner" — exact match, mirroring Admin\'s cls.level === levelFilter (no inclusive "All Levels" fallback)', () => {
  const passesLevelFilter = buildLevelFilterPredicate();
  const filterKey = chipKeyFor("Beginner"); // "beginner"

  assert.equal(passesLevelFilter({ level: "Beginner" }, filterKey), true);
  assert.equal(passesLevelFilter({ level: "Intermediate" }, filterKey), false);
  assert.equal(passesLevelFilter({ level: "Advanced" }, filterKey), false);
  assert.equal(
    passesLevelFilter({ level: "All Levels" }, filterKey),
    false,
    'a class stored as "All Levels" is excluded from the "Beginner"-only filter — same as Admin, not a regression',
  );
});

test('selecting "Intermediate" matches only classes stored as level "Intermediate"', () => {
  const passesLevelFilter = buildLevelFilterPredicate();
  const filterKey = chipKeyFor("Intermediate");

  assert.equal(passesLevelFilter({ level: "Intermediate" }, filterKey), true);
  assert.equal(passesLevelFilter({ level: "Beginner" }, filterKey), false);
  assert.equal(passesLevelFilter({ level: "Advanced" }, filterKey), false);
  assert.equal(passesLevelFilter({ level: "All Levels" }, filterKey), false);
});

test('selecting "Advanced" matches only classes stored as level "Advanced"', () => {
  const passesLevelFilter = buildLevelFilterPredicate();
  const filterKey = chipKeyFor("Advanced");

  assert.equal(passesLevelFilter({ level: "Advanced" }, filterKey), true);
  assert.equal(passesLevelFilter({ level: "Beginner" }, filterKey), false);
  assert.equal(passesLevelFilter({ level: "Intermediate" }, filterKey), false);
  assert.equal(passesLevelFilter({ level: "All Levels" }, filterKey), false);
});

test('"Professional" is not a reachable filter state — no LEVEL_TABS chip, and no DanceClass["level"] value, produces it', () => {
  const classesSource = read(CLASSES_SCREEN);
  const levelTabsMatch = classesSource.match(/const LEVEL_TABS = \[([^\]]+)\] as const;/);
  assert.ok(levelTabsMatch, "expected to find LEVEL_TABS");
  assert.equal(
    /professional/i.test(levelTabsMatch![1]),
    false,
    "LEVEL_TABS must not offer a Professional chip — none is currently supported",
  );

  const mockDataSource = read("artifacts/central/data/mockData.ts");
  const levelTypeMatch = mockDataSource.match(
    /level: "Beginner" \| "Intermediate" \| "Advanced" \| "All Levels";/,
  );
  assert.ok(
    levelTypeMatch,
    'DanceClass["level"] must remain exactly this 4-value union — "Professional" is not a valid stored value',
  );
});

test("an unrecognized/unknown level value from the API is coerced to the safe All Levels default, never silently hidden from every filter", () => {
  const adaptersSource = read("artifacts/central/data/apiAdapters.ts");
  assert.match(
    adaptersSource,
    /default:\s*\/\/ Unknown value from DB — treat as "All Levels" so nothing gets hidden\s*return "All Levels";/,
    "coerceLevel's unknown-value fallback must still default to All Levels — this predates R1 and R1 must not have disturbed it",
  );
});

test("the Age filter and Level filter apply independently — a class must pass BOTH to be shown, and neither filter can override the other", () => {
  const source = read(CLASSES_SCREEN);
  const ageLine = "if (ageFilter !== \"all\" && c.ageGroup.toLowerCase() !== ageFilter) return false;";
  const levelLine = extractLevelPredicateSource();
  const ageIndex = source.indexOf(ageLine);
  const levelIndex = source.indexOf(levelLine);
  assert.ok(ageIndex !== -1 && levelIndex !== -1, "expected both filter lines to be present");
  assert.ok(ageIndex < levelIndex, "the Age check must run as an independent, separate early-return before the Level check");

  // Behaviorally: a class failing Age must never be rescued by passing
  // Level, and vice versa — replicate both as independent early-returns.
  function passesBoth(c: { ageGroup: string; level: string }, ageFilter: string, levelFilter: string): boolean {
    if (ageFilter !== "all" && c.ageGroup.toLowerCase() !== ageFilter) return false;
    if (levelFilter !== "all" && c.level.toLowerCase() !== levelFilter) return false;
    return true;
  }

  const kidsBeginner = { ageGroup: "Kids", level: "Beginner" };
  assert.equal(passesBoth(kidsBeginner, "kids", "beginner"), true, "matches both");
  assert.equal(passesBoth(kidsBeginner, "adults", "beginner"), false, "fails Age even though Level matches");
  assert.equal(passesBoth(kidsBeginner, "kids", "advanced"), false, "fails Level even though Age matches");
  assert.equal(passesBoth(kidsBeginner, "all", "all"), true, "both bypassed");
});
