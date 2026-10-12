import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");
const controls = read("../components/admin/users-directory-controls.tsx");
const inactive = read("./inactive-accounts.tsx");

test("fixed active and inactive scopes cannot be removed by clearing optional controls", () => {
  assert.match(
    controls,
    /accountStatus:\s*section === "inactive" \? \(filters.accountStatus \?\? "inactive"\) : "active"/,
  );
  assert.match(
    controls,
    /accountType: section === "inactive" \? filters.accountType : section/,
  );
  assert.match(controls, /clear: \(\) => \{\s*setSearch\(""\);\s*setDebouncedSearch\(""\);\s*setFilters\(\{\}\);\s*setPage\(1\);/);
});
test("all three directory pages use one shared toolbar rather than filtering loaded records", () => {
  for (const page of ["students", "parents", "inactive-accounts"]) {
    const source = read(`./${page}.tsx`);
    assert.match(source, /<UsersDirectoryControls controls=\{controls\}/);
    assert.match(source, /useListStudents\(/);
    assert.doesNotMatch(
      source,
      /students\.filter\(|parents\.filter\(|rows\.filter\(/,
    );
  }
  assert.match(controls, /leadingContent=\{\s*<WorkspaceRouteNav/);
  assert.match(controls, /filtersContent=/);
});
test("inactive directory has existing detail links and no account mutation controls", () => {
  assert.match(
    inactive,
    /account\.accountType === "parent" \? "parents" : "students"/,
  );
  assert.match(inactive, /account\.accountStatus === "deleted"/);
  assert.match(inactive, /TablePagination/);
  assert.doesNotMatch(
    inactive,
    /useUpdateStudent|useDeleteStudent|\.mutate\(|reactivate|permanent-delete/,
  );
});
test("filter controls are labelled and provider semantics are not misrepresented as registration source", () => {
  assert.match(controls, /aria-labelledby=/);
  assert.match(controls, /htmlFor="users-joined-from"/);
  assert.match(
    controls,
    /Last recorded authentication provider, not signup source/,
  );
  for (const provider of [
    "local",
    "google",
    "apple",
    "facebook",
    "notRecorded",
  ])
    assert.ok(controls.includes(`["${provider}"`));
});
test("directory scopes and new route use existing view permissions, not deletion permissions", () => {
  assert.match(controls, /can\("students", "view"\)/);
  assert.match(controls, /can\("parents", "view"\)/);
  assert.match(controls, /can\("users", "view"\)/);
  assert.doesNotMatch(controls, /can\([^)]*"delete"/);
  assert.match(
    read("../App.tsx"),
    /inactiveAccounts: \[\["students", "view"\], \["parents", "view"\], \["users", "view"\]\]/,
  );
});
