/**
 * R2 / narrowed F-16 correction: mapApiClassToMobile must carry the API's
 * canonical danceTypeId onto the mobile DanceClass model, so
 * classes.tsx's matchesClass() "prefer ID when present" branch can
 * actually execute instead of always falling through to fuzzy free-text
 * category matching.
 *
 * A class whose canonical Dance Type relationship IS set but whose
 * free-text category doesn't normalize to any Dance Type name/slug must
 * still be findable by ID.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { mapApiClassToMobile } from "./apiAdapters";
import type { Class as ApiClass } from "@workspace/api-client-react";

function baseApiClass(overrides: Partial<ApiClass> = {}): ApiClass {
  return {
    id: 501,
    title: "Free Text Style Name",
    description: null,
    instructorId: 7,
    category: "Some Unmatched Free-Text Category",
    danceTypeId: 3,
    level: "Beginner",
    ageGroup: "Adults",
    allowAllAges: true,
    minAge: null,
    maxAge: null,
    ageRangeLabel: "Adults",
    configurationState: "configured" as ApiClass["configurationState"],
    catalogueEligibility: { evaluated: true, eligible: true, reasons: [] },
    durationMins: 60,
    capacity: 20,
    photoUrl: null,
    classVideoUrl: null,
    isActive: true,
    pricingCategory: null,
    ...overrides,
  } as ApiClass;
}

test("mapApiClassToMobile carries a present danceTypeId onto the mobile model", () => {
  const mapped = mapApiClassToMobile(baseApiClass({ danceTypeId: 3 }));
  assert.equal(mapped.danceTypeId, 3);
});

test("mapApiClassToMobile leaves danceTypeId undefined when the API returns null (legacy/unassigned class)", () => {
  const mapped = mapApiClassToMobile(baseApiClass({ danceTypeId: null }));
  assert.equal(mapped.danceTypeId, undefined);
});

test("a class with a canonical danceTypeId is matchable by ID even when its free-text category does not normalize to any Dance Type name/slug", () => {
  const mapped = mapApiClassToMobile(
    baseApiClass({ category: "Totally Unmatched Free Text", danceTypeId: 9 }),
  );

  // Mirrors classes.tsx's matchesClass "prefer ID when present" branch.
  const dt = { id: 9, name: "Contemporary", slug: "contemporary" };
  const matchesById = mapped.danceTypeId != null && mapped.danceTypeId === dt.id;
  assert.equal(matchesById, true, "a correctly linked class must not disappear from its Dance Type's grouping");
});

test("a legacy class with no danceTypeId still falls back to free-text/slug matching (compatibility preserved)", () => {
  const mapped = mapApiClassToMobile(baseApiClass({ category: "Hip Hop", danceTypeId: null }));
  assert.equal(mapped.danceTypeId, undefined);
  // The legacy fallback path (normalized category === normalized name/slug)
  // must remain reachable for classes with no Dance Type assigned.
  const normalize = (s: string) => s.trim().toLowerCase().replace(/[\s\-_]+/g, "");
  assert.equal(normalize(mapped.categoryName), normalize("Hip Hop"));
});
