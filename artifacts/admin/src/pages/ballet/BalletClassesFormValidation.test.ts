/**
 * Source-assertion tests for the Add/Edit Ballet Class dialog's Group
 * validation lifecycle. BalletClassesPage.tsx cannot be imported directly
 * under node:test (it reads `import.meta.env.*`, which only exists under
 * Vite), so — matching the established convention for this file elsewhere
 * in the suite (see balletClassCanonicalModel.test.ts) — these tests read
 * the source and assert on its exact wiring.
 *
 * Root cause of the stale "Group is required" message: useForm() had no
 * `mode`/`reValidateMode`, defaulting to RHF's `mode: "onSubmit"`. Before
 * the form's first submit attempt, RHF skips onChange-triggered
 * revalidation of a field even if that field already has an error — and
 * setLevel() forces an early "Group is required" error (shouldValidate:
 * true) as soon as Level changes, well before any submit. Selecting a
 * valid Group afterward only calls field.onChange, which — under
 * mode:onSubmit and isSubmitted:false — never re-triggers the resolver,
 * so the stale error survived until the next full submit. Adding
 * `mode: "onChange", reValidateMode: "onChange"` makes every field
 * (including Group) revalidate on every change from the first interaction
 * onward, which clears the error the moment a valid Group is chosen.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = readFileSync(resolve(process.cwd(), "artifacts/admin/src/pages/ballet/BalletClassesPage.tsx"), "utf8");

// 1. missing Group produces required error
test("groupId is required by the zod schema with the exact message shown to the admin", () => {
  assert.match(source, /groupId:\s*z\.number\(\)\.int\(\)\.positive\("Group is required"\)/);
});

// 2. selecting valid Group clears error
test("the form revalidates on every change, so a stale error clears as soon as the field becomes valid", () => {
  assert.match(source, /useForm<FormValues>\(\{[^}]*mode:\s*"onChange"/);
  assert.match(source, /useForm<FormValues>\(\{[^}]*reValidateMode:\s*"onChange"/);
});

// 3. changing Level clears incompatible Group (and re-marks it required)
test("selecting a Level resets groupId to empty and forces immediate revalidation", () => {
  assert.match(
    source,
    /const setLevel = \(value: string, onChange: \(value: number\) => void\) => \{ onChange\(Number\(value\)\); form\.setValue\("groupId", 0, \{ shouldValidate: true \}\); \};/,
  );
});

// 4. selecting a valid Group for the new Level clears the error
test("Group options are recomputed reactively from the watched Level, so a freshly valid Group is selectable and clears via onChange revalidation", () => {
  assert.match(source, /const selectedLevelId = form\.watch\("levelId"\)/);
  assert.match(
    source,
    /const selectableGroups = groups\.filter\(\(item\) => item\.levelId === selectedLevelId && \(item\.isActive \|\| item\.id === editing\?\.groupId\)\)/,
  );
  // Group's onValueChange still updates through the same Controller field,
  // which is now covered by the form-level onChange revalidation above.
  assert.match(source, /name="groupId"[\s\S]{0,200}onValueChange=\{\(value\) => field\.onChange\(Number\(value\)\)\}/);
});

// 5. Add dialog reset removes old errors (RHF's reset() clears formState.errors by default)
test("opening Add Class resets the form to clean empty values before showing the dialog", () => {
  assert.match(source, /const openCreate = \(\) => \{ setEditing\(null\); form\.reset\(EMPTY_VALUES\); setOpen\(true\); \};/);
});

// 6. Edit dialog with valid Group has no false error
test("opening Edit Class resets the form with the Class's real levelId/groupId, never a placeholder", () => {
  assert.match(
    source,
    /form\.reset\(\{ title: item\.title, levelId: item\.levelId, groupId: item\.groupId, instructorId: item\.instructorId,/,
  );
});

// 7. closing/reopening does not retain validation errors or touched state
test("both dialog entry points call the bare form.reset (no keepErrors/keepTouched), so state never leaks between sessions", () => {
  assert.doesNotMatch(source, /form\.reset\([^)]*keepErrors/);
  assert.doesNotMatch(source, /form\.reset\([^)]*keepTouched/);
  assert.equal((source.match(/form\.reset\(/g) ?? []).length, 2);
});

// 8. no regression to filtered Group options (Group is scoped to the selected Level, active-only + editing exception)
test("Group select stays filtered to the selected Level's active groups", () => {
  assert.match(source, /disabled=\{!selectedLevelId\}/);
  assert.match(source, /placeholder=\{selectedLevelId \? "Select group in this level" : "Select a level first"\}/);
});

// 9. no regression to single-select Level/Group (no arrays reintroduced)
test("Level, Group, and Instructor remain single-select scalars, not multi-select arrays", () => {
  for (const field of ["levelId", "groupId", "instructorId"]) {
    assert.match(source, new RegExp(`${field}:\\s*z\\.number\\(\\)\\.int\\(\\)\\.positive\\(`));
  }
  assert.doesNotMatch(source, /levelIds|groupIds|scheduleIds/);
});

// 10. no regression to derived Duration
test("Duration stays server/client-derived read-only from start/end time, unaffected by the validation-mode fix", () => {
  assert.match(source, /function deriveDuration\(start: string, end: string\): number \| null/);
  assert.match(source, /const duration = useMemo\(\(\) => deriveDuration\(startTime, endTime\), \[startTime, endTime\]\)/);
  assert.match(source, /data-testid="input-ballet-class-duration"/);
  assert.match(source, /disabled=\{isSaving \|\| duration == null\}/);
});
