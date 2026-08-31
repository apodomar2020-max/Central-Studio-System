/**
 * Canonical Account Phone Domain — regression guard for the two Admin edit
 * surfaces that write students.phone (Students and Parents share the same
 * table and the same PATCH /students/:id endpoint under different filtered
 * views; see the module comment atop parents.tsx).
 *
 * students.tsx / parents.tsx are React admin screens that cannot be
 * imported into a plain Node test process — this follows the repo's
 * established source-assertion convention (see
 * artifacts/api-server/src/routes/bookingPriceBinding.test.ts).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const STUDENTS_PAGE = "artifacts/admin/src/pages/students.tsx";
const PARENTS_PAGE = "artifacts/admin/src/pages/parents.tsx";

for (const path of [STUDENTS_PAGE, PARENTS_PAGE]) {
  test(`${path}: imports the shared canonical phone domain instead of a private regex`, () => {
    const source = read(path);
    assert.match(source, /from "@workspace\/api-zod"/);
    assert.match(source, /validateAccountPhone/);
    assert.match(source, /formatAccountPhoneLocal/);
  });

  test(`${path}: the phone field is validated against the shared domain, not a bare z.string()`, () => {
    const source = read(path);
    assert.match(source, /validateAccountPhone\(value\)\.ok/, "expected the zod schema to refine phone against validateAccountPhone");
  });

  test(`${path}: a canonical-form value from the API is displayed in the familiar local form when editing`, () => {
    const source = read(path);
    assert.match(source, /formatAccountPhoneLocal\(/, "expected form.reset(...) to format the phone for display");
  });
}

test("parents.tsx: duplicate-phone conflicts already surface the backend's message via the existing onError toast pattern", () => {
  const source = read(PARENTS_PAGE);
  assert.match(source, /err\?\.data\?\.error/, "the existing onError handler must keep reading err.data.error, which is where PHONE_ALREADY_IN_USE's message lives");
});

test("students.tsx: the update mutation now has an onError handler surfacing a failed phone update (previously had none)", () => {
  const source = read(STUDENTS_PAGE);
  assert.match(source, /onError:\s*\(error: unknown\)\s*=>/, "expected an onError handler on updateStudent.mutate");
  assert.match(source, /err\?\.data\?\.error/);
});
